# Design

## Context

See proposal.md - Why. The engine in `packages/cem-analyzer-ts7` is a verified batch collector. `session.ts` builds the full module graph during `initialize()` and `collect()` walks every graph module; `discovery.ts` collects full semantics for every exported class, then `metadata.ts` and `strategies/` filter to components. The measured baseline below and `probes/performance.mjs` show the costs: ~4 ms/component collect, 105 classes collected for 9 components on the fixture, O(project) one-file updates dominated by program recreation and the global framework scan. The building blocks for laziness already exist: caller-supplied standalone roots, a per-file `SemanticCollector.collectSourceFile`, structural sharing, lazy successor handles, and graph-level edge reuse with resolution-input invalidation. This change adds scope and eagerness control around those blocks without forking the pipeline.

Constraints carried from the project: the checker remains the sole source of class/member/type semantics; declaration authority, snapshot isolation, and the same-project/snapshot assignability invariant are unchanged; unknown or unqueried information is `not-collected`, never a successful check; the package stays independently extractable with no workspace-package imports; no new runtime dependencies.

### Measured baseline

`probes/performance.mjs` reproduces these indicative single-run measurements from 2026-11-16 on the shared Material Web fixture; they are a baseline for comparison, not performance budgets.

| Measurement                                 |                             Result |
| ------------------------------------------- | ---------------------------------: |
| Session creation (snapshot + graph)         |                             114 ms |
| Cold `collect()`                            |                             623 ms |
| One-file `update()` after graph-level reuse |                              91 ms |
| Graph construction                          |         57 ms; 4 waves; 84 modules |
| Member semantics before component filtering | 542 ms; 105 classes → 9 components |
| Full framework/JSDoc scan / one-file scan   |                     53 ms / 2.3 ms |
| Warm `getTypeAtPosition` / `isAssignable`   |                  0.08 ms / 0.07 ms |
| Synthetic N=400 collect / one-file update   |                   1576 ms / 368 ms |
| Native RSS after session / after collect    |                     77 MB / 140 MB |

The dominant avoidable cost is collecting full member semantics for every exported class before discarding non-components. Eager DTOs also duplicate inherited member type text, while native RSS remains a project-wide TS7 baseline rather than something registry laziness can remove. Graph-level edge reuse reduces host-side work but does not make the native program update O(change). Cold complex-type materialization is still unmeasured and belongs to task 8.4.

Pre-filter effect (2026-11-17, same probe, single runs): cold fixture `collect()` dropped from ~611–623 ms to ~464 ms (~24%) while the unfiltered member-semantics path still measures ~541 ms over 105 exported classes. The synthetic N=400 case, where every class is a registered component, stays ~1.6 s within run noise because nothing is skipped.

### Lazy measurements

`probes/lazy-performance.mjs` reproduces these indicative single-run measurements from 2026-11-17 on the shared Material Web fixture (consumer mode), after the review rework that added the project-wide index graph. They feed issue #26 and are not performance budgets.

| Measurement                                                   |                       Result |
| ------------------------------------------------------------- | ---------------------------: |
| Lazy session creation (config only)                           |                        26 ms |
| `collect()` before the first scope                            |                0.0 ms; empty |
| Cold `collectScope([consumer.ts])` (index only)               | 216 ms; 8 indexed components |
| Cold narrow `collectScope([current-lit-element.ts])`          | 193 ms; 8 indexed components |
| `enrich([MdDialog])` cold (includes first full-fragment scan) |                        59 ms |
| Cold `getMemberType`: boolean fields / `string \| null` union |          0.4–0.6 ms / 3.4 ms |
| Warm `getMemberType`                                          |                   0.4–0.5 ms |
| `materializeTypes()` cold (MdDialog enriched)                 |                       7.1 ms |
| Scoped single-file `update()`                                 |                        96 ms |
| Scope extension without new index modules                     |                        21 ms |
| Eager `collect()` cold (pre-filtered comparison)              |                       439 ms |
| Native RSS after scoped collection / after eager collect      |            ~150 MB / ~154 MB |

