# Design

## Context

See proposal.md - Why and `docs/research/2026-11-14-typescript-7-component-discovery.md` for the verified runtime matrix. This change creates a separate discovery package without adding analyzer-core registry contracts or changing the placeholder `analyzer-ts7` provider.

## Goals / Non-Goals

**Goals:**

- Return serializable discovery records backed by real TS7 semantics.
- Make JavaScript inclusion deterministic through explicit roots rather than depth-dependent partial analysis.
- Preserve declaration authority, snapshot isolation, and lazy/incremental updates by construction.
- Exercise the actual probe scenarios through the public discovery API.

**Non-Goals:**

- CEM manifest import/export, component registry indexes, template extraction, or user-facing binding diagnostics.
- Validation that JavaScript implementations match declarations.
- Dependency render analysis, dependency-source language features, or arbitrary package scanning.
- A general host session, transport, cancellation, caching service, or VS Code integration.

## Decisions

### Keep the engine in an independently extractable package

Create `packages/cem-analyzer-ts7` as private package `@ts7-lit-analyzer/cem-analyzer-ts7`. It will directly declare its TypeScript and CEM schema dependencies and MUST NOT import the analyzer core, host adapters, CLI, editor extension, or other workspace packages. Its configuration, fixtures, public exports, build, and tests remain package-local so the directory can later be extracted or used as upstream backend evidence.

This is a deliberate refinement of the proposed package architecture: the CEM-oriented engine owns its discovery snapshots rather than depending on `analyzer-ts7`. The architecture documents and standalone packaging tests will include the new package. Future host integration may delegate to this engine without moving CEM collection policy into the host adapter.

### Expose a focused disposable discovery session

`cem-analyzer-ts7` will expose an asynchronous factory returning a discovery session. A session owns its TS7 `API`, current snapshot, analysis project, semantic-handle maps, and dependency records. Its public operations collect component records, apply overlays, resolve collected semantics, perform same-scope assignability, and dispose resources.

Public results will compose the complete `custom-elements-manifest` 2.1.0 schema DTOs with stable declaration keys, source ranges, package/project provenance, registration evidence, per-capability completeness, and opaque semantic references. CEM remains the base vocabulary for declarations, members, attributes, events, slots, inheritance, and documentation. TypeScript `Node`, `Symbol`, `Type`, `Program`, `Checker`, and `Snapshot` objects remain private.

A stable declaration key will use canonical real-path module identity plus qualified symbol identity; source ranges are separate evidence and may change across edits. Snapshot-local maps associate semantic references with native handles. A semantic operation validates project and snapshot identity before dereferencing them.

Alternative considered: returning native handles would simplify internal calls but leak TS7 lifecycle and transport details into every consumer.

### Own the collector while reusing CEM knowledge and schema

The engine will not depend on `@custom-elements-manifest/analyzer`: its TS5 AST pipeline would require a second project representation and a later mapping from manifest names/text to live TS7 declarations and types. A single TS7 collector avoids that duplicate linking.

The CEM analyzer remains a reference for successful recognizer behavior, JSDoc forms, linking phases, and fixture scenarios. Any copied implementation or assets require explicit license review and attribution; no code copying is assumed by this change. The schema package is reused directly rather than defining parallel component interfaces.

