# Design

## Context

See proposal.md - Why. The engine currently derives root files and compiler options from a consumer tsconfig, then calls `createPrograms` without `parsedCommandLine.projectReferences`. A read-only production-session probe with an app importing `../lib/dist/counter.js` returned no components and an unresolved-module issue, although the research probe using a configured project succeeded. The extension only returns its package version on activation.

TypeScript 7.1.0-beta already exposes `CreateProgramOptions.projectReferences` and async `getTimingInfo`/`resetTimingInfo`. Its public async client exposes no native cancellation. Existing engine results have project/snapshot/generation identity, but generation alone cannot make concurrent mutable session operations safe.

Legacy `ts-lit-plugin` receives a per-file project from tsserver rather than routing documents itself. Native-preview likewise requests project information by document URI, and its native project collection includes an inferred-project fallback. TS7 exposes this association as `Snapshot.getDefaultProjectForFile(file)` over configured and inferred projects; synthetic projects are excluded. A nearest-tsconfig-only host would therefore diverge from both legacy and native behavior for inferred, solution, and multiply included files.

Native-preview retains default projects required by open files, their references and ancestors, and explicitly opened API projects. Its `cleanupConfiguredProjects` policy is liveness-based rather than a numerical LRU limit, so one open file in each of 100 unrelated projects can retain 100 programs in the shared native server. The spawned extension instead owns independent TS7 sessions and needs an explicit residency bound.

## Goals / Non-Goals

**Goals:**

- Add host policies without changing existing eager/lazy defaults or moving VS Code concerns into the engine/core.
- Make cancellation and overlay/scope changes transactional from the caller's perspective.
- Keep one serialized mutation pipeline per resident editor project, one global versioned view of open/dirty documents, and bounded native-session residency without denying analysis to a newly active project.
- Provide opt-in operational diagnostics and resource measurements with no instrumentation work in normal logging mode.
- Produce executable evidence for every #22 requirement while preserving the native-cancellation and performance limitations.

**Non-Goals:**

- Opening every referenced tsconfig as a separate TypeScript configured project; minimal references remain options of the consumer's synthetic program.
- Shrinking the engine's historical lazy scope on every close, reloading tsconfig graphs, solution-builder orchestration, or reproducing the full TypeScript project-service association algorithm in the spawned fallback.
- Cancelling native requests, connecting to native-preview pipes, or publishing template diagnostics in this change.
- Turning preliminary fixture budgets into hardware-independent CI thresholds.
- Automatic memory-based eviction or exact attribution of shared JavaScript/native memory to individual registries; the configurable count remains the initial policy and measurements inform #26.

## Decisions

### Carry parsed references into every synthetic program

`SessionConfiguration` retains `project.parsedCommandLine.projectReferences` alongside roots and compiler options. `SnapshotFactory.createProgramSnapshot` passes them as `createPrograms[0].options.projectReferences` on initial creation and every update, in both eager and lazy modes. The existing explicit-root/module-closure pipeline remains responsible for dependency discovery; TypeScript owns output-to-source redirection.

Add a focused engine fixture in which the app imports a component through the referenced lib's `outDir` while only lib source exists. Run eager collection and lazy scope/enrichment, then change only the referenced source overlay and assert the new member type plus old-snapshot isolation. This is stronger than the original direct-source research probe and fails against the current production path.

Alternatives considered: reopening configured projects with `openProjects` throughout discovery would change program ownership and the existing synthetic-update pipeline; manually mapping output paths to source would duplicate TypeScript semantics. Runtime changes to tsconfig or its reference list remain unsupported and documented.

### Standard AbortSignal, checked only at logical boundaries

Add `DiscoveryOperationOptions {signal?: AbortSignal}` as an optional final argument to collection, scope, enrichment, materialization, overlay update/removal, type query, and assignability methods. Existing calls remain valid. `signal.throwIfAborted()` supplies the rejection reason; no custom cancellation error or parallel cancellation contract is introduced.

