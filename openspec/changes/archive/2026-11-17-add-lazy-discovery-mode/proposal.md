# Proposal

## Why

The discovery engine is a verified batch collector: it builds the full module graph eagerly at session creation and collects complete semantics for every exported class in the closure, then filters to components (fixture: 105 classes collected, 9 components kept; ~4 ms per component; one-file updates cost O(project)). The planned VS Code experience needs the opposite shape — no open files means no registry work, opening a file collects what that file reaches, and the registry grows incrementally — while the CLI and future CEM generation keep the one-shot mode. The measured batch-engine baseline (`design.md`, `probes/performance.mjs`) established that the building blocks are right, showed where the costs sit, and supported one engine with configurable scope and eagerness rather than a second pipeline. Tracked by issue [#29](https://github.com/shining-mind/ts7-lit-analyzer/issues/29); blocked by [#27](https://github.com/shining-mind/ts7-lit-analyzer/issues/27).

## What Changes

- Add opt-in lazy/scoped operation to the existing discovery session, preserving eager one-shot behavior and existing public contracts:
  - Deferred initialization: session creation performs no graph or collection work until the first scoped request.
  - Scoped, extendable roots: collection starts from a caller-supplied file subset (opened files) plus its component-relevant import closure; scope extends incrementally without rebuilding unaffected records.
  - Scoped collection and per-component on-demand enrichment instead of whole-graph collection.
- Add a project-wide syntactic registration index (supported `define` calls, `HTMLElementTagNameMap` entries, decorators and compiled decorators; no member types) so cross-file registrations and unopened dependency components remain discoverable; unenriched entries carry explicit `not-collected` capabilities.
- Add on-demand type resolution from the current TS7 snapshot in lazy mode: the registry stores identity, evidence, and framework metadata; `type.text` is materialized at query or serialization time; completeness is evaluated at query time. Eager mode continues to materialize everything.
- Add a candidate pre-filter (checker-confirmed framework inheritance) before full member collection in both modes, preserving the discovered component set.
- Add bounded snapshot retention as an explicit session option and generation identity on results for host-side staleness decisions; default retention behavior stays unchanged.
- Keep host policy out of the engine: no editor scheduling, open-file tracking, cancellation, or transport. Drivers consume these mechanisms from `analyzer-ts7`, the CLI, and the extension in follow-up changes.
- Measure cold/warm/scoped/update latency and memory with the existing probe methodology and document verified limits; make no O(change) claim about the TS7 program update itself.

## Capabilities

### New Capabilities

None.

### Modified Capabilities

- `ts7-component-discovery`: add requirements for deferred and scoped sessions, the registration index, on-demand enrichment and type resolution, the candidate pre-filter, and bounded retention with generation identity. This capability is introduced by the pending `add-ts7-component-discovery` change; the present change is blocked by it and adds requirements on top of its verified behavior.

## Impact

- `packages/cem-analyzer-ts7`: additive session API and options; scoped graph construction and update paths; registration-index scan reusing the built-in strategies' recognizers; on-demand semantic resolution; pre-filtered collection. No dependencies on other workspace packages; the package remains independently extractable.
- Contracts: additive only. Eager-mode results, CEM composition, snapshot-scoped references, and the same-project/snapshot assignability invariant are unchanged. Lazy-mode records may omit materialized type text until queried; consumers must treat `not-collected` as unknown, never as success.
- Tests: package-local in-memory suites for scoping, index freshness, on-demand resolution, pre-filter equivalence, retention, and generations; shared-fixture integration for scoped lazy scenarios; packaging verification of the expanded public surface.
- Documentation: architecture and status text updated only for behavior the tests establish; the measured baseline in `design.md` is design evidence, not a claim of implemented lazy support.
- Dependencies: no new runtime dependencies expected. Blocked by #27; enables #21 (registry), #22 (semantic provider), #25 (VS Code slice); measurements feed #26 (performance budgets).
- Explicitly out of scope: editor scheduling configuration (debounce/throttle/onSave), open-file tracking, cancellation, scoping the TS7 program itself to opened files, analyzer-core registry indexes, template analysis, CLI/editor integration, and CEM manifest import/export.