Searches of CEM issues and PRs on 2026-11-14 found no TypeScript 7, `typescript-go`, or `tsgo` backend proposal. Adjacent context is [#267 — Update to TypeScript 5.5](https://github.com/open-wc/custom-elements-manifest/issues/267), [#172 — Symlinks provided as globs are not working](https://github.com/open-wc/custom-elements-manifest/issues/172), and [#295 — IDE/template type-checking question](https://github.com/open-wc/custom-elements-manifest/issues/295). These links inform compatibility and future upstream discussion; they are not evidence of an existing TS7 effort or maintainer endorsement.

Alternative considered: using CEM analyzer as the primary collector would reuse more existing code but lose one-snapshot semantic identity and complicate unsaved/incremental TS7 analysis. Performance claims against TS5 require a separate benchmark and are not part of this design's evidence.

### Use explicit caller or consumer-import inputs

The engine supports two input modes:

- Standalone/one-shot: the caller supplies source or package entrypoints. The engine does not infer additional public roots for an arbitrary package.
- Consumer-project: the selected TypeScript configuration supplies project files, and dependency entrypoints come only from imports actually reached from those files.

In both modes, TS7 module resolution follows the imports, exports, re-exports, and heritage dependencies required for public semantics. Required modules are added as explicit roots, including relative internal files, transitive packages, CommonJS entrypoints, and real-path targets of symlinks. Unreferenced packages are never seeds.

The derived analysis configuration enables `allowJs`, disables `checkJs`, and avoids reliance on `maxNodeModuleJsDepth`. Project TypeScript is the primary source mode; project JavaScript is accepted as second-class input, while complete JavaScript/JSDoc dependency handling is required because consumers do not control dependency authoring.

A module may be present in the program to make checker semantics available without being inspected for render content or diagnostics. Discovery and language-feature scope are therefore narrower than program inclusion.

Alternative considered: increasing `maxNodeModuleJsDepth` is simpler, but probes show that each relative or package edge consumes depth and partial inclusion silently becomes `any`. Automatically guessing arbitrary package public roots is rejected as ambiguous and unnecessary for these input modes.

### Let the checker own class semantics

The collector will resolve exported aliases with `getAliasedSymbol` and obtain an instance type from the class construct signature's return type. It will use checker base types and property tables for inheritance and members, `getTypeOfSymbolAtLocation` or `getTypeAtLocation` for property/accessor types, and signatures for methods.

`getDeclaredTypeOfSymbol` remains excluded because of the verified anomaly. Type display strings are generated only for presentation and debugging. Assignability uses `checker.isTypeAssignableTo` with source and target handles from the same analysis project and snapshot.

Alternative considered: walking `extends` and class members manually would duplicate checker behavior and fail on aliases, JavaScript, accessors, mixins, and instantiated base types.

### Treat declarations as authoritative, not as counterparts to validate

When a declaration module exists, all public class shape, inheritance, member, signature, and type facts come from declarations. JavaScript is inspected only for supported registration and framework configuration that declarations cannot express.

JavaScript metadata may be associated with declaration-backed classes or members through public export/tag identity, but the engine does not compare shape, exports, inheritance, or types. Extra or differing implementation members do not create public semantic members or conflicts. Missing implementation exports do not invalidate declaration-backed records.

When no declaration exists, the same collector uses JavaScript/JSDoc checker semantics. A declaration-only package needs no implementation root for public class semantics, although a registration entrypoint may still be discovered when available.

Alternative considered: bidirectional consistency checking would add noise for a TS-first analyzer and is explicitly outside scope.

### Use framework strategies over checker-owned semantics

The engine will define a framework collection strategy contract for recognizing registrations, framework configuration, and documentation evidence. Built-in strategies are:

- Vanilla: checker-confirmed `HTMLElement` inheritance, literal `customElements.define`, direct `new CustomElementRegistry()` plus `registry.define`, `HTMLElementTagNameMap`, static literal `observedAttributes`, public fields/accessors, and supported event evidence.
- Lit: checker-confirmed `LitElement` identity from both `lit` and legacy `lit-element`, custom-element/reactive decorators, compiled `__decorate`, and static reactive-property configuration.

Strategies may apply together: Lit components also receive applicable vanilla evidence. Registration evidence distinguishes global and custom registries and retains a custom registry's declaration identity; only direct constructor-bound registry variables are recognized, without arbitrary data-flow tracking. Strategies do not resolve inheritance or types independently, and unsupported frameworks produce explicit limitations rather than fallback semantics. Only built-in strategies are loaded in this change; arbitrary runtime plugin execution is excluded. Final component results contain registered or explicitly `@tag`-documented custom elements; unregistered base classes contribute inherited semantics and metadata without becoming standalone component records.

### Parse the complete CEM-compatible JSDoc surface

JSDoc recognizers will support the aliases and placement represented by CEM analyzer fixtures:

- `@attr`/`@attribute`, `@prop`/`@property`, `@default`, and `@reflect` on public member declarations, including constructor-assigned fields and accessors;
- `@part`/`@csspart`, `@slot`, `@cssprop`/`@cssproperty`, and `@cssState` on component classes;
- `@fires`/`@event` on classes and supported adjacent `@type` documentation on event dispatches;
- `@tag`/`@tagname` and `@summary` on classes;
- `@internal`/`@ignore` to omit implementation members from public metadata.

The CEM example supplied during design will become a fixture using legacy `lit-element`, class/member documentation, constructor fields, accessors, and inline event evidence. CSS custom properties, parts, and slots come from JSDoc rather than `static styles` or `render`. Non-component exported variables from that example remain outside component discovery. Dependency render methods are never visited, and manifest reading or project template-derived metadata belongs to later changes.

### Track completeness per semantic capability

Each record will separate registration, class/member semantics, reactive attributes, events, slots, and CSS metadata. Module inclusion and resolution are checked explicitly before accepting a type. Error types and implicit `any` produce member-level incompleteness; explicit `any` remains valid. Missing optional slot, event, or CSS documentation has no effect on member/type completeness.

The engine will not use dependency diagnostics as a completeness signal because the derived configuration disables `checkJs`. An unresolved module or excluded semantic file is incomplete even when TypeScript emits no diagnostic and displays `any`.

### Update through overlays with graph and record reuse

Applying an overlay will call TS7 `snapshot.update` with an in-memory filesystem layer and produce a new discovery generation. The successor module graph will retain unchanged per-file resolution edges and provenance, re-resolve changed importers and newly reachable modules, and remove modules that are no longer reachable from the configured roots. Newly reachable modules must be collected even when their classes are not re-exported by the changed importer.

External dependency edges will record the consumer-facing and canonical package manifests used during resolution. An unchanged importer will be re-resolved when one of those inputs changes. Unresolved edges will be retried after every non-empty overlay update because a newly created file can make them resolvable without any importer edit. These resolution-input dependencies prevent stale targets and stale `unresolved-module` issues while preserving reuse for edges whose inputs are unchanged.

Affectedness will follow both semantic dependencies and component evidence. Reverse import and declaration/implementation edges invalidate dependent semantics as before. Changed registration, tag-map, decorator, or compiled-decorator evidence also invalidates the referenced class declaration in either direction: a new registration must collect a previously unregistered class, while removed evidence must remove or update the former component. The global metadata merge remains the correctness authority for cross-file evidence; incremental collection determines which candidate class records require enrichment.

Unchanged component records retain their objects and stable declaration keys. Native handles remain in snapshot-local maps and are never transferred. Semantic types for unaffected records are resolved in the successor only when requested. The previous snapshot remains queryable until disposed, allowing stale-result protection and old/new verification. Disposal releases both current and retained native resources according to session ownership.

Graph-level reuse avoids repeating host-side module resolution for unchanged files. It does not claim that the TypeScript 7 program update itself is O(change), and it does not introduce scoped roots, editor scheduling, cancellation, or on-demand DTO materialization. Those interactive-host policies remain follow-up work.

Every result has fresh snapshot-level source provenance: `containsOverlays` and canonical `overlayFiles`. This applies equally to incremental and one-shot collection and does not include overlay text. Result-level provenance is rebuilt for each snapshot even when component records are structurally shared.

Alternative considered: rebuilding the complete module graph and every semantic reference would be simpler but violates the agreed incremental update model.

### Separate package tests from shared host fixtures

Most coverage will remain package-local `node:test` suites using small in-memory TS7 projects. Strategy, recognizer, JSDoc, declaration, module-resolution, completeness, invalidation, and failure-matrix tests will not require the shared demo project or an editor/CLI host. Package-local helpers and fixtures keep the engine independently extractable.

A shared `tests/fixtures/webcomponents` project will contain local vanilla, current/legacy Lit, JS-only, declaration-only, and dual-package components plus simple, composed, and Material Web consumers with an isolated frozen lockfile. It will be reused by future CLI and VS Code integration tests rather than duplicated inside the collector package.

Root `tests/discovery-integration.test.ts` will exercise only representative public-API scenarios against the shared project, including Material Web 2.5.0 `MdDialog` declaration-backed `noFocusTrap: boolean` and JavaScript-supplied `no-focus-trap` metadata without manifest/render analysis. The recognizer matrix will not be moved into cross-host or e2e tests. Standalone packaging remains a separate verification layer.

The research document will be updated to replace declaration/implementation conflict language with declaration authority. User-facing status documentation will describe only the discovery engine actually covered by tests.

## Risks / Trade-offs

- [JavaScript metadata disagrees with declarations] → Return declaration semantics and retain metadata provenance; do not attempt consistency validation.
- [Implicit `any` hides missing inclusion] → Verify the semantic module closure explicitly and test silent unresolved-reexport cases.
- [Stable declaration keys shift during edits] → Use canonical module and qualified symbol identity rather than source offsets; treat offsets only as evidence.
- [Retained snapshots consume native memory] → Make ownership/disposal explicit and test cleanup of current and retained snapshots.
- [Focused decorator recognizers do not cover arbitrary framework code] → Mark unsupported forms and avoid expanding into a parallel semantic analyzer.