The session checks before starting work, after asynchronous pipeline stages, and immediately before committing state or returning a newly produced result. Snapshot building checks between program/graph/index stages. No cancellation token crosses the native wire protocol: the native operation may finish, after which the checkpoint rejects its logical operation.

Mutable operations use a commit/rollback boundary:

- Overlay update and removal share an internal transaction. Both changed and removed files feed graph/registry/base-documentation invalidation. Any failure or abort before commit restores the original overlay map and disposes an uncommitted successor snapshot.
- Lazy scope collection computes a prospective scope locally and passes it to snapshot construction. The registry scope is extended only when the new state is committed, so aborted first or subsequent scope requests leave the prior scope intact.
- Semantic query bookkeeping occurs only after the final cancellation checkpoint. Core applies a returned registry view only after the engine operation succeeds.

The API does not attempt to make arbitrary concurrent updates semantically independent. The editor serializes them; other callers retain the existing single-session ordering responsibility. Disposal is not cancellable.

Alternatives considered: result-only suppression would leave overlays/scope committed by cancelled calls; native cancellation is not publicly available; VS Code `CancellationToken` would couple the extractable engine to the editor.

### Explicit removal completes the overlay lifecycle

Add `removeOverlays(fileNames, options?)` to engine and core sessions. It removes only existing overlay entries, treats removed files as changed, and uses the same eager/lazy successor pipeline as `update`. Removing absent names is a no-op returning the current result where one exists rather than manufacturing a new generation.

`SessionConfiguration.createFileSystem` already layers `files` below overlays, so removal naturally restores virtual fixture content or disk content. Result provenance is computed from the remaining overlay keys. The host uses removal on save and close; it does not read disk text into a replacement overlay.

Alternative considered: `update` with nullable text would make addition, replacement, and removal ambiguous and weaken the existing `SourceOverlay` contract.

### Expose opt-in engine diagnostics, disabled by default

Add `collectTiming?: boolean` to discovery options and construct `API` with it. Add `getTimingInfo()` and `resetTimingInfo()` to engine/core sessions. Publicly export `DiscoveryTimingInfo` as a type alias of TypeScript's serializable `TimingInfo`; it contains measurements only, not checker handles, AST nodes, or overlay text. The core re-exports the alias and forwards calls without interpreting metrics.

Default construction preserves `collectTiming: false`. Tests verify disabled zeroed metrics, enabled request/byte/latency totals, JSON serialization, and reset semantics. Documentation notes that retrieving timing itself performs a protocol request, so counters are interpreted according to the pinned API rather than assumed to be operation-only.

The same instrumentation flag controls an optional `moduleResolutionFallbackCount` on discovery results and registry views. When enabled, the module graph counts actual checker fallbacks used after ordinary resolution fails or names a missing file. The count covers work performed for the graphs backing the current result, including both scoped and project-index graphs in lazy mode; reused module resolutions add nothing. It contains no module specifier or source text and requires no additional native request. When instrumentation is disabled, the field is absent and the counter is not incremented. The editor includes the available count in verbose/debug `analysis.accepted` summaries so users can distinguish an isolated fallback from systemic resolution problems.

Alternative considered: a mirrored timing DTO would decouple field names but duplicate an already serializable upstream measurement contract without adding semantic safety. A separate fallback-metrics session API would add a parallel diagnostic channel and retrieval lifecycle without providing more useful evidence than the current-result count.

### A VS Code coordinator owns global documents and per-project runtimes

The extension gains an `EditorAnalysisCoordinator` with three focused collaborators:

