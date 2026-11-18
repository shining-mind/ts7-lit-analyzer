# Component registry

This guide explains the registry's design: its role, the entities it deals in, the invariants it guarantees, and the boundaries it deliberately keeps. It is not an API reference. The callable surface is defined by the exported types in `packages/analyzer-core/src` and the engine contracts it adopts; read those for signatures. This document covers what signatures cannot convey — why the registry exists, what it guarantees, and where it intentionally differs from the Custom Elements Manifest analyzer.

Status: implemented and tested in `analyzer-core` (issue #21). Template analysis, binding diagnostics, host integration, and the optional manifest adapter are separate follow-up work.

## Role

The registry is the host-independent index over the discovery engine's component records, shared by the CLI and editor hosts. It does not collect components or touch the TypeScript AST: the `cem-analyzer-ts7` engine owns discovery and checker semantics, and the core consumes its public session API. There is no separate TypeScript 7 adapter package.

A registry session is **single-project** — one TypeScript configuration, one engine program, snapshots and generations within it. Multi-project coordination and host policies (open-file tracking and scheduling) belong to the hosts; see [architecture](architecture.md). Per-operation cancellation, overlay removal, and diagnostic timing are forwarded through the existing session without adding core semantics.

## Key entities

- **`WebComponentRecord`** — the engine's adopted record: a CEM `CustomElementDeclaration` (members, attributes, events, slots, CSS metadata) composed with separate identity, registration evidence, provenance, semantic references, and per-capability completeness. The registry re-exports these contracts rather than defining a parallel model; engine records are the registry records.
- **`RegistryView`** — an immutable index bound to one project, snapshot, and generation. Applying a successor discovery result yields a new view; unaffected records are structurally reused and the previous view keeps its data.
- **`SemanticReference`** — an opaque, snapshot-scoped key to a checker type. The real `Type`/`Signature` handles stay engine-private; contracts carry only the key plus project/snapshot identity, never live TypeScript objects.
- **`ConsumerProvenance`** — a consumer-facing import path (export alias, module, package) that reaches a declaration. A component imported directly and through renamed re-exports retains every path.

## Invariants

**Canonical identity is authoritative.** Declaration identity uses the canonical real-path module plus qualified symbol name and is stable across edits; source ranges are separate evidence and may shift. Consumer-facing aliases and modules are additive provenance, never a replacement for canonical identity.

**Completeness is explicit, per capability.** Each capability is `complete`, `incomplete`, or `not-collected`. Lazy entries that have not been enriched are `not-collected`, never silently complete; unresolved or error-typed semantics are `incomplete` with their issues, never presented as a successful check. For optional metadata (events, slots, CSS), an empty `complete` capability means **undocumented**, not a confirmed absence — without a manifest, absence cannot be proven. Material Web's `MdDialog`, for example, has complete property semantics but undocumented slots.

**Semantics are checker-only.** Type queries and assignability delegate to the engine through references from one project and snapshot; cross-project and cross-snapshot references are rejected. CEM `type.text` is display documentation, never an assignability input or fallback. Display-oriented features (hover, completion) legitimately consume metadata and materialized text; the checker-only constraint applies to checking, not displaying.

**Operations preserve the last good view on cancellation.** Operation options carry a host-neutral `AbortSignal`. Cancellation is logical: a native request may finish, but an aborted operation rejects without applying its result or committing overlays/scope. The current registry view remains usable; this is not a claim of native in-flight cancellation. Removing an overlay applies a successor view backed by configured or filesystem content and corrected overlay provenance.

**Instrumentation is diagnostic and opt-in.** Timing is disabled by default. Enabled sessions expose serializable TypeScript request, latency, IPC, and materialization metrics plus reset, not checker handles or overlay text. The core forwards these measurements without interpreting them or synthesizing parallel semantic data; editor logging and performance probes decide when to collect them.

## Boundaries and intentional differences

**Superclass provenance is richer than the CEM analyzer.** The CEM analyzer chooses `package` XOR `module` by import-specifier form, so a base imported through a relative specifier inside a dependency loses its package identity. The registry resolves the base through the checker to its canonical declaration: dependency bases carry the canonical package name and declaration module path (including relative imports within a dependency), local bases carry module identity, and built-in bases carry only the class name. This is schema-valid (the CEM `Reference` shape permits both fields) and required for dependency declaration identity; it is a documented compatibility difference, not CEM-identical output. Class-level JSDoc metadata is likewise inherited from checker-resolved base classes with subclass precedence and declaration authority.

**Unsupported metadata is explicit.** Slots and events come from JSDoc and inherited base documentation, never from dependency `render` implementations. The optional Custom Elements Manifest adapter is deferred; source discovery works without a manifest.

## Where to look

The API surface is the exported types in `packages/analyzer-core/src` (`registry`, `semantics`, `session`) and the adopted `cem-analyzer-ts7` contracts. Behavior is covered by package-local unit tests and `tests/registry-integration.test.ts` against the shared webcomponents fixture; engine inheritance and provenance scenarios live in the engine's own tests.
