# Performance measurements

This document records a small, reproducible baseline for the host policies in [#22](https://github.com/shining-mind/ts7-lit-analyzer/issues/22). It is not a representative-project certification or a CI performance gate; that work remains in [#26](https://github.com/shining-mind/ts7-lit-analyzer/issues/26).

## Reproduce

From the repository root, using the pinned Node.js and pnpm versions:

```sh
pnpm --dir tests/fixtures/webcomponents install --frozen-lockfile
pnpm build
node probes/host-policy-performance.mjs --runs=3
```

The probe uses only the public `@ts7-lit-analyzer/analyzer-core` session API. It runs eager and lazy scenarios serially and emits JSON containing the environment, fixture revision and status, every operation sample, and min/median/max/mean wall-time summaries. `--runs=N` accepts an integer from 1 to 20. The default is three runs.

Each instrumented operation resets public TypeScript timing, retrieves a baseline, measures wall time with `performance.now()`, and differences the public timing totals around the operation. The report includes request counts, round-trip/server/transport time, IPC bytes, fetched/materialized node counts, process memory, and matching native-process RSS. Session creation has wall-time and memory samples only because its timing API is not available until creation finishes.

The probe checks semantic results rather than timing empty calls. It also tracks newly appearing `tsc --api --async` PIDs and fails if any owned PID remains after `dispose()`. All six eager/lazy scenarios in the reported run ended with `remainingOwnedNativePids: []`.

## Environment and fixture

The measurements below come from three consecutive runs on 2026-11-18 UTC:

- Node.js `v26.12.1`, TypeScript `7.1.0-beta`.
- macOS on arm64, Apple M4 Pro, 14 logical CPUs, 48 GiB RAM.
- `tests/fixtures/webcomponents` at revision `3e6989e8e1bee8d6ad38401dccbf016c9b09fc8a`, with a clean fixture working tree.
- One retained snapshot, one session at a time, no concurrent benchmark operations.
- The overlay changes `src/current-lit-element.ts` in memory and then removes it; the fixture on disk is not edited.

The warm-cache and member-type results describe this fixture and operation sequence. They are not claims about every component or project shape.

## Wall-time spread

Values are milliseconds across three runs.

| Operation                                |     Min |  Median |     Max |
| ---------------------------------------- | ------: | ------: | ------: |
| Eager create session                     | 135.634 | 137.847 | 165.004 |
| Eager cold collect                       | 723.348 | 745.545 | 786.596 |
| Eager warm cached collect                |   0.035 |   0.071 |   0.073 |
| Eager member type from collected record  |   0.039 |   0.105 |   0.119 |
| Eager overlay update                     | 146.086 | 154.656 | 156.048 |
| Eager overlay removal                    | 213.123 | 216.561 | 219.836 |
| Lazy create session (configuration only) |  26.099 |  27.368 |  28.282 |
| Lazy cold scoped collect                 | 282.625 | 290.989 | 293.527 |
| Lazy warm cached collect                 |   0.068 |   0.087 |   0.091 |
| Lazy warm repeated scope collection      |  37.482 |  40.529 |  40.674 |
| Lazy cold enrichment of one component    | 250.282 | 252.507 | 253.586 |
| Lazy first member-type query             |   0.739 |   0.866 |   0.946 |
| Lazy repeated member-type query          |   0.648 |   0.714 |   0.751 |
| Lazy materialize enriched types          |   5.818 |   5.990 |   6.569 |
| Lazy overlay update                      | 147.463 | 153.378 | 155.856 |
| Lazy overlay removal                     | 221.775 | 224.190 | 224.481 |

Warm cached `collect()` made zero operation requests in both modes. A repeated lazy `collectScope()` is not the same cache path: it still builds a successor snapshot and assembled view. Likewise, a repeated lazy member-type query still delegates to the checker; it is not a memoized string lookup.

Overlay removal restores disk-backed content from a fresh program snapshot. The disk-backed project-reference regression in `packages/cem-analyzer-ts7/test/project-references.test.ts` shows why removal must not reuse the previous native snapshot: on the pinned TypeScript version, successive disk overlays followed by removal could leave the removed overlay's source text in the incremental snapshot. The additional requests and latency in the removal rows are therefore intentional correctness trade-offs, not a claim that removal is incremental.

## IPC and node measurements

The request counts were stable across the three runs. Received bytes are maximum observed values; MiB means 2^20 bytes.

| Operation                           | Requests |    Received | Materialized nodes |
| ----------------------------------- | -------: | ----------: | -----------------: |
| Eager cold collect                  |    6,595 |   30.42 MiB |                801 |
| Eager overlay update                |    1,041 |    3.58 MiB |                 49 |
| Eager overlay removal               |    1,439 |    6.01 MiB |                  0 |
| Lazy cold scoped collect            |    1,353 |   16.55 MiB |             37,030 |
| Lazy warm repeated scope collection |       31 |    0.32 MiB |                  0 |
| Lazy cold enrichment                |    2,441 |    4.43 MiB |                498 |
| Lazy member-type query, either call |        5 | 1,439 bytes |                  0 |
| Lazy materialize enriched types     |       58 |   15.45 KiB |                  0 |
| Lazy overlay update                 |      931 |    3.78 MiB |                 49 |
| Lazy overlay removal                |    1,327 |    5.76 MiB |                  0 |

Retrieving timing itself performs protocol requests. Reset and baseline retrieval precede each measured operation, and the emitted values are deltas between the baseline and post-operation public snapshots. Consequently, zero requests for warm cached collection describes the operation delta, not an absence of instrumentation traffic overall.

## Memory observations and attribution

The following are absolute post-operation ranges in decimal MB (1,000,000 bytes), not retained-size estimates. Heap values vary with ordinary garbage collection; no GC was forced.

| Point                          | Probe heap used | Matching native RSS |
| ------------------------------ | --------------: | ------------------: |
| Eager after creation           |    19.3–58.3 MB |        86.4–94.5 MB |
| Eager after cold collect       |    30.1–48.2 MB |      161.5–174.0 MB |
| Eager after overlay removal    |    36.1–64.3 MB |      163.1–175.3 MB |
| Lazy after creation            |    36.6–64.9 MB |        52.7–53.5 MB |
| Lazy after cold scoped collect |    29.6–57.2 MB |      176.3–190.5 MB |
| Lazy after overlay removal     |    30.0–63.2 MB |      208.6–209.1 MB |

`process.memoryUsage()` describes the whole probe process, not exact bytes owned by a registry. Native RSS is the aggregate for processes whose command matches `tsc --api --async`; the public spawned client exposes no supported per-session process identity. Process-name matching can include unrelated sessions and must not be used for per-registry attribution in the extension. The isolated probe uses before/after PID differences only to verify its own cleanup.

The extension's verbose/debug logs instead combine logical registry counts and overlay bytes with explicitly labelled shared Extension Host heap/RSS. Normal logging performs none of these measurements. See the registry invariants in `docs/component-registry.md` and the executable logging scenarios in `packages/vscode-extension/src/test/logging.test.ts`.

## Preliminary non-gating budgets

These budgets are deliberately loose regression-detection targets for this exact fixture and environment. They are not CI thresholds, support guarantees, or hardware-independent acceptance criteria.

| Operation group                     | Wall-time budget |       Request budget | Received-byte budget |
| ----------------------------------- | ---------------: | -------------------: | -------------------: |
| Eager cold collect                  |         1,000 ms |                7,000 |               34 MiB |
| Lazy cold scoped collect            |           375 ms |                1,500 |               18 MiB |
| Warm cached collect, either mode    |             5 ms | 0 operation requests |    0 operation bytes |
| Lazy warm repeated scope collection |            75 ms |                   50 |              0.5 MiB |
| Lazy cold enrichment                |           350 ms |                2,600 |                5 MiB |
| Lazy member-type query              |             5 ms |                   10 |                4 KiB |
| Lazy type materialization           |            15 ms |                   75 |               32 KiB |
| Overlay update, either mode         |           250 ms |                1,200 |                5 MiB |
| Overlay removal, either mode        |           350 ms |                1,600 |                7 MiB |

For this fixture, use 100 MB whole-probe heap after cold collection and 256 MB aggregate matching native RSS after any measured operation as preliminary memory observation budgets. These values are intentionally above the observed spread and are not per-registry limits. Representative memory evidence, final budgets, and any adaptive memory-based residency policy remain #26 work.
