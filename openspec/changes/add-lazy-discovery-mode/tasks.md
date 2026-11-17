# Tasks

## 1. Prerequisite and additive contracts

- [x] 1.1 Confirm `add-ts7-component-discovery` (#27) is landed and archived so the `ts7-component-discovery` base spec exists; verify `openspec list --specs` shows the capability before starting implementation.
- [x] 1.2 Add the additive eagerness/scope option, retention bound, and generation field to the public option/result contracts without changing existing eager types; verify `pnpm typecheck` and the existing package suite pass unchanged.
- [x] 1.3 Add an eager-compatibility gate test asserting default-session results are identical to the pre-change contract on the shared fixture; verify it passes before any lazy work lands.

## 2. Deferred initialization and scoped roots

- [x] 2.1 Split configuration reading from program/graph construction in the session so lazy mode defers construction to the first scoped request; verify a test shows no graph/collection work and an empty result before the first request, and eager initialization is unchanged.
- [x] 2.2 Seed graph construction from the active scope (caller-named files) plus component-relevant closure while keeping the program project-wide, with a `ComponentRegistry` owning the scoped records; verify an opened consumer file discovers its imported dependency component without opening the dependency file, and unreferenced packages are excluded.
- [x] 2.3 Implement scope extension in the `ComponentRegistry` that adds roots and reuses unaffected records; verify a test adds a second opened file and asserts structural reuse of prior records and inclusion of newly reached modules in the scoped closure.

## 3. Project-wide registration index

- [x] 3.1 Factor the built-in strategies into classes implementing a type-free `index` operation on `FrameworkStrategy` (define, tag-map, decorators, checker-resolved class identity) separate from member enrichment, with a `RegistrationIndex` owning the entries; verify index entries carry identity/tag/evidence with `not-collected` semantic capabilities and no member types.
- [x] 3.2 Build the index project-wide on the first scoped request and refresh it on overlays; verify tests cover a cross-file registration outside the active scope becoming discoverable, an unopened dependency component indexed, and index add/remove after an overlay.
- [x] 3.3 Assert unenriched index entries never report complete semantics; verify a negative test distinguishes indexed-only from enriched results.

## 4. On-demand enrichment and type resolution

- [x] 4.1 Implement per-component enrichment using the current project/snapshot with per-capability completeness recorded at enrichment time; verify a request returns checker-derived members for one indexed component while unrequested components stay `not-collected`.
- [x] 4.2 Store lazy registry records without eagerly materialized type text and resolve member types from the current snapshot at query time; verify a type query after an overlay reflects the new snapshot and cross-project/snapshot references are rejected.
- [x] 4.3 Implement serialization-time type materialization for CLI/manifest output; verify a serialized lazy result contains current-snapshot type text and eager-mode results remain fully materialized as before.

## 5. Candidate pre-filter

- [x] 5.1 Add checker-confirmed framework-candidacy filtering before full member collection in both modes; verify a non-component exported class is skipped and the fixture collect time drops (record before/after with the probe methodology).
- [x] 5.2 Add an equivalence regression test comparing pre-filtered and unfiltered component records on the shared fixture and representative in-memory cases; verify the discovered component sets are identical.

## 6. Scoped incremental updates

- [x] 6.1 Apply the verified incremental-update, module-graph, and resolution-input guarantees within the active scope; verify an in-scope single-file overlay updates affected records and structurally reuses unaffected in-scope records.
- [x] 6.2 Preserve cross-scope invalidation correctness; verify an out-of-scope base-class overlay updates the dependent in-scope component while unrelated in-scope records are reused, and out-of-scope records are not enriched.

## 7. Bounded retention and generation identity

- [x] 7.1 Implement the optional retention bound through a `SnapshotRetention` policy object with the default retain-until-dispose behavior unchanged; verify a bounded session retains no more previous snapshots than the bound and disposal releases owned resources.
- [x] 7.2 Add monotonically increasing generation identity to results alongside snapshot identity; verify successive updates carry increasing generations and semantic operations still validate project/snapshot independently.

## 8. Integration, packaging, documentation, and validation

- [x] 8.1 Add shared-fixture integration tests exercising scoped lazy discovery through the public API (opened-file scope, dependency component, cross-file registration, on-demand type); verify `pnpm test:discovery` passes both package and integration levels.
- [x] 8.2 Extend the standalone packaging test to import and exercise the new lazy public surface from the packed artifact; verify `pnpm test:packaging` passes without workspace paths or undeclared dependencies.
- [x] 8.3 Update architecture and status documentation to describe only the lazy behavior the tests establish, keeping host scheduling and scoped-program work marked as follow-up; verify no text claims editor integration, cancellation, or O(change) native updates.
- [x] 8.4 Record cold/warm/scoped/update latency and memory measurements (including cold complex-type materialization) using the existing probe methodology and link them to #26; verify the numbers are captured in the change or research docs.
- [x] 8.5 Run strict OpenSpec validation, build, typecheck, lint, format check, and the full root test suite; verify every new requirement scenario is exercised and all checks pass.
- [x] 8.6 Split the oversized semantics and session modules into focused collaborators (handle store, collection helpers, member-type resolver; session configuration, snapshot factory, lazy query tracker) without behavior change; verify the package suite, eager gate, fixture integration, packaging, typecheck, lint, and format check pass.
- [x] 8.7 Group src files into domain directories (session, semantics, registry, discovery, graph) with barrel entries, updating internal, test, and probe imports without behavior change; verify the package suite, fixture tests, packaging, probes, typecheck, lint, and format check pass.

## 9. Review rework (2026-11-17)

- [x] 9.1 Reject stale lazy references of invalidated records and register successors only for structurally reused records; replace the positive cross-type assertion with a negative regression and add reused-record survival checks at package and fixture levels.
- [x] 9.2 Build a project-wide index graph (resolution edges and provenance only) so dependencies reached from out-of-scope roots are indexed with package identity and can be enriched; add the composition regression and keep member collection scoped.
- [x] 9.3 Return the uninitialized empty result when the accumulated scope is empty; add the empty-scope regression followed by a non-empty first scope.
- [x] 9.4 Re-run probes, update recorded measurements and spec/design text, and pass the full validation suite after the rework.

## Workflow follow-up

- Archive the change after the project's review requirements are satisfied and #27 is archived.
- Verify the archived `ts7-component-discovery` spec contains both the batch and lazy requirements.
- Hand the measured budgets to #26 and the host-driver work to #22/#25.