- `DocumentTracker` initializes from `workspace.textDocuments` and subscribes to open/change/save/close. It supports file-backed TypeScript/JavaScript documents, keys state by canonical URI, and maintains separate open and dirty maps with versions and text. Clean opens affect scope only; saves and closes remove dirty state. This state is independent of runtime residency and survives eviction.
- `ProjectRouter` is an asynchronous per-file association port, not a global current-program selector. The spawned implementation discovers `tsconfig.json` files per workspace folder and selects the nearest containing config, but assigns documents without one to a workspace-scoped synthetic inferred session rooted at the open documents. Workspace-folder identity remains part of fallback project keys, preventing same-relative-path multi-root collisions. A separate production association session would duplicate TypeScript project ownership without being connected to the active host, so it is removed; default-project routing belongs to the future shared transport.
- `ProjectRuntime` owns at most one lazy `RegistrySession`, its desired input revision, debounce and maximum-wait timers, active `AbortController`, serialized run promise, last accepted generation/view, last-known-good/stale status, and logical resource counters. The host uses a bounded snapshot retention policy because only the current view is semantically queried.

The `ts7LitAnalyzer.analysis.trigger` setting selects `onType` (default) or `onSave`. `ts7LitAnalyzer.analysis.debounceMs` defaults to 100 ms and `ts7LitAnalyzer.analysis.maxWaitMs` to 500 ms; both apply only to `onType`. Initial opens run promptly in both modes. In `onType`, a change increments the desired revision, aborts active logical work, and schedules the latest full input state after debounce or maximum wait. In `onSave`, a change updates only `DocumentTracker`/desired versions and marks the accepted view stale: it does not schedule a run, mutate overlays, or broadcast to other sessions. Save and close always supersede pending work, clear both timers, and reconcile immediately. Configuration changes apply without reloading VS Code; obsolete type-driven timers are cancelled when switching to `onSave`.

The first change in a pending cycle records its time and starts the maximum-wait timer. Subsequent changes restart only the trailing debounce, never the maximum wait. Either timer makes one run due with the latest complete state and clears the cycle. If an earlier mutation is still settling, the due run remains the single queued successor and later changes continue to replace its input; serialization is not broken to satisfy the timer. Maximum wait therefore bounds timer-driven postponement, not native execution or completion latency. Save/close and `onSave` bypass both intervals.

All resident project mutations run through one runtime queue. The queue awaits settlement of an aborted run before starting the next, so native completion cannot race a newer session mutation. A run captures the complete current open/dirty state and document versions. It creates the session lazily with current overlays, reconciles removed and current dirty overlays, extends scope for currently open files routed to that project, and publishes only the final current view. After every await it checks the run revision, abort signal, contributing versions, and residency ownership. Registry generations must also advance beyond the last accepted generation. A superseded async-created session is disposed instead of installed.

`ts7LitAnalyzer.analysis.maxResidentProjects` is a positive integer, initially defaulting to 8. The bound includes live and asynchronously creating sessions. A new active project is marked most-recently-used and protected from eviction; when no slot is available, the coordinator selects the least-recently-used other runtime, logically cancels it, awaits settlement and disposal, and only then admits the replacement. It never refuses analysis merely because the limit is full. Disposal latency and cold start are the explicit trade-off. Runtime metadata and document associations may remain after eviction, but an evicted session cannot publish or serve current semantic queries.

The current dirty overlay set is broadcast to resident project runtimes only, while open scope files are routed only to their associated project. Background broadcasts do not recreate evicted runtimes. Reactivation or a new analysis trigger admits the runtime again and reconciles the complete current state, so no incremental overlay history is required. This deliberately favors correct unsaved project-reference updates over dependency-aware scheduling. Unaffected engine graphs/records limit some work; performance probes measure the broadcast and eviction costs before any optimization.

The native-preview connection and its lifecycle remain #25 work; this change establishes the routing port and retains an OpenSpec probe of `getDefaultProjectForFile` against real API snapshots, while Extension Host integration exercises the spawned configured/inferred fallback. Switching transports must not change the scheduler or analysis-program ownership.

