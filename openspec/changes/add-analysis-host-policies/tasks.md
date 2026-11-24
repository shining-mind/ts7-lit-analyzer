# Tasks

## 1. Engine: project references and checker regression evidence

- [x] 1.1 Retain parsed project references in `SessionConfiguration`, pass them through every synthetic program creation/update in `SnapshotFactory`, and add eager/lazy output-path source-redirection fixtures. Verify `pnpm --filter @ts7-lit-analyzer/cem-analyzer-ts7 test` covers collection, enrichment, and unsaved referenced-source changes with old-snapshot isolation.
- [x] 1.2 Add the pinned-TypeScript regression case for the `getDeclaredTypeOfSymbol` anomaly and correct symbol/location-based property types before/after a referenced-source overlay; update the research note to distinguish production-tested references from remaining config-reload limitations. Verify the named regression test passes.

## 2. Engine: logical cancellation and transactional state

- [x] 2.1 Add optional `DiscoveryOperationOptions`/`AbortSignal` arguments and cancellation checkpoints across analysis, query, scope, enrichment, materialization, update, and snapshot-building operations without changing existing callers. Add pre-aborted and native-completion-after-abort tests; verify the engine suite passes and no native-cancellation claim is introduced.
- [x] 2.2 Make overlay updates and lazy scope extension commit/rollback transactionally, including successor disposal, overlay restoration, prospective scope handling, and query bookkeeping. Add in-flight cancellation tests proving current result/overlay/scope state remains usable and unchanged; verify the named tests and engine suite pass.

## 3. Engine: overlay lifecycle and timing API

- [x] 3.1 Add `removeOverlays` through the shared overlay transaction, including changed-file invalidation and absent-name no-op behavior. Test last/partial/lazy removal, restored configured content, and overlay provenance with `pnpm --filter @ts7-lit-analyzer/cem-analyzer-ts7 test`.
- [x] 3.2 Add opt-in `collectTiming`, serializable `DiscoveryTimingInfo`, and session timing/reset methods with disabled-by-default compatibility. Test enabled/disabled metrics, IPC fields, JSON serialization, reset semantics, and absence of handles/overlay text; document timing-retrieval counter behavior in the research note.

## 4. Core: additive session forwarding

- [x] 4.1 Forward operation cancellation, overlay removal, and timing/reset through `RegistrySession`, re-export the adopted contracts, and keep all checker operations delegated. Add cancelled collection/query, view-preservation, overlay-removal, and enabled/disabled timing tests; verify `pnpm --filter @ts7-lit-analyzer/analyzer-core test:smoke` passes.
- [x] 4.2 Update the component-registry design guide with the new lifecycle/instrumentation invariants without turning it into a method reference. Verify the documented cancellation and stale-view guarantees match the engine/core tests.

## 5. Editor: document tracking and project routing

- [x] 5.1 Implement `DocumentTracker` and the per-file `ProjectRouter` contract with visible-tab initialization and reconciliation, URI/version state, dirty/open separation, supported-file filtering, workspace-folder-qualified identities, and spawned nearest-config plus synthetic-inferred fallback. Add Extension Host cases for open/change/save/close, background-model exclusion, retained-model reopen, split tabs, multiple tsconfigs, multi-root collisions, and a document without tsconfig; verify `pnpm test:e2e` passes.
- [x] 5.2 Add self-contained app/lib, multi-root, and no-config orchestration fixtures with project-reference output imports and no generated outputs. Verify the fixture paths and configurations are used by the Extension Host tests and contain no private/machine-specific paths.
- [x] 5.3 Retain a `getDefaultProjectForFile` probe covering configured, inferred, and multiply included files and explicit synthetic-program exclusion. Verify it against real TS7 API snapshots and document that native-preview connection/routing/lifecycle verification remains in #25 without maintaining an unused production association adapter.

## 6. Editor: scheduling, staleness, and lifecycle

- [x] 6.1 Implement per-association `ProjectRuntime` and `EditorAnalysisCoordinator` with lazy session creation, bounded snapshot retention, serialized mutations, configurable `onType`/`onSave` triggers, debounced/coalesced type changes with maximum wait, deferred save-driven changes, immediate save/close reconciliation, resident-only cross-project dirty-overlay broadcast, and scoped open-file collection. Add controlled-deferred tests for both trigger modes, rapid changes, continuous typing through maximum wait, maximum wait during an unsettled earlier run, cancellation, save during debounce, and cross-project updates; verify the applicable Extension Host suite passes.
- [x] 6.2 Enforce run/generation/document-version/residency acceptance, last-known-good stale status, current-versus-stale errors, superseded-session disposal, project removal, and deactivation cleanup. Implement the configurable live-and-creating session bound with active-project priority, automatic LRU eviction, settlement-before-slot-reuse, and full-state recreation without losing dirty documents. Add deterministic ninth-project, in-flight eviction, background-broadcast, reactivation, old-completion, superseded-creation, failure, and disposal tests; verify no stale operation publishes after eviction or disposal.

