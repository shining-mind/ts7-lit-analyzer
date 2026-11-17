# Component registry

Status: implemented and tested in `packages/analyzer-core` (registry foundation, issue #21). Template analysis, binding diagnostics, CLI/editor integration, and the optional manifest adapter are separate follow-up work and are not provided by the registry.

## Topology

The registry lives in `analyzer-core`, the host-independent analysis core. It consumes the `cem-analyzer-ts7` discovery engine directly through the engine's public session API; there is no separate TypeScript 7 adapter package. The engine stays independently extractable (no workspace dependencies); the core depends on the engine, not vice versa.

A registry session is **single-project**: one TypeScript configuration, one engine program, snapshots and generations within it. The CLI selects one project per invocation. Multi-project coordination (several open tsconfigs / multi-root workspaces) is an editor concern deferred to the VS Code slice; host policies such as open-file tracking, scheduling, and cancellation are future engine extensions plus host orchestration, not registry responsibilities.

## Adopted contracts

The registry does not define a parallel component model. It re-exports the engine's host-safe contracts: Custom Elements Manifest schema DTOs (`CustomElementDeclaration`, members, attributes, events, slots, CSS metadata) as the extensible base, with separate extensions for project/package/declaration identity, registration evidence, provenance, snapshot-scoped semantic references, and per-capability completeness. Engine records are the registry records; `createRegistryView` indexes them without adaptation or TypeScript AST traversal.

Contracts contain no live TypeScript runtime handles and no Lit-specific fields. A type is carried as an opaque `SemanticReference` (id plus project/snapshot identity), a serializable key into the engine's private handle store; the real `Type`/`Signature` objects stay engine-private. Framework differences appear only in generic evidence and strategy fields, so vanilla and Lit components share one contract shape.

## Lookups and access

`createRegistryView(result)` returns an immutable view exposing:

- `project`, `snapshotId`, `generation`, `containsOverlays`, `overlayFiles`, `issues` — snapshot identity and provenance (no overlay text).
- `components()`, `byTagName(tag)`, `byDeclarationId(id)` — lookup with explicit `undefined` misses. Declaration identity is the canonical real-path module plus qualified symbol name; it is stable across edits (source ranges live in separate evidence and may shift).
- `findMember`, `findProperty`, `findEvent`, `findSlot` — member access.
- `resolveAttribute(record, attributeName)` — attribute-to-property alias resolution (for example `no-focus-trap` → `noFocusTrap`).
- `superclassReference(record)` and `memberDeclaration(record, memberName)` — inheritance references and inherited member origins through declaration evidence.

Applying a successor discovery result produces a new view; unaffected record objects are structurally reused, and the previous view retains its original data.

Each record also carries `consumerProvenance`: the consumer-facing export aliases and modules that reach the declaration (including renamed re-exports), with their package identity. Canonical declaration identity stays authoritative; a component imported both directly and through a renamed re-export retains every consumer-facing path.

## Completeness and unsupported metadata

`capabilityStatus(record, capability)` reports `complete`, `incomplete`, or `not-collected` from the engine's per-capability analysis. Lazy entries that have not been enriched report `not-collected`, never silent completeness. Incomplete semantics (error types, implicit `any`, unresolved modules) surface their issues and are never presented as successful analysis.

`optionalMetadataCoverage(record, capability)` distinguishes `documented` from `undocumented` for optional metadata (events, slots, CSS). Without a manifest, an empty complete capability means the metadata is **undocumented**, not a confirmed absence. For example, Material Web's `MdDialog` documents no `@slot`, so its slot coverage is `undocumented` even though its property semantics are complete.

Unsupported metadata is explicit:

- Slots and events are collected from JSDoc (`@slot`, `@fires`/`@event`, inline event evidence) and inherited from base classes. They are never inferred from dependency `render` implementations.
- The optional Custom Elements Manifest adapter is deferred; source discovery works without a manifest.

## Superclass provenance differs from the CEM analyzer

The CEM analyzer chooses `package` XOR `module` by import specifier form (bare import → `package`, relative/same-file → `module`). The registry instead resolves the base through the checker to its canonical declaration:

- Dependency bases carry the canonical package name **and** the declaration module path, including bases reached through a relative import inside a dependency (for example `MdDialog` → `Dialog` within `@material/web`).
- Local bases in another project module carry module identity without a package name; same-module bases carry the current module path.
- Built-in bases such as `HTMLElement` carry only the class name.

This is schema-valid (the CEM `Reference` shape permits both fields) and intentionally richer than the CEM analyzer's syntactic heuristic; it is required for dependency declaration identity. Class-level JSDoc metadata (events, slots, CSS parts/properties/states, summary) is likewise inherited from checker-resolved base classes with subclass precedence and declaration authority.

## Checker-only semantics

`RegistrySemantics` and the registry session delegate type queries and assignability to the engine using opaque references from one project and snapshot. CEM `type.text` is display documentation only — it is never an assignability input or fallback. `isAssignableToMember` checks against a member's collected reference; a member without a collected reference is incomplete, not a successful check. Cross-project and cross-snapshot references are rejected by the engine.

Display-oriented features (hover, completion) are downstream language features that legitimately consume registry metadata and materialized `type.text`; they are out of scope for the registry foundation. The checker-only constraint applies to assignability and type resolution, not to displaying metadata.

## Verification

- Package-local unit tests in `packages/analyzer-core/test` cover contract adoption, lookups, alias resolution, completeness, view replacement, and semantic delegation with synthetic records and a stub provider (no TS7 sessions).
- Session tests cover lifecycle, overlay successors, same-snapshot assignability, disposal rejection, and lazy `not-collected` pass-through against in-memory projects.
- Root `tests/registry-integration.test.ts` (`pnpm test:registry`) exercises the shared webcomponents fixture: project/dependency lookups, Material Web properties/attributes/inherited events/superclass provenance/undocumented slots, re-export canonical identity through pnpm symlinks, unsaved dependency overlays, assignability, and lazy enrichment.
- Engine inheritance and superclass provenance scenarios are covered by `packages/cem-analyzer-ts7/test/metadata-inheritance.test.ts` and `superclass-provenance.test.ts`.