The narrow scope pays for the project-wide index graph (~65 ms over the scoped-only graph) because the index must cover registrations and dependencies reached from out-of-scope roots; the consumer scope already reaches the whole closure, so its cost is unchanged. Native RSS stays at the project-wide TS7 baseline in both modes, as designed: laziness reduces host-side registry work, not native program memory. Cold complex-type materialization is single-digit milliseconds for the fixture's union types; richer generic types remain unmeasured.

## Goals / Non-Goals

**Goals:**

- One session and one collection pipeline with configurable eagerness and scope; eager one-shot behavior and existing public contracts stay byte-for-byte compatible.
- Lazy mode does no graph/collection work before the first scoped request, then collects only what the active scope reaches, growing incrementally.
- A cheap project-wide registration index keeps cross-file registrations and unopened dependency components discoverable without member types.
- Types resolve on demand from the current snapshot; the lazy registry stores identity/evidence/metadata, not eagerly materialized type text.
- A candidate pre-filter removes non-component member collection in both modes while preserving the component set.
- Bounded retention and generation identity are explicit options; defaults are unchanged.

**Non-Goals:**

- Editor scheduling (debounce/throttle/onSave), open-file tracking, cancellation, transport — host policy in `analyzer-ts7`/CLI/extension follow-ups.
- Scoping the TS7 program itself to opened files (breaks global augmentations and cross-file registrations); the program still spans the configured project.
- Analyzer-core registry indexes, template analysis, CLI/editor integration, CEM import/export.
- An O(change) guarantee for the native TS7 program update; host-side work is minimized and measured, not claimed incremental at the native layer.

## Decisions

### One session, an eagerness option, not a second engine

Add an eagerness/scope option to `DiscoveryOptions` (e.g. `eagerness: 'eager' | 'lazy'`, default `eager`) rather than a separate `createLazyDiscoverySession`. The same `DiscoverySessionImpl` owns configuration, snapshots, graph, and semantics; lazy mode changes _when_ and _over what scope_ the existing pipeline runs. Eager mode keeps calling the current `initialize()` → `buildSnapshot()` → `collect()` path unchanged.

Alternative considered: a parallel lazy session class. Rejected — it duplicates the correctness model (declaration authority, completeness, snapshot identity) and the verified incremental defect fixes would need maintaining twice, exactly the divergence the single-engine decision avoids.

### Defer initialization by splitting configuration from scope construction

Split `initialize()` into (a) reading derived configuration/roots metadata and (b) constructing the program snapshot and module graph. Eager mode runs both at creation. Lazy mode runs (a) at creation (cheap; consumer mode still parses the tsconfig for options and the project file set) and defers (b) until the first scoped request. `collect()` in lazy mode requires an active scope; with none it returns an empty result without building a graph.

Alternative considered: a fully deferred session that also defers config parsing. Rejected for consumer mode because the file set and options are needed to know what "project-wide" means for the index; parsing config is not the expensive part.

### Scope is opened files plus component-relevant closure; the program stays project-wide

Lazy mode keeps an `activeScope` set of caller-named files (opened files). Graph construction seeds BFS from `activeScope` instead of all project roots, reusing the existing `buildModuleGraph` closure machinery and edge reuse. The TS7 program still includes the configured project file set so global augmentations, tag maps, and cross-file registrations resolve; laziness applies to the _derived registry_, not the native program. Extending the scope adds roots and reuses unaffected records via the existing structural-sharing path.

Alternative considered: scoping the program to opened files to cut native memory. Rejected — it breaks global augmentations and cross-file registrations and changes project-wide semantics; the measured baseline also shows that native RSS is dominated by libs/checker anyway. Revisit only with the index plus explicit incompleteness for unscanned scope.

The lazy session builds two graphs per snapshot: the scoped collection graph seeded from the active scope, and a project-wide index graph seeded from all project roots. The index graph carries resolution edges and provenance only — no member semantics — so registrations in out-of-scope roots still reach their dependency classes, and indexed entries keep package identity from real resolution rather than path heuristics. Both graphs reuse unchanged edges on updates; member collection stays scoped. An empty accumulated scope constructs neither graph and returns the uninitialized empty result.

### Split strategies into a registration-index pass and an enrichment pass

Factor the built-in strategies so recognizers can run in two depths:

- **Index pass:** syntactic recognition of `define`, `HTMLElementTagNameMap`, decorators/compiled decorators, resolving class _identity_ through the checker (tag → declaration) but not member types. Runs project-wide over the configured file set, producing index entries (declaration identity, tag, registration evidence, framework name) with `not-collected` semantic capabilities.
- **Enrichment pass:** the current full member/attribute/event/JSDoc collection, run per component on demand (lazy) or for all candidates (eager).

The index refreshes on overlays using the same changed-file/affected logic; enrichment is demand-driven. This keeps cross-file and unopened dependency components discoverable without paying member semantics for the whole project.

Alternative considered: reuse `collectFrameworkMetadata` unchanged as the index. Rejected — it already collects member-level framework metadata and would not give the cheap, type-free index the lazy mode needs.

### On-demand types: registry stores metadata, checker resolves types at query time

In lazy mode, enrichment stores identity, evidence, and framework/JSDoc metadata but leaves `type.text` unmaterialized and does not retain per-member handle maps eagerly. A semantic query resolves the member's type from the current snapshot's checker via its evidence position/symbol (`getSymbolAtPosition`/`getTypeOfSymbol`/`getTypeAtPosition`), then materializes text on request. Serialization (CLI/manifest) does one materialization pass. Completeness (implicit-any/error-type) is evaluated at query/enrichment time; unqueried capabilities stay `not-collected`. Assignability continues to use live same-snapshot handles. Eager mode keeps materializing everything so existing contracts and packaging tests are unchanged.

Issued lazy references follow the eager successor rule: after an update, only queries whose enriched record was structurally reused register a successor that re-queries the current snapshot; references of invalidated records are dropped and rejected, so a stale reference never silently acquires the member's new type. Callers re-query affected components after enrichment.

Alternative considered: keep eager type text in lazy mode for simplicity. Rejected — it reintroduces the duplication and inherited-member inflation shown by the measured baseline.

### Candidate pre-filter before member collection, in both modes