## 7. Editor: activation and real end-to-end orchestration

- [x] 7.1 Wire coordinator ownership into `activate`/`deactivate`, retain the existing activation contract, contribute the analysis/residency/logging settings, and expose only the documented text-free orchestration diagnostic snapshot/idle hook. Verify existing activation and packaging tests remain valid without registering template providers.
- [x] 7.2 Add the shared VS Code `LogOutputChannel` and `normal`/`verbose`/`debug` policies with correlated lifecycle/routing/scheduling/staleness events, opt-in TS7 timing, logical registry footprints, and explicitly scoped shared Extension Host memory samples. Apply level changes without VS Code restart, safely recreate sessions when constructor-time timing changes, stop all instrumentation in normal mode, and never log source text/AST or guess per-session native RSS. Add output and instrumentation-spy tests for every level and level transition.
- [x] 7.3 Exercise real VS Code documents and real spawned registry sessions through the multi-root app/lib and inferred-project fixtures, including both trigger modes, continuous-typing maximum wait, unsaved referenced-source changes, save/close overlay removal, latest-version acceptance, isolated configured/inferred identities, small-limit LRU eviction/recovery, verbose/debug diagnostics, and inactive normal-mode instrumentation. Verify `pnpm test:e2e` passes in a real Extension Development Host and does not claim native-preview or diagnostics/completion/hover/definition coverage.
- [x] 7.4 Add opt-in module-resolution checker-fallback counts to module graphs, discovery results, and registry views, including scoped and project-index graph work without counting reused resolutions. Omit the field and counter increments in normal mode, include the available count in verbose/debug accepted-run summaries without module specifiers or source text, and add engine/core/Extension Host coverage using the project-reference fixture. Update the package diagnostic guides and verify the applicable suites.
- [x] 7.5 Remove the unused production `createProjectAssociationSession`, its engine/core exports and association contracts, and `Ts7ProjectRouter`. Convert the engine association test into a self-contained executable OpenSpec probe using the pinned TypeScript API directly, update extension/parity/research documentation, run the probe, and verify no production references remain.
- [x] 7.6 Align `DocumentTracker` with visible-tab ownership: ignore background models in every lifecycle path, remove `workspace.textDocuments` initialization, load documents on tab open with deduplication and stale-async guards, and retain split/last-tab close semantics. Add real Extension Host coverage for visible-only initialization, background exclusion, retained-model reopen, and split tabs; verify `pnpm test:e2e` and the standard validation set pass.
- [x] 7.7 Decompose the editor mediator without behavior changes: extract `RuntimeRegistry`, `AnalysisScheduler` with a named `mutationQueue`, and per-project `ProjectRuntime` execution/acceptance. Simplify routing/change branches, use Iterator Helpers for lazy reductions/queries while retaining deliberate diagnostic array snapshots, and keep `idle()` promise-driven without artificial delays. Mark `SpawnedProjectRouter` as a primitive pre-#25 fallback and add a Mermaid class diagram to the extension package guide. Verify existing coordinator-race and real Extension Host suites plus the standard validation set pass.

## 8. Measurements and status documentation

- [x] 8.1 Add and run `probes/host-policy-performance.mjs` through the public instrumented API for serial cold/warm eager/lazy operations, overlay update/removal, memory, request, byte, server/transport, and node metrics. Verify the documented command reproduces the emitted measurements and cleans up native processes.
- [x] 8.2 Create `docs/performance.md` with environment, fixture revision, repeated-run spread, preliminary non-gating budgets, and measurement limitations; update README, architecture, parity, and research status so implemented host policies are distinguished from native cancellation, pipe integration, template features, and #26 representative-performance/adaptive-memory work. Document analysis/logging settings, normal-mode zero-instrumentation guarantees, logical versus shared/native memory attribution, native-preview's open-file liveness cleanup without a numerical LRU limit, and spawned-fallback limitations. Verify all modified claims link to executable evidence.

## 9. Integrated validation

- [x] 9.1 Run `pnpm exec openspec validate add-analysis-host-policies --strict`, `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, and the full `pnpm test`; map every delta scenario to its named engine/core/probe/Extension Host evidence and verify no unrelated regressions or generated artifacts remain.

## Workflow follow-up

- After review and acceptance, update issue #22 with verified acceptance evidence while retaining links to #25/#26 for their remaining scopes.
- Sync and archive the change only after implementation and validation are accepted; verify the archived result.
