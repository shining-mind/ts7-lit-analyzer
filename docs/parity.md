# Legacy parity baseline

## Purpose

This matrix tracks intended compatibility with `lit-analyzer`, `ts-lit-plugin`, and the `lit-plugin` editor experience. It does not claim that the TS7 implementation already provides these capabilities.

Statuses:

- **verified** — the legacy result and fixture are reproducible in this repository.
- **pending** — the fixture identifier is assigned, but its legacy result has not been recorded.
- **implemented** — the TS7 implementation has its own verified result; none currently has this status.

A verified legacy result is not automatically the desired TS7 behavior. Intentional corrections require TypeScript or Lit semantics and regression fixtures.

## Reproducible baseline

- `lit-analyzer`: 2.0.3
- `ts-lit-plugin`: 2.0.2
- TypeScript used by the legacy fixture: 5.2.2
- Lit used by the fixture: 3.3.2
- Source snapshot used to audit rule IDs and behavior: `runem/lit-analyzer` revision `a518bf7c84ac338a7e8ab3db9dad006c06144426` (2025-08-04).

The isolated fixture in `tests/fixtures/legacy/` has its own manifest and lockfile, so legacy TypeScript does not mix with the workspace's TypeScript 7 installation. It is outside the pnpm workspace. Upstream test cases and assertions are preserved under `src/test/` and run directly as TypeScript with Node 26 and `node:test`, without AVA or a compilation step. The suite covers 210 passing scenarios and 3 upstream skips using the latest supported legacy TypeScript version, 5.2.2.

Run the complete baseline with `pnpm test:baseline`, or include it with all other checks through `pnpm test`. These commands install the fixture with its frozen lockfile before running the Node.js tests. The scenario harness selects its implementation through `ANALYZER_PROVIDER`, which defaults to `legacy`; `src/test/helpers/legacy-provider.test.ts` creates the published legacy analyzer. Shared scenario contracts for configuration, ranges, diagnostics, and code fixes belong to `packages/analyzer` rather than the legacy fixture. Parser and indexer scenarios that intentionally inspect legacy-specific compiler models remain in the legacy adapter. A future TS7 provider can be added behind the same boundary without changing scenario assertions. A passing legacy suite alone does not prove TS7 correctness. To run only the legacy CLI example:

```sh
cd tests/fixtures/legacy
pnpm install --frozen-lockfile
./node_modules/.bin/lit-analyzer src/incompatible-type-binding.ts --strict --format list --noColor
```

The expected result is one `no-incompatible-type-binding` error at line 6, column 3 and exit code 1. The valid binding on line 4 produces no diagnostic.

## Rule matrix

The default severities below come from `DEFAULT_RULES_SEVERITY` at the pinned legacy revision. Each rule has assigned positive and negative fixture identifiers. Only explicitly verified rows have a local baseline result.