Closing removes the overlay and stops future scheduling for that document but does not shrink the engine's historical scope or remove project-wide index records. Editor close is defined by `tabGroups.onDidChangeTabs`, including split/reopen handling, not by `onDidCloseTextDocument`: VS Code can retain a text model after its editor closes and delay model disposal (roughly three minutes in the reported cases). See [microsoft/vscode#199282](https://github.com/microsoft/vscode/issues/199282) and [microsoft/vscode#291739](https://github.com/microsoft/vscode/issues/291739). Legacy `vscode-lit-plugin` has no close handler; `ts-lit-plugin` receives `info.project` from tsserver and computes diagnostics on demand against the current language-service program, leaving open-file/program lifecycle to TypeScript and VS Code. The new host needs explicit tab ownership because it also owns overlay removal and native session residency. Project removal, eviction, and extension deactivation abort/await work, clear timers/samplers, and dispose sessions. `deactivate()` returns the coordinator's disposal promise.

Alternatives considered: core-owned orchestration would violate the established host boundary; independent per-document sessions would duplicate native programs and lose cross-document consistency; nearest-tsconfig-only routing would drop inferred projects and diverge from TypeScript's default-project selection; unbounded concurrent updates would make cancellation insufficient to protect mutable session state; denying a ninth project or limiting only idle sessions would respectively break editor availability or fail to bound creating/in-flight native work.

### Observable host state and verification without template providers

Activation retains `analyzerVersion` and exposes a read-only orchestration diagnostic snapshot plus an idle-await hook for host tests. The snapshot reports routed project keys, open/dirty URIs and versions, accepted generation/view identity, residency state, pending work, and current errors; it does not expose overlay text. No completion, hover, definition, or diagnostics provider is registered.

Scheduler race tests use controlled deferred session doubles for exact orderings: pre-cancelled work, old completion after a new revision, superseded creation, save/close during debounce, continuous changes through maximum wait, maximum wait during an unsettled run, deferred `onSave` changes, LRU eviction during creation/in-flight work, reactivation with dirty state, failure of current versus stale work, and disposal. An OpenSpec probe uses real TS7 snapshots for configured, inferred, and multiply included file associations without creating a production adapter or public session contract. Integration tests in the real Extension Development Host use actual VS Code documents and real spawned registry sessions against app/lib fixtures, including a multi-root workspace file and an inferred-project document. They poll observable state with timeouts rather than sleeping and do not claim native-preview or template-feature verification.

### Leveled Output diagnostics own instrumentation overhead

The extension creates one VS Code `LogOutputChannel` named `TypeScript 7 Lit Analyzer`; it sends no telemetry and writes no extension-managed log files. `ts7LitAnalyzer.logging.level` accepts `normal` (default), `verbose`, and `debug`. Events carry structured context where available: project/session identity, canonical URI and document version, run/generation/snapshot identity, operation, duration, and outcome/reason.

- `normal` records important activation/deactivation events, warnings, and current failures. It does not call `performance.now()` solely for metrics, sample memory, run diagnostic timers, construct sessions with `collectTiming`, or call `getTimingInfo`/`resetTimingInfo`.
- `verbose` adds document/routing/scheduling/overlay/residency events and per-run wall/timing/resource summaries. TS7 timing is enabled for sessions and sampled after public operations rather than polled continuously.
- `debug` adds all available version/generation transitions, cancellation/staleness/eviction reasons, failure stacks, timing deltas, and recent-request details. It never logs source text, overlay contents, complete ASTs, or unbounded payloads.

Changing between `normal` and an instrumented level uses the coordinator's safe disposal/recreation path so existing sessions gain or lose constructor-time `collectTiming` without a VS Code restart; documents and current desired state survive. Changing between `verbose` and `debug` does not require recreation. Returning to `normal` stops samplers/timers immediately and subsequent sessions disable timing.

