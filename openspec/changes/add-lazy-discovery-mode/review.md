# Review: add-lazy-discovery-mode

Date: 2026-11-17

## Verdict

**Accepted after rework.** All three behavioral findings are resolved and covered by regressions. The standalone lazy-discovery test now exits normally, and the full validation suite passes.

## Findings

### 1. High: Lazy successor queries silently change the meaning of old semantic references

**Locations:**

- `packages/cem-analyzer-ts7/src/session/lazy-queries.ts:29`
- `packages/cem-analyzer-ts7/src/semantics/handles.ts:89`
- `packages/cem-analyzer-ts7/test/lazy-discovery.test.ts:209`
- `tests/discovery-lazy-integration.test.ts:136`

`LazyQueryTracker.registerSuccessors` registers every previously issued member-type reference in the successor snapshot. `SemanticHandleStore.resolveOperationHandle` then accepts a reference whose `snapshotId` differs from the current snapshot whenever such a successor exists.

This does not merely reuse a native handle safely: it re-queries the member and treats the resulting current-snapshot type as the old reference. The existing regression demonstrates the semantic error. `count` changes from `number` to `string`, after which the test expects `isAssignable(before.reference, after.reference)` to be `true`. Both operands are resolved as current `string`, although the caller supplied a historical `number` reference. The operation therefore answers a different question and hides the type change.

It also directly violates the delta spec's **Cross-snapshot rejection preserved** scenario, which requires references from another snapshot to be rejected. Eager mode retains the negative test, while lazy mode tests currently codify the incompatible behavior.

**Required direction:** reject stale lazy references and require the caller to re-query, as specified. If transparent successor resolution is intentionally desired instead, it needs an explicit contract/spec revision and a new current-snapshot reference; an old reference must not silently acquire a new type. Add a negative regression for the `number` to `string` transition rather than asserting `true`.

### 2. High: The project-wide index drops dependencies reached only from out-of-scope files

**Locations:**

- `packages/cem-analyzer-ts7/src/session/session.ts:456`
- `packages/cem-analyzer-ts7/src/discovery/metadata.ts:39`
- `packages/cem-analyzer-ts7/src/strategies/vanilla.ts:121`
- `packages/cem-analyzer-ts7/src/strategies/vanilla.ts:192`

The index context contains only `configuration.roots` and modules in the active scoped graph. Consequently, a project root outside the active scope is scanned, but its dependency closure is not. A `customElements.define` in that root can resolve a dependency class through the project-wide checker, while the class declaration itself is absent from `context.sourceFiles`.

The Vanilla strategy then creates a registration-only fragment without adding the `vanilla` framework and removes it through the final `frameworks.includes('vanilla')` filter. The component is absent from the index altogether.

Reproduced through the public API with:

- active scope: `app.ts`;
- out-of-scope project root: `register.ts`, importing `PackageElement` from `package-b` and calling `customElements.define('x-package', PackageElement)`;
- `package-b/index.js`: an `HTMLElement` subclass.

Observed result: only `AppElement`; `x-package` is missing. This violates the **Project-wide registration index** requirement and its cross-file registration/unopened dependency scenarios. The existing tests cover an out-of-scope project class and an in-scope dependency separately, but not their composition.

**Required direction:** build a project-wide index semantic closure independently of member enrichment, or explicitly include declarations referenced by registrations/tag maps in the index context. Keep member collection scoped. Add a regression that indexes and then enriches `PackageElement`, including its package identity and declaration provenance.

### 3. Medium: An empty scope still initializes the snapshot and returns the project index

**Location:** `packages/cem-analyzer-ts7/src/session/session.ts:170`

`collectScope([])` extends the scope by zero files but still follows the first-request path: it builds a snapshot, refreshes the index, and returns indexed components.

Reproduced with one registered project component: the call returned `snapshotId: "snapshot-2"` and `components: ["AppElement"]` instead of remaining uninitialized and empty.

This contradicts the proposal's core lazy behavior that no open files means no registry work. It also does unnecessary work for a natural host transition in which the last open file is closed. `collect()` before any scope has the expected empty behavior, but callers should not need a separate guard around an empty scope update.

**Required direction:** when the accumulated active scope is empty, return the uninitialized empty result without constructing a snapshot or index. Add a regression for `collectScope([])` followed by a non-empty first scope.

