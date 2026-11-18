# Design

## Context

See proposal.md - Why. The verified discovery engine (`openspec/specs/ts7-component-discovery`) owns discovery-specific TS7 `API` sessions, snapshots, module graphs, checker operations, overlays, and CEM-composed records. Its public API was deliberately designed as the host-safe boundary: serializable DTOs, opaque semantic references, no TypeScript API objects. The analyzer core holds placeholder contracts with a smoke-test workflow; `packages/analyzer-ts7` is an empty placeholder that nothing imports. The shared `tests/fixtures/webcomponents` fixture contains vanilla, current/legacy Lit, js-only, declaration-only, and dual components plus Material Web 2.5.0, with a single `consumer.ts` and no demo pages.

A read-only probe on 2026-11-17 against the built engine and the shared fixture established the gaps this change fixes:

- `MdDialog` reports `events: []` although `@material/web/dialog/internal/dialog.js` and `.d.ts` document `@fires open/opened/close/closed/cancel` on the base `Dialog` class. `mergeComponent` reads class documentation only from the component's own class node; class-level metadata is not inherited.
- `declaration.superclass` is `{name}` only (`collector.ts`), without the package/module provenance the CEM `Reference` shape supports.
- Material Web documents no `@slot`; its slots exist only inside `render`. Under the verified contract they must stay unknown, so slot resolution needs a locally documented fixture.
- Empty events/slots/css are marked capability-complete after merge. That remains correct for "documented-metadata collection finished", but a host-facing registry must not present it as confirmed absence.

Maintainer decisions on 2026-11-17, after reviewing the proposal: dissolve `analyzer-ts7` rather than keep a delegation-only adapter, and rename `packages/analyzer` to `packages/analyzer-core`. Package names were explicitly provisional (README and architecture open questions), so this settles the core name without upstream constraints.

## Goals / Non-Goals

**Goals:**

- A host-neutral registry model in `analyzer-core` that indexes engine records without traversing TypeScript ASTs and without redefining contracts the engine already exposes.
- A package topology that matches reality: one extractable semantics engine, one shared analysis core, two hosts; no pass-through adapter package.
- Engine metadata inheritance and superclass provenance sufficient for the #21 Material Web acceptance criteria, in both eager and lazy modes.
- An intra-session base-documentation link cache that removes redundant base-chain IPC across shared bases and updates, with own-file invalidation and single-flight coalescing, without weakening declaration authority or snapshot identity.
- A concrete base for the rescoped #22: engine host-policy extensions plus host orchestration, not a new provider package.

**Non-Goals:**

