# analyzer-core

This package provides the host-independent component registry shared by the CLI and editor hosts. It consumes `cem-analyzer-ts7` through its public session API, indexes the engine's component records, and delegates TypeScript semantics to the engine. It does not collect components independently or access the TypeScript AST.

The registry's identity, completeness, and semantic invariants are described in the [component registry design guide](../../docs/component-registry.md); package boundaries are described in the [architecture guide](../../docs/architecture.md).

## Public surface

The package entry point exports:

- immutable `RegistryView` indexes and lookup helpers;
- checker-backed `RegistrySemantics` over snapshot-scoped semantic references;
- eager and lazy single-project `RegistrySession` interfaces and `createRegistrySession`;
- adopted discovery, component-record, provenance, and overlay contracts from `cem-analyzer-ts7`.

The exported TypeScript declarations are the API reference. This guide does not duplicate individual method signatures.

## Session controls

A session composes discovery results into successive registry views. Multi-project routing, open-file tracking, scheduling, and residency remain host responsibilities.

- Operations accept the engine's host-neutral `DiscoveryOperationOptions`. An aborted operation rejects and leaves the current view usable; cancellation is logical rather than native request termination.
- `removeOverlays` produces a successor view from configured or filesystem content after unsaved overlays are removed.
- Timing is disabled by default. `getTimingInfo` and `resetTimingInfo` forward the engine's serializable diagnostic measurements; the core does not interpret them or create parallel semantic data. Instrumented views also expose `moduleResolutionFallbackCount` for the graph work backing the current result; uninstrumented views omit it. Hosts decide when to enable collection.

## Validation

Package-local unit tests cover registry behavior. `tests/registry-integration.test.ts` exercises the public session against the shared webcomponents fixture, including re-export identity, unsaved dependency overlays, assignability, and lazy enrichment.