## Validation performed

The following existing checks passed on the reviewed working tree:

- `pnpm build`
- `pnpm typecheck`
- `pnpm lint`
- `pnpm format:check`
- `pnpm test`
  - 72 package discovery tests passed;
  - 7 root discovery/integration tests passed;
  - 162 legacy baseline tests passed, 3 skipped;
  - standalone packaging passed;
  - the real VS Code Extension Development Host smoke test passed.
- `pnpm exec openspec validate add-lazy-discovery-mode --type change --strict`
- `git diff --check`

Manual public-API probes reproduced findings 2 and 3. Finding 1 is already demonstrated by the current lazy tests' cross-snapshot assertion. No implementation files were changed during this review.

## Resolution (2026-11-17, rework)

All three findings are fixed in the working tree; behavior is codified in the delta spec and design, and the full validation suite passes again.

### Finding 1 — fixed

`LazyQueryTracker.registerSuccessors` now receives the set of structurally reused enriched records after invalidation. Only queries whose record survived register a successor; queries of invalidated records are dropped, so `SemanticHandleStore` rejects their stale references. This mirrors the eager rule (successors for reused records only) and the delta's cross-snapshot rejection scenario; no contract revision was needed.

- The `number` → `string` transition now asserts rejection of the historical reference at package level (`resolves member types on demand from the current snapshot`) and fixture level (`lazy on-demand types follow declaration overlays on the fixture`, DualElement).
- New positive regressions prove reused-record references survive updates via successors (OrphanElement in the bounded-session test, MdDialog in the fixture test).
- Spec: added `Stale references of invalidated records are rejected` and `Reused record references survive` scenarios under Scoped incremental updates; design records the successor policy.

### Finding 2 — fixed

The lazy session now builds a second, project-wide index graph per snapshot (`SnapshotFactory`, `indexGraphRoots`): resolution edges and provenance only, seeded from all project roots, with unchanged-edge reuse on updates. The registration index and enrichment metadata context use this graph's closure, so a `define` in an out-of-scope root reaches its dependency class, the class file is scanned for framework evidence, and package identity comes from real resolution. Member collection stays scoped; the scoped graph still drives collection-scope issues.

- New regression `indexes dependencies referenced only from out-of-scope roots`: scope `app.ts`, out-of-scope `register.ts` imports and defines `package-b`'s `PackageElement`; asserts indexing, tag, declaration provenance, package identity (`name`, `version`, `realPath`), enrichment, and an on-demand `boolean` query.
- The unreferenced-package scenario now uses a package absent from the whole project import closure; the spec wording was aligned (`absent from the project import closure`), and a new index scenario codifies the out-of-scope-root composition.
- Note: the TS7 resolver returns `packageId` only for manifests with a version; test fixtures now carry versions. The engine records resolution output without path heuristics, matching eager behavior.
- Measured cost: the narrow scope pays ~65 ms for the project-wide index graph (193 ms vs 128 ms) and correctly indexes 8 components instead of 3; the consumer scope is unchanged (~216 ms). Design table and issue #26 updated.

### Finding 3 — fixed

`collectScope` returns the uninitialized empty result when the accumulated active scope is empty, before any snapshot or index construction. New regression `empty scope stays uninitialized` covers `collectScope([])` (empty result, empty `snapshotId`, semantic operations report no scope) followed by a non-empty first scope. Spec: added the `Empty scope stays uninitialized` scenario under Deferred lazy initialization.

### Rework validation

- `pnpm build`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` — pass.
- `node --test --test-reporter=tap packages/cem-analyzer-ts7/test/lazy-discovery.test.ts` — 18 pass, 0 fail; normal TAP summary and process exit in about 2 seconds.
- `pnpm test` — smoke 9; discovery 74 package + 7 root integration (including the eager golden gate and prefilter equivalence); baseline 162 pass / 3 skip; packaging 1; real Extension Development Host e2e 1 — all pass.
- `pnpm exec openspec validate add-lazy-discovery-mode --strict` — valid.
- Both probes re-run from the current tree; recorded measurements updated in design.md and issue #26.
- Test-hygiene fix found during rework: the bounded-session test now disposes via `t.after`, so a failing assertion no longer leaks a native worker and hangs the runner.