Before collecting full member semantics for an exported class, confirm component candidacy through checker-resolved framework inheritance (`HTMLElement`/`LitElement` identity, reusing the strategies' inheritance check). Non-candidates are skipped. This removes the measured 105→9 waste in eager and lazy modes alike. The discovered component set must be identical to unfiltered collection; a regression test asserts equivalence on the fixture and representative in-memory cases.

Alternative considered: filter only in lazy mode. Rejected — the waste is largest in eager collect, and a single pre-filter keeps one correctness model.

### Bounded retention and generation identity as explicit options

Add an optional `retentionBound` (default: current retain-until-dispose behavior) and a monotonically increasing `generation` counter on results alongside `snapshotId`. The host uses `generation` to discard stale results; semantic operations still validate project/snapshot identity. Disposal releases current and retained snapshots per ownership. Defaults preserve verified behavior so existing tests stay green.

Alternative considered: always bound retention. Rejected — it changes the verified default and the old/new verification scenarios; make it opt-in.

### Object design: GRASP responsibilities and GoF patterns

The lazy capabilities are assigned to objects by GRASP responsibility, and the engine moves to OOP where a pattern pays for itself. This is a behavior-preserving structural change gated by the eager-compatibility test (task 1.3) and the full existing suite; no unrelated refactoring of the `jsdoc` or `module-graph` algorithms. Classes stay standard JavaScript (no parameter properties, enums, or namespaces per the source development requirements); public contracts remain additive.

GRASP responsibility assignment:

- **Information Expert.** Framework recognition knowledge stays in the strategies: they already own the `define`, tag-map, and decorator syntax, so the registration-index pass is a strategy operation, not a new scanner in the session or discovery orchestration. Checker semantics stay in the semantic collector. Scope, record reuse, and generation knowledge live in a new `ComponentRegistry`.
- **Creator.** The session creates snapshot state and the registry because it owns configuration and lifecycle; the registry creates and owns indexed entries and enriched records; strategies create framework fragments.
- **Controller.** `DiscoverySessionImpl` remains the single facade for system operations (collect, update, scoped requests, enrichment, semantic queries, disposal). No second controller appears; host policy stays outside the engine.
- **Low Coupling / High Cohesion.** The `createDiscoveryResult` orchestration splits into cohesive collaborators: `RegistrationIndex` (syntactic registration facts), `ComponentRegistry` (records, active scope, structural reuse, generations), the semantic collector (member semantics), and the existing metadata merge. The session depends on interfaces, not on collection internals.
- **Pure Fabrication.** `RegistrationIndex`, `ComponentRegistry`, and `SnapshotRetention` are fabricated coordinators with no domain counterpart; they exist to keep cohesion and remove retention policy from the session.
- **Polymorphism.** `FrameworkStrategy` gains a second, type-free `index` operation alongside full collection. Framework and eagerness are two independent variation axes: the framework selects the strategy, the mode selects the depth. No mode-by-framework class explosion.
- **Indirection / Protected Variations.** The existing `SemanticCollector` interface and opaque `SemanticReference` already insulate the TS7 checker; lazy type resolution reuses that indirection instead of exposing checker handles.

GoF patterns applied or considered:

- **Strategy** (existing): extended with the index depth. The built-in vanilla and Lit strategies become classes implementing `FrameworkStrategy`, which is the scoped OOP transition. An abstract base with a **Template Method** scan skeleton is introduced only if the two depths show real duplication; it is not mandatory.
- **Virtual Proxy**: lazy `type.text`. A lazy record stores evidence plus a resolver; text materializes at query or serialization time. The verified successor handles are already virtual proxies, so the mechanism is reused rather than reinvented.
- **Facade** (existing session) and **Factory Method** (existing `createDiscoverySession` / `createSemanticCollector` creation functions) are preserved.
- Rejected: **Observer** (hosts poll; push scheduling is host policy), **Builder** for results (assembly stays in the registry; revisit only if it grows), **Memento** (the TS7 snapshot already provides isolation), and a second lazy session class (rejected above).

Module layout groups files by domain under `src/`, each directory with an explicit barrel entry mirroring `strategies/`: `session/` (facade, configuration, snapshot factory, retention, lazy query tracking), `semantics/` (collector, handle store, collection helpers, member-type resolver), `registry/` (component registry, registration index), `discovery/` (eager orchestration, metadata merge, JSDoc), and `graph/` (module graph). `contracts.ts` and the package entry stay at the root. Public contracts and entry points are unchanged by this layout.

## Risks / Trade-offs

- [Index and enrichment disagree about a component] → The index links identity only; enrichment and the global metadata merge remain the correctness authority for cross-file evidence (as in the batch engine). Test index/enrichment consistency on cross-file registration and tag-map cases.
- [Lazy mode silently returns incomplete data] → Unenriched and unqueried capabilities are `not-collected`, never complete; serialization materializes from the current snapshot. Test that consumers can distinguish filesystem-only, indexed-only, and enriched results.
- [Pre-filter drops a real component] → Equivalence regression test against unfiltered collection on the fixture and in-memory matrix; candidacy uses checker-resolved identity, not syntax alone.
- [Scoped program semantics break global augmentations] → The program stays project-wide; only the derived registry is scoped. Do not scope the native program in this change.
- [On-demand queries add per-query latency] → Warm checker queries measured ~0.08 ms in the baseline; use batch overloads for multi-member queries. Cold complex-type materialization is unmeasured — record it in the measurement task rather than assuming it is free.
- [Retention bound releases a snapshot a host still references] → Generation identity plus snapshot validation reject stale references; document that a bounded host must re-query rather than hold old handles.
- [Eager compatibility drifts] → Keep the eager path calling the existing functions unchanged; run the full existing suite plus packaging as a gate.

## Migration Plan

Additive only. Existing eager callers and the public contracts are unchanged; lazy behavior is opt-in via the new option. No data migration. Rollback is disabling the option (default eager). Land after `add-ts7-component-discovery` (#27) is archived so the base capability spec exists; this change's delta adds requirements on top.

## Open Questions

- Exact option shape (`eagerness` flag vs a `scope` object) and method names for scoped collect/enrich/extend — settle during implementation against the existing `DiscoverySession` interface without changing the spec'd behavior.
- Whether the index pass needs its own lightweight resolver reuse or can share the module graph's cached edges — measure during implementation; both are host-side and do not affect the spec.
- Cold complex-type materialization cost and any batching budget — answer in the measurement task; feeds #26, does not change the approach.