Memory reporting is intentionally scoped. Each runtime reports logical footprint measurements available without heap walking: registry/component and cache/scope counts, retained views/snapshots, and overlay UTF-8 bytes. `process.memoryUsage()` supplies Extension Host heap/RSS context, explicitly labelled as shared with other extensions and not exact per-registry JavaScript consumption. Samples occur only in verbose/debug after lifecycle events or analysis runs; no forced GC, automatic heap profile, or normal-mode sampler is allowed. The pinned spawned TS7 client does not publicly expose its child process identity, so production logs do not guess per-session native RSS from process names. Isolated performance probes may retain the existing process-matching RSS approach with that limitation, while a future supported host adapter may expose attributable native memory.

These measurements help users tune `maxResidentProjects` for many small versus a few large projects. They do not drive automatic memory-based eviction in this change; that requires representative evidence in #26.

### Measure through the public session API and record preliminary budgets

Add `probes/host-policy-performance.mjs`, runnable after the standard build/fixture install. Run serial eager/lazy scenarios for cold scope/collection, warm collection, enrichment/type query, overlay update, and overlay removal. Use `performance.now()` for wall latency, public timing snapshots for requests/bytes/server/transport/node totals, `process.memoryUsage()` for JavaScript memory, and the existing native-RSS probe approach with its process-matching limitation documented.

Record the runtime, platform/hardware, fixture revision, commands, repeated-run spread, and selected preliminary budgets in `docs/performance.md`. Budgets are non-gating and specific to the measured fixtures; #26 remains responsible for broader representative evidence and final acceptance hardening.

Update README/architecture/research status to distinguish implemented logical cancellation and editor orchestration from native cancellation, pipe transport, runtime VSIX packaging, and template features. Record legacy/native per-file default-project and inferred-project evidence separately from spawned-fallback limitations. Add a pinned-version regression test showing the `getDeclaredTypeOfSymbol` anomaly and the correct symbol/location-based result used by the engine before and after a referenced-source overlay.

## Risks / Trade-offs

- [A cancelled native request still consumes work] → Serialize editor mutations, wait for actual settlement, and document logical-only cancellation; never claim native termination.
- [A late checkpoint misses a mutation] → Transactional overlay/scope commits, tests for aborted update/scope/query, and no core view application after rejection.
- [Broadcasting all dirty overlays scales poorly] → Correctness-first initial policy, resident-only coalescing, public timing evidence, and #26 follow-up before dependency-aware filtering.
- [A small residency bound thrashes during project switching while a large one exhausts memory] → Make the bound configurable, prioritize the active project, preserve documents across eviction, and expose opt-in footprint/memory evidence rather than pretending one default fits every workspace.
- [Waiting for evicted native work delays a newly active project] → Prefer idle LRU candidates, cancel at logical boundaries, await disposal before slot reuse for a hard bound, and measure eviction/cold-start latency.
- [Spawned fallback diverges from TypeScript association for solution or multiply included files] → Support inferred fallback explicitly, preserve default-project API evidence in a probe, use the shared transport's association in #25, and document the spawned fallback's remaining heuristic limits.
- [Closed files remain in historical lazy scope] → Remove their overlays immediately, retain valid project-wide records, and bound snapshot retention; scope shrinking is a separate optimization.
- [A retained last-good view has old semantic references] → Mark it stale and use only the accepted current generation for semantic operations.
- [Timing or memory instrumentation changes the behavior being measured] → Keep all instrumentation out of normal mode, sample only in verbose/debug, document timing-retrieval counter behavior, compare deltas, and never claim exact per-registry shared memory.
- [Extension tests pass with mocks but not VS Code] → Keep deterministic doubles only for race orderings and require real Extension Development Host integration scenarios.

## Migration Plan

All engine/core changes are additive and optional; existing call signatures, default timing, eager/lazy results, and overlay-update behavior remain compatible. Editor activation adds orchestration and an Output channel but no user-facing template diagnostics. Defaults preserve interactive type-driven analysis, a 100 ms debounce with a 500 ms maximum wait, eight resident project sessions, and minimal normal logging without instrumentation. No data migration is required. Rollback is a revert of the coordinator, settings, diagnostics, and additive API surface. Sync/archive OpenSpec only after implementation, real Extension Host verification, and acceptance.