- Template extraction, binding diagnostics, or any analysis of the demo pages' `html` content (#23, #5).
- Host policies themselves: project references, cancellation, open-file tracking, scheduling, timing (#22 and later).
- Manifest import/export (#6), registry persistence, or cross-session caching. The base-documentation cache is intra-session (owned by one discovery session, reused across its snapshots), not cross-session.
- Renaming the CLI or extension packages; their names are accurate. Changing engine capability semantics for empty optional metadata; the distinction is surfaced by the registry.

## Decisions

### Dissolve analyzer-ts7; the core consumes the engine directly

The original architecture assigned `analyzer-ts7` "TS7 projects, sessions, snapshots, module resolution, project references, and checker operations". The engine now owns discovery-specific instances of all of those, and its public session API (`collect`, `collectScope`, `enrich`, `update`, `getTypeAtPosition`, `getMemberType`, `isAssignable`, `dispose`) already is the narrow semantic interface the core needs. Keeping a separate adapter would re-declare an existing boundary and add a pass-through package.

Revised topology:

- `analyzer-core`: host-independent contracts (adopted from the engine), the single-project registry model and session, and later templates/rules/language-feature results. No CLI or editor dependencies; host policies such as open-file tracking, scheduling, and multi-project routing stay in the hosts.
- `cem-analyzer-ts7`: all discovery semantics and TS7 sessions/snapshots/checker operations. No workspace dependencies; independently extractable. The core depends on the engine, not vice versa, so extraction is unaffected.
- `analyzer-cli`, `vscode-extension`: hosts consuming the core.

Accepted trade-off: the core gains a transitive TS7 runtime dependency. Every real core consumer (CLI, extension) carries TS7 anyway, and no second backend is planned; a TS-free core would only serve a hypothetical backend swap while costing mirrored contracts and an adapter layer today. Core logic that does not need semantics (registry indexing, later template parsing) remains testable with synthetic records without creating TS7 sessions.

Alternatives considered: keeping `analyzer-ts7` as a composition/driver layer with mirrored core contracts (the initial proposal) duplicates the host-safe boundary the engine already built; moving host policies into the engine would break its extractable discovery scope; a shared contracts package becomes unnecessary once the core adopts the engine contracts directly.

### Rename analyzer to analyzer-core

`packages/analyzer` becomes `packages/analyzer-core`, package `@ts7-lit-analyzer/analyzer-core`. The name reflects the shared host-independent analysis core (registry, templates, rules, feature results) and stops competing with the engine for the word "analyzer". It matches the "analyzer core" wording already used across docs, issues, and AGENTS.md. Public export names (`analyzerPackageVersion`, shared scenario contracts) are preserved: the rename changes package identity, not the contract vocabulary, and keeps the verified `package-testing` behavior intact.

Mechanical impact, landed as one task group: CLI and extension dependency specifiers and imports; root smoke filter; workspace and packaging package lists; the legacy fixture's core dependency, helper imports, and frozen lockfile; root lockfile; README, both architecture documents, `.agents/docs/tooling.md`, `docs/parity.md`, and the AGENTS.md package description. CLI and extension package names stay unchanged.

### Adopt engine contracts as the host-facing registry API

The core re-exports the engine's contract types (`WebComponentRecord`, `DiscoveryResult`, `MemberSemantics`, evidence/identity/completeness types, `AnalysisCapability`) and discovery option types, and types its registry model directly against them. There is no mirrored DTO layer and no adaptation step: engine records are the registry records. The core declares `@ts7-lit-analyzer/cem-analyzer-ts7` (`workspace:*`) and a direct `custom-elements-manifest` 2.1.0 pin for CEM schema types used in its own signatures. The raw engine session factory is not re-exported; hosts enter through the core registry session, while the engine remains directly accessible for future needs such as CEM generation.

"No live TypeScript handles" does not mean the contracts avoid types: a type is carried as an opaque `SemanticReference` (id plus project/snapshot identity), which is a serializable key into the engine's private snapshot-local handle store, while the real `Type`/`Signature` objects stay engine-private and operations dereference them through the checker. This references types rather than structurally modeling them, so no TypeScript API type is redeclared and the checker remains the sole type authority. Structured type data in a serializable contract, if a later feature needs it (for example attribute literal-union target types), would be a minimal purpose-built DTO and is the deferred #2 target-type question, not part of this change.

The checker-only constraint targets semantic correctness operations — assignability and type resolution — not display. Hover and completion are downstream language features (out of scope here; #23/#25/#10) that consume registry metadata and materialized `type.text` for documentation and item detail, which is exactly what `type.text` is for; they do not perform per-item assignability. Where a feature does check types (diagnostics, or type-compatible completion ranking), it uses checker references, never text. Both display and checking draw from one snapshot, so the registry's snapshot-scoped references and materialized text keep later hover/completion results correct and fresh. Expression completion inside interpolations and event-handler contextual typing remain the deferred #2 target-type/language-service questions.

Alternative considered: core-owned mirrored contracts with compile-time compatibility tests (the initial proposal) preserve a TS-free core but duplicate ~100 lines of already-verified interfaces and create drift risk for no concrete consumer benefit.

### Registry is a thin snapshot-scoped view, not a mutable store

The core model builds indexes (tag name, declaration identity) when a discovery result is applied and exposes lookups, member/attribute/event/slot access, alias resolution, inheritance references, completeness, and issues. `apply(result)` produces a new view bound to the result's project/snapshot/generation; unaffected record objects are structurally reused as the engine already guarantees. Semantic operations call the engine session with the record's references; the core never dereferences handles itself. Hosts discard stale views by generation; semantic staleness is still rejected by project/snapshot validation in the engine.

Empty optional metadata is always surfaced as undocumented/unknown: without a manifest, absence can never be confirmed, so the registry does not need an engine change to distinguish the two. `not-collected` capabilities pass through unchanged from lazy records.

Alternative considered: a mutable registry with incremental index patching would duplicate the engine's invalidation logic and risk stale indexes; view replacement reuses the verified successor model.

### Core registry session; #22 becomes engine extensions plus orchestration

`analyzer-core` exposes a registry session factory that accepts the engine's discovery options, creates the engine session, applies collected results to the registry, and forwards overlay updates, member type queries, assignability, lazy scope/enrichment calls, and disposal. It adds no semantics of its own. Issue #22 will be rescoped to extending engine sessions with host policies (project references, cancellation, timing instrumentation) and adding host orchestration (open-file tracking, scheduling, staleness policy) in the hosts, instead of implementing a provider package. A registry session is single-project by construction, and the CLI selects one project per invocation (matching the legacy CLI), so multi-project coordination is an editor concern (several open tsconfigs / multi-root workspaces) deferred to #25, not a core or CLI requirement. The issue body update is recorded as workflow follow-up.

### Inherit class-level metadata through the checker base chain

The engine's metadata merge will walk checker-resolved base types (already available from `instanceType.getBaseTypes()`), collect class-level documentation from each base's authoritative declaration (declaration-first, consistent with the existing authority rule), and merge events, slots, CSS parts/properties/states, and summary into the derived record with subclass precedence and base-declaration evidence. Heritage modules are already in the semantic closure, so no new inclusion logic is needed. The walk runs wherever metadata merge runs today, covering eager collection and lazy enrichment. Superclass references gain package/module identity from the base declaration's file and the existing package-identity resolution; built-in bases keep name-only references.

Alternative considered: collecting documentation during member collection would mix syntactic JSDoc walking into the checker-semantics collector and duplicate the merge phase; keeping it in the metadata merge preserves the existing separation. Render-derived slots/events remain excluded by construction.

### Cache base documentation as isolated per-class links

The base-chain walk re-resolves and re-collects every base on each collection/enrichment, even when bases are shared (`LitElement`, `@material/web` chains) or unchanged across updates. A synthetic probe (`probes/base-link-cache-scaling.mjs`, dozens of components inheriting `Comp{i} → AppBase → SharedBase → HTMLElement`) measured the price of no cache: naive walk requests grow ~linearly with component count (~9×N round-trips; 239/464/914 at N=25/50/100), dominated by transport while native server time stays nearly constant. The same probe validated the cache design below: a warm walk issues 0 IPC regardless of N, and a real JSDoc edit to the shared base re-resolves exactly one entry (O(1)), propagating to all N merges.

The cache stores, per class declaration identity (`fileName#name`), an **isolated** entry: the class's own `ClassDocumentationFragment` (plain serializable JSDoc data) plus a **base-link held as declaration identity** — not the base's data and not a merged subtree. `collectBaseDocumentation` follows cached links (`component → base → base …`) and the merge re-runs each time (cheap CPU). Because an entry embeds only a link to its base, it depends on its own file alone: editing a base evicts only that base's entry, subclasses keep their links and read the fresh base data at merge time. This is what makes invalidation own-file and O(1) rather than inheritance-closure and O(N).

Concurrency is handled by **single-flight coalescing**: the cache stores in-flight promises, published synchronously before the first `await`, so N concurrent misses on the same base await one resolution rather than issuing N IPC requests. In-flight promises are tagged with their generation and only same-generation requests coalesce, so a fresh caller never joins a stale-generation resolution started after a snapshot change. (The TS7 async client batches concurrent requests into one transport round-trip but still computes each sub-request natively, so coalescing must happen at the cache layer, not rely on batching.) Entries are versioned two ways: a per-key epoch bumped by `invalidate` (which also drops the stale in-flight promise so the next resolve starts fresh), and a global snapshot generation bumped on a snapshot change (which also drops in-flight promises). A resolution is cached only while both its captured epoch and generation are unchanged, so a resolution completing after invalidation — or captured against a superseded snapshot — is discarded rather than cached as fresh; a failed resolution evicts its promise so a later request can retry. This satisfies the source-development rule to cache only within valid project/snapshot boundaries and handle invalidation, stale results, and cancellation explicitly.

Checker operations always run on the current snapshot. A cache miss always re-resolves from the live component declaration down the chain on the current snapshot, which works for non-exported bases unlike a name lookup; no separate live-declaration cache is kept, so a late old-snapshot resolution cannot restore a stale declaration for a later miss to trust. Each walk captures the cache's snapshot generation up front, so even resolutions that an old walk starts after the snapshot change carry the superseded generation and never cache. The cache is **intra-session**: the discovery session owns it, reuses it across its snapshots, and discards it on disposal. Cross-session caching and registry persistence remain non-goals. The cache is threaded through `mergeComponentMetadata` (via the metadata context) so both eager collection and lazy enrichment use it; the session invalidates it from the same `changedFiles` signal that drives module-graph and registry invalidation.

Known edge case: a declaration-authority flip of the immediate base (a `.d.ts` appearing/disappearing) changes the base's identity, so a cached link to it can go stale even when the subclass file is unchanged. The common case (editing a base's JSDoc/members) keeps identity stable and needs only own-file invalidation; the authority flip is handled through the module graph's resolution-input signal and documented as a limitation where it cannot be cheaply detected.

Alternatives considered: a merged-subtree cache (memoize a base's whole inherited chain) saves the same IPC but embeds descendant data in every entry, so a base edit evicts all dependents — O(N) invalidation, the opposite of the goal. A snapshot-scoped-only cache is trivially correct but discards reuse on every update, losing the cross-update O(1) win. A naive completed-entry cache (check → resolve → set) stampedes under concurrent misses: N parallel walks all issue real IPC before the first entry lands.

### Superclass provenance is checker-resolved, intentionally richer than CEM

The CEM analyzer builds superclass references in `handleHeritage` via `resolveModuleOrPackageSpecifier`, which chooses `package` XOR `module` by the **import specifier form**: a bare specifier yields `{package: importPath}` (the full specifier, possibly with a subpath), a relative or same-file base yields `{module: path}`, and `HTMLElement` has its `module` deleted. This is a syntactic heuristic: a base imported through a relative specifier _inside_ a dependency package (the `MdDialog` → `Dialog` case, `./internal/dialog.js` within `@material/web`) gets only `module` and loses the package identity.

This change resolves the base through the checker to its canonical declaration instead. The reference carries the canonical `PackageIdentity.name` when the base belongs to a dependency package and the declaration module path when it belongs to another module; dependency bases carry both, local bases carry module only, same-module bases carry the current module path, and built-in bases carry only the class name. This is consistent with the engine's verified canonical-identity/provenance model and is required for the #21 `MdDialog` declaration-identity acceptance criterion, which the CEM heuristic would not satisfy.

The divergence is schema-valid: the CEM `Reference` shape (`{name, package?, module?}`) permits both fields together, and CEM consumers apply inheritance by matching superclass names, so `package`/`module` are informational. It is recorded as an intentional compatibility difference in the registry limitations document rather than claimed as CEM-identical output. Alternative considered: mirroring CEM's specifier-form XOR convention would match its output shape but drop package identity for relatively-imported dependency bases and weaken the acceptance criteria.

### Consumer-facing re-export provenance is accumulated, not deduplicated away

A component can be reached through several consumer-facing paths (a direct import and one or more renamed re-exports). Collection iterates graph modules and keeps one record per canonical declaration ID, so a single `exportName` cannot represent every path. The record therefore carries an additive `consumerProvenance` list: each entry records the consumer-facing `exportName` (the alias as imported), the consumer-facing `module`, and its `package` identity. Canonical declaration identity (`declarationEvidence.id`, `fileName`, `package`) remains authoritative and unchanged.

Eager collection accumulates entries as it visits each module, merging duplicates by identity. Lazy enrichment accumulates them with a scoped, candidate-filtered scan of the active scope modules so on-demand enrichment retains the same provenance without eagerly collecting the whole graph. Package identity falls back to the canonical real path when a graph module lacks a resolved package name. This satisfies the `Renamed re-export` scenario (the alias and re-export module are retained even when a direct import also reaches the declaration) without weakening canonical identity. Alternative considered: preferring the re-export record during deduplication would retain one alias but lose the other paths and the direct-import provenance.

### Fixtures: focused metadata elements, re-export package, and Lit demo pages

Extend `tests/fixtures/webcomponents` with:

- A focused vanilla element and a focused Lit element documenting `@fires`/inline event evidence, `@slot`, `@csspart`, and `@cssprop`, proving framework-neutral metadata resolution without Material Web.
- A local `@fixture/reexport` package re-exporting the js-only component under a renamed export, proving registry identity through re-exports at fixture level.
- `src/pages/simple-page.ts` (one component, property and attribute bindings) and `src/pages/composed-page.ts` (nested `md-dialog` with headline/content/actions slots, a Material Web button, local components, and event handlers), both Lit `html` consumer files imported from `consumer.ts` so they enter the program closure. They are discovery/registry inputs only; no template analysis is performed or claimed.
- Focused Material Web assertions on `MdDialog`: declaration-backed properties and attributes, inherited `@fires` events, superclass `Dialog` with `@material/web` provenance, and explicitly unknown slots.

The fixture lockfile is regenerated once for the new local package and committed; registry dependency versions stay pinned. Alternative considered: plain `.html` pages would not match the Lit-in-TypeScript analysis target; extending only `consumer.ts` would not give #23–#25 reusable page fixtures.

### Test layering

- Core unit tests with synthetic records: contract serializability and neutrality, direct record adoption, lookups and misses, alias resolution, completeness surfacing, view replacement and identity, and a session stub proving assignability receives references rather than `type.text`. These run under the existing analyzer-core smoke workflow without creating TS7 sessions.
- Core session tests: in-memory projects through the engine's standalone mode; lifecycle, overlay updates, disposal rejection, lazy pass-through.
- Root `tests/registry-integration.test.ts` through the core session against the shared fixture: project/dependency lookups, Material Web metadata, re-export identity, unsaved dependency updates, same-snapshot assignability, lazy `not-collected` surfacing. A new root `test:registry` script installs the frozen fixture and runs these tests; the root `test` regex includes it.
- Packaging: remove `analyzer-ts7` from the package list; the standalone consumer imports `analyzer-core` from packed archives and builds a registry view from a discovery result, verifying the rewritten workspace specifier and the CEM dependency. The legacy fixture's renamed core dependency is verified by `test:baseline` with its regenerated frozen lockfile.

### Extension bundle externalizes the core and TypeScript 7

Because the core now consumes the engine, the extension's previous self-contained rolldown bundle would inline the engine and TypeScript's CommonJS vendor code into an ESM output, which fails at runtime (`require` of node builtins in an ESM context). The extension's rolldown config therefore externalizes `vscode`, `@ts7-lit-analyzer/*`, `typescript` and its subpaths, and `node:` builtins; the bundle imports the core at runtime instead of inlining the engine. The packaging test asserts the bundle externalizes the core and does not inline the discovery engine.

The placeholder VSIX is still packaged with `--no-dependencies`, so it is structurally valid but not runtime-complete: bundling the workspace dependencies into a VSIX requires a deploy-based pipeline because `vsce` relies on `npm list --production`, which is incompatible with pnpm's symlink layout. Runtime VSIX dependency packaging (and reliance on the native-preview extension for the TypeScript 7 native server) is deferred to the VS Code slice (#25). The e2e test uses the TypeScript-compiled test output, which resolves workspace dependencies from `node_modules`, so it is unaffected.

## Risks / Trade-offs

- [Core now carries a transitive TS7 runtime dependency] → Accepted: all real consumers carry TS7; semantic-free core logic stays testable with synthetic records; no second backend is planned.
- [Engine API evolution directly affects the core] → The engine contracts are verified and additive-only by policy; integration tests pass real engine records through the core API on every run.
- [Rename churn across consumers, fixtures, and docs] → Landed as one mechanical task group verified by the full suite, including the legacy baseline with its regenerated lockfile.
- [#22 scope drift after the rescope] → The rescoped boundary (engine host policies + core orchestration) is documented in both architecture documents and recorded in the issue body before dispatch.
- [Base-chain documentation walk adds cost] → Bounded by checker base types, runs only during metadata merge/enrichment, and never visits render bodies; lazy mode keeps it per-component. The intra-session link cache removes redundant base resolution across shared bases and updates (probe: warm walk 0 IPC; own-file invalidation O(1)); single-flight coalescing prevents concurrent-miss stampedes.
- [Cache serves stale base documentation after an edit or snapshot change] → Own-file invalidation evicts changed entries; per-key epoch plus snapshot/generation versioning discards in-flight resolutions that complete after invalidation; failed resolutions evict their promise. Declaration-authority flips of the immediate base are the documented edge case, handled via the resolution-input signal where detectable.
- [Inherited metadata duplicates or conflicts with subclass facts] → Subclass precedence plus identity-based deduplication, with explicit precedence tests.
- [Material Web slots stay unknown and look like a failure] → Documented as an unsupported-metadata case; locally documented fixtures prove slot resolution, and the registry surfaces undocumented coverage explicitly.
- [Demo pages imply template support] → Status text and tests state that pages are discovery inputs only; no binding assertions exist in this change.
- [Placeholder VSIX is not runtime-complete] → The bundle externalizes the core/engine, but `--no-dependencies` packaging omits them; `vsce`'s `npm list` dependency collection is incompatible with pnpm. Runtime VSIX dependency packaging and native-preview reliance are deferred to #25; the e2e test uses compiled output that resolves dependencies from `node_modules`.
- [Legacy fixture links the core through the workspace, not `file:`] → A `file:` dependency on `analyzer-core` cannot be frozen: its `workspace:*` engine dependency is unresolvable across workspaces under a frozen lockfile. The fixture instead consumes the core through `workspace:*` with both the core and the engine as members of its own workspace, so `test:baseline` installs with `--frozen-lockfile` and the fixture keeps its separate manifest, lockfile, and supply-chain policy. The fixture no longer exercises `file:` consumption of the core; packed-artifact installation is covered separately by the packaging test. Legacy analysis stays on TypeScript 5.2.2 through `lit-analyzer`.

## Migration Plan

Structural but additive in behavior: rename the core package and update all references; delete the empty `analyzer-ts7` placeholder (no imports exist); engine public contracts and eager/lazy behavior are preserved except for added inherited metadata and superclass provenance fields. Placeholder core exports remain under the new package name. No data or configuration migration; rollback is a revert. Sync and archive only after implementation and validation are accepted.
