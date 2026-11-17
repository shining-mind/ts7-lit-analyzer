# Review: add-component-registry-foundation

Date: 2026-11-17 (resolved 2026-11-17)

## Verdict

**Resolved.** The medium-priority contract violation (renamed re-exports losing consumer-facing export and module provenance) is fixed. No open findings remain.

## Findings

### 1. Medium: Renamed re-exports lose consumer-facing provenance — RESOLVED

**Requirement:** `Dependency identity through exports and re-exports`, especially the `Renamed re-export` scenario in `specs/component-registry/spec.md`.

**Original locations:**

- `packages/cem-analyzer-ts7/src/discovery/discovery.ts`
- `packages/cem-analyzer-ts7/src/semantics/collector.ts`
- `tests/registry-integration.test.ts`

The specification requires a component reached through a renamed re-export to retain its original declaration identity while recording the consumer-facing alias and module provenance.

The shared fixture imports `PublicJsOnlyElement` from `@fixture/reexport`, where it is re-exported as:

```js
export {JsOnlyElement as PublicJsOnlyElement} from '@fixture/js-only';
```

Before the fix, a public-API probe through `createRegistrySession` returned `exportName: "JsOnlyElement"` and `package: "@fixture/js-only"` only. Collection iterated every graph module and kept the first record for each declaration ID, so a later record reached through the re-export could not contribute its alias, and the consumer-facing `@fixture/reexport` module was never recorded. The integration test asserted canonical identity but not the alias or re-export module, so the suite passed despite the missing contract data.

**Resolution:**

- Added an additive `ConsumerProvenance` contract (`exportName`, `module`, optional `package`) and `WebComponentRecord.consumerProvenance`, re-exported by `analyzer-core`. Canonical declaration identity (`declarationEvidence.id`, `fileName`, `package`) remains authoritative and unchanged.
- Eager collection accumulates a provenance entry per consumer-facing module as it visits the graph, merging duplicates by identity (`consumerProvenanceEntry` / `addConsumerProvenance` in `discovery.ts`). Package identity falls back to the canonical real path when a graph module lacks a resolved package name.
- Lazy enrichment accumulates the same provenance through a scoped, candidate-filtered scan of the active scope modules (`collectConsumerProvenance`), so on-demand enrichment retains renamed re-export provenance without eagerly collecting the whole graph.
- Extended the engine renamed-export test (`module-graph.test.ts`) and the root registry integration test (eager and lazy) to assert the renamed public alias and the consumer-facing re-export module/package.

A probe now returns `consumerProvenance` entries including `{exportName: "PublicJsOnlyElement", package: "@fixture/reexport", module: ".../@fixture/reexport/index.js"}` alongside the direct-import paths, while canonical identity stays `JsOnlyElement` / `@fixture/js-only`.

The decision is recorded in `design.md` ("Consumer-facing re-export provenance is accumulated, not deduplicated away") and `docs/component-registry.md`.

## Validation performed

The following checks passed on the resolved working tree:

- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm exec openspec validate add-component-registry-foundation --strict`
- `pnpm test`
  - analyzer-core: 21 tests passed;
  - package discovery: 85 tests passed (including the renamed-export consumer-provenance assertion);
  - root discovery/integration: 7 tests passed;
  - root registry integration: 8 tests passed (eager and lazy renamed re-export provenance asserted);
  - legacy baseline: 162 passed, 3 skipped;
  - standalone packaging: passed;
  - real VS Code Extension Development Host smoke test: passed.

The eager compatibility baseline projection excludes `consumerProvenance` (like `documentationEvidence`); the new field is guarded by the engine and integration tests above.