| Rule ID                              | Default | Strict  | Fixture IDs                                                 | Legacy baseline                                            |
| ------------------------------------ | ------- | ------- | ----------------------------------------------------------- | ---------------------------------------------------------- |
| `no-boolean-in-attribute-binding`    | error   | error   | `src/test/rules/no-boolean-in-attribute-binding.test.ts`    | verified upstream (node:test)                              |
| `no-complex-attribute-binding`       | error   | error   | `src/test/rules/no-complex-attribute-binding.test.ts`       | verified upstream (node:test)                              |
| `no-expressionless-property-binding` | error   | error   | `src/test/rules/no-expressionless-property-binding.test.ts` | verified upstream (node:test)                              |
| `no-incompatible-property-type`      | warn    | error   | `src/test/rules/no-incompatible-property-type.test.ts`      | verified upstream (node:test)                              |
| `no-incompatible-type-binding`       | error   | error   | `src/incompatible-type-binding.ts`                          | verified: one error at 6:3; valid binding on line 4 passes |
| `no-invalid-attribute-name`          | error   | error   | `src/test/rules/no-invalid-attribute-name.test.ts`          | pending: no upstream rule test                             |
| `no-invalid-boolean-binding`         | error   | error   | `src/test/rules/no-invalid-boolean-binding.test.ts`         | pending: all 3 upstream scenarios are skipped              |
| `no-invalid-css`                     | warn    | error   | `src/test/rules/no-invalid-css.test.ts`                     | pending: no upstream rule test                             |
| `no-invalid-directive-binding`       | error   | error   | `src/test/rules/no-invalid-directive-binding.test.ts`       | verified upstream (node:test)                              |
| `no-invalid-tag-name`                | error   | error   | `src/test/rules/no-invalid-tag-name.test.ts`                | pending: no upstream rule test                             |
| `no-legacy-attribute`                | off     | off     | `src/test/rules/no-legacy-attribute.test.ts`                | verified upstream (node:test)                              |
| `no-missing-element-type-definition` | off     | off     | `src/test/rules/no-missing-element-type-definition.test.ts` | verified upstream (node:test)                              |
| `no-missing-import`                  | off     | warn    | `src/test/rules/no-missing-import.test.ts`                  | verified upstream (node:test)                              |
| `no-noncallable-event-binding`       | error   | error   | `src/test/rules/no-noncallable-event-binding.test.ts`       | verified upstream (node:test)                              |
| `no-nullable-attribute-binding`      | error   | error   | `src/test/rules/no-nullable-attribute-binding.test.ts`      | verified upstream (node:test)                              |
| `no-property-visibility-mismatch`    | off     | warning | `src/test/rules/no-property-visibility-mismatch.test.ts`    | verified upstream (node:test)                              |
| `no-unclosed-tag`                    | warn    | error   | `src/test/rules/no-unclosed-tag.test.ts`                    | verified upstream (node:test)                              |
| `no-unintended-mixed-binding`        | warn    | warn    | `src/test/rules/no-unintended-mixed-binding.test.ts`        | verified upstream (node:test)                              |
| `no-unknown-attribute`               | off     | warn    | `src/test/rules/no-unknown-attribute.test.ts`               | verified upstream (node:test)                              |
| `no-unknown-event`                   | off     | off     | `src/test/rules/no-unknown-event.test.ts`                   | verified upstream (node:test)                              |
| `no-unknown-property`                | off     | warn    | `src/test/rules/no-unknown-property.test.ts`                | verified upstream (node:test)                              |
| `no-unknown-slot`                    | off     | warn    | `src/test/rules/no-unknown-slot.test.ts`                    | verified upstream (node:test)                              |
| `no-unknown-tag-name`                | off     | warn    | `src/test/rules/no-unknown-tag-name.test.ts`                | verified upstream (node:test)                              |

No legacy false positives or false negatives have been catalogued from these local fixtures yet. This is an incomplete audit, not a claim that none exist. Upstream tests at the pinned revision should be used to identify edge cases before recording intentional differences.

## Feature matrix

| Capability                                     | Fixture IDs                                                                                   | Legacy baseline    | TS7 status      |
| ---------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------ | --------------- |
| CLI project and file selection                 | `cli/project-selection/*`                                                                     | pending            | not implemented |
| CLI output formats and exit codes              | `tests/legacy-baseline.test.ts`                                                               | partially verified | not implemented |
| Rule severity, strict mode, and suppression    | `src/test/rules/*`                                                                            | partially verified | not implemented |
| Lit tag recognition and template extraction    | `src/test/parser/html-document/*`, `src/test/indexer/*`                                       | partially verified | not implemented |
| Source maps and edits                          | `templates/source-maps/*`                                                                     | pending            | not implemented |
| Standard and Lit component discovery           | `src/test/indexer/*`, `src/test/parser/dependencies/*`                                        | partially verified | not implemented |
| Property and attribute bindings                | `src/test/rules/*`                                                                            | partially verified | not implemented |
| Boolean, event, content, and element bindings  | `src/test/rules/*`                                                                            | partially verified | not implemented |
| Built-in and user directives                   | `src/test/rules/no-invalid-directive-binding.test.ts`, `no-incompatible-type-binding.test.ts` | partially verified | not implemented |
| Declarations and JavaScript/JSDoc dependencies | `src/test/parser/dependencies/*`                                                              | partially verified | not implemented |
| Optional manifests and stale metadata          | `manifests/*`                                                                                 | pending            | not implemented |
| CSS diagnostics and editor intelligence        | `css/*`                                                                                       | pending            | not implemented |
| Completion, hover, and definition              | `editor/navigation/*`                                                                         | pending            | not implemented |
| Diagnostics, code actions, and fixes           | `src/test/rules/*`, especially `no-missing-import.test.ts`                                    | partially verified | not implemented |
| Rename, formatting, folding, and auto-close    | `editor/editing/*`                                                                            | pending            | not implemented |
| Unsaved buffers and project references         | `editor/snapshots/*`, `project-references/*`                                                  | pending            | not implemented |
| Public indexing API                            | `src/test/indexer/index-entries.test.ts`                                                      | partially verified | not implemented |

Every in-scope entry must receive a verified legacy baseline and an explicit TS7 status before full parity is claimed.
