# TypeScript 7 component discovery and dependency boundaries

**Date:** 2026-11-14  
**Status:** Verified research for the scenarios below. This is not a claim that the registry or adapter is implemented.

## Purpose and conclusions

Issue [#21](https://github.com/shining-mind/ts7-lit-analyzer/issues/21) needs a component registry built on reliable TypeScript 7 semantics. This document extends [TypeScript 7 API and architecture research](./2026-11-13-typescript-7-api.md) with JavaScript dependency, declaration, module-resolution, and unsaved-update probes.

The probes support these design decisions:

- TypeScript 7 owns JavaScript/TypeScript parsing, symbols, aliases, inheritance, members, JSDoc, and semantic types. The project must not build a parallel class or inheritance analyzer.
- JavaScript-only dependencies are supported by the analysis model; declarations are not a mandatory support restriction.
- `allowJs: true` alone is insufficient for dependencies, and a fixed `maxNodeModuleJsDepth` does not guarantee complete inclusion. The adapter must explicitly include the resolved public-API module closure as analysis roots.
- When declarations exist, they are the source of consumer-facing semantic types. JavaScript implementations provide complementary registration and framework metadata, not replacement types.
- Dependencies receive public-API discovery only. Their render functions and embedded templates are not analyzed, and dependency source files do not receive analyzer diagnostics or language features.
- Correct assignability is critical. Slot metadata is optional and comes only from JSDoc `@slot` or an explicit Custom Elements Manifest.
- Stable declaration identity is separate from snapshot-scoped semantic handles. Updates permit structural sharing of unaffected DTOs and lazy type resolution rather than eager reconstruction of all component types.

## Probe environment and common configuration

The probes ran on Node `v26.12.1` with `typescript@7.1.0-beta`, using `API` from `typescript/async` and in-memory filesystems from `typescript/fs`. They used real TS7 programs and checkers; no user modules were executed and no package source files were changed.

Unless a case states otherwise, the analysis configuration was:

```json
{
  "compilerOptions": {
    "allowJs": true,
    "checkJs": false,
    "strict": true,
    "target": "esnext",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": [],
    "skipLibCheck": true
  }
}
```

`maxNodeModuleJsDepth` and root files varied by scenario. Consumer type assertions used a TypeScript source file that imported a component and performed an invalid property assignment.

## Checker-owned class semantics

A raw JavaScript package without declarations contained a `BaseElement`, a `RawElement extends BaseElement`, fields with and without JSDoc, a method, and a literal `customElements.define` call.

With the implementation included in the program, TS7 returned:

```text
instance type: RawElement
base types: BaseElement
mode: "a" | "b"
count: number
label: string
inherited: string
method: (value: any) => any
```

The `mode` union came from JSDoc, `count` and `label` were inferred from initializers, and `inherited` came from the checker-resolved base class. An invalid consumer assignment to `count` produced TS2322 even with `checkJs: false`.

The instance type was obtained from the class constructor signature's return type. Relevant operations include `getAliasedSymbol`, `getTypeOfSymbol`, `getReturnTypeOfSignature`, `getBaseTypes`, `getProperties`, `getPropertyOfType`, `getTypeOfSymbolAtLocation`, and `isTypeAssignableTo`. The previously documented `getDeclaredTypeOfSymbol` anomaly remains a reason to use these alternatives.

Thin syntax recognition is still required for framework facts such as `customElements.define`, decorators, and reactive configuration. Those recognizers must resolve classes and members through the checker rather than creating a separate semantic model.

## JavaScript inclusion depth

### Observed depth behavior

The following table shows which depth was required for the real property type to reach the consumer:

| Dependency shape                                 |       Depth | Included result      | Consumer `count`                    |
| ------------------------------------------------ | ----------: | -------------------- | ----------------------------------- |
| Direct package `index.js`                        | default (0) | No package JS        | `any`, TS7016                       |
| Direct package `index.js`                        |           1 | `index.js`           | `number`, TS2322 for bad assignment |
| Entrypoint plus one relative internal re-export  |           1 | Entrypoint only      | `any`, no consumer diagnostic       |
| Entrypoint plus one relative internal re-export  |           2 | Both files           | `number`, TS2322                    |
| Entrypoint plus two relative internal re-exports |           2 | First two files only | `any`, no consumer diagnostic       |
| Entrypoint plus two relative internal re-exports |           3 | All three files      | `number`, TS2322                    |
| Package A re-exporting package B                 |           1 | A only               | `any`, no consumer diagnostic       |
| Package A re-exporting package B                 |           2 | A and B              | `number`, TS2322                    |
| Package A to B to C                              |      1 or 2 | Partial chain        | `any`, no consumer diagnostic       |
| Package A to B to C                              |           3 | A, B, and C          | `number`, TS2322                    |

Depth therefore counts each included JavaScript module step, including relative imports or re-exports within one package. It is not merely a count of package-to-package transitions. A fixed value such as 1 silently excludes common entrypoint/internal-file layouts and can produce false-negative analysis through `any`.

### Explicit analysis roots

A second matrix kept `maxNodeModuleJsDepth: 0` and supplied selected JavaScript files explicitly through the configuration's `files` list:

| Explicit roots                                               | Included result | Consumer `count` |
| ------------------------------------------------------------ | --------------- | ---------------- |
| Direct package implementation                                | Implementation  | `number`, TS2322 |
| Only the entrypoint of a package with an internal class file | Entrypoint only | `any`            |
| Entrypoint and internal class file                           | Complete pair   | `number`, TS2322 |
| Only package A when it re-exports package B                  | A only          | `any`            |
| Package A and package B implementations                      | Complete pair   | `number`, TS2322 |

Explicitly adding every module required for the public semantic API is therefore independent of the numeric depth limit. The adapter must start from included public entrypoints, use TS7 module resolution for imports, exports, re-exports, and heritage dependencies, and add that closure as analysis roots. Inclusion in the program does not imply that the analyzer will inspect render functions or report diagnostics in those files.

The analysis configuration must be derived without rewriting the consumer's checked-in `tsconfig`. If the analyzer uses a distinct analysis program, both sides of every assignability operation must come from that same analysis project and snapshot.

## Module resolution and package identity

The following cases all resolved the raw JavaScript class and produced `count: number` plus TS2322 for an invalid consumer assignment:

- ESM with package `exports`;
- ESM with `main` and no `exports`;
- CommonJS with a named `exports.RawElement` export;
- a named re-export alias, where `getAliasedSymbol` resolved `PublicElement` back to the original `RawElement` declaration;
- a pnpm-style symlink from `node_modules/package-a` into the virtual `.pnpm` store.

The pnpm program contained the real store path rather than the symlink path. Registry identity must therefore canonicalize through real paths while separately retaining the package specifier and symlink/export provenance used by the consumer.

## Declarations and implementations

### Consumer type precedence

The declaration matrix produced these results:

| Package contents                                         | Program files                             | Consumer type |
| -------------------------------------------------------- | ----------------------------------------- | ------------- |
| `.d.ts` only, declaring `count: string`                  | Declaration                               | `string`      |
| `.d.ts` declaring `string` plus `.js` inferring `number` | Declaration only during normal resolution | `string`      |
| The same pair with `.js` added explicitly as a root      | Declaration and implementation            | `string`      |

TypeScript prefers the declaration for consumer semantics. Explicitly adding the JavaScript implementation does not replace or widen the declaration-backed type. This permits one analysis program to provide declaration types and implementation metadata simultaneously.

Project-owned TypeScript classes also resolved directly through the checker and produced the expected consumer diagnostic. Existing project-reference research verifies source redirection and unsaved cross-reference updates; generated declaration output is not required for that source path.

### Mismatches are registry conflicts

Two deliberate mismatch probes showed that TypeScript does not automatically pair or validate the two views:

- A declaration module exported `RawElement` while the implementation exported `OtherElement`.
- Both exported `RawElement`, but the declaration inherited directly from `HTMLElement` with `count: string`, while the implementation inherited from `BaseElement` with `count: number`.

The consumer continued to use the declaration type in both cases. The adapter must compare resolved export names, canonical declarations, and public inheritance/member shape. A missing or inconsistent counterpart is an explicit conflict or incomplete result, not silently merged metadata.

## Unsaved updates and snapshot isolation

Overlay probes updated the analysis snapshot and then repeated queries on both snapshots:

| Changed file                                                     | New snapshot                                                                      | Retained old snapshot       |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------- | --------------------------- |
| Direct JS implementation, `count: number` to `string`            | Consumer type became `string`; old TS2322 disappeared                             | Stayed `number` with TS2322 |
| Transitive JS implementation in package B                        | Same update through package A's re-export                                         | Stayed unchanged            |
| Declaration side of a `.d.ts` + `.js` pair, `string` to `number` | Consumer type became `number`                                                     | Stayed `string`             |
| JavaScript side of the same pair, `number` to `boolean`          | Implementation view became `boolean`; consumer stayed declaration-backed `string` | Both views stayed unchanged |

Declaration overlays control consumer assignability. Implementation overlays may update registration or framework metadata but must not override declaration types. Native handles remain scoped to their originating snapshot; stable declaration keys provide the basis for lazy resolution in a successor snapshot. Unaffected registry DTOs can be structurally shared without reusing native handles across snapshots.

## `checkJs`, `any`, and unresolved analysis

A JavaScript class with a deliberately mismatched JSDoc annotation, an unannotated field, an explicit `*` field, and an unannotated method produced the same member types with `checkJs` on and off:

```text
count: string
implicitAny: any
explicitAny: any
method: (value: any) => any
```

Consumer checking against `count` produced TS2322 in both modes. Dependency diagnostics differed:

- `checkJs: false`: no dependency diagnostics;
- `checkJs: true`: TS2322 for the JSDoc mismatch, TS7008 for the implicit-any field, and TS7006 for the unannotated method parameter.

Because dependency diagnostics are outside the analyzer's scope, `checkJs: false` is sufficient for extracting public types. It also means dependency diagnostics cannot be used as a completeness signal.

Two failure probes reinforce that rule:

- An unresolved re-export produced consumer `any` with no consumer or dependency diagnostic when `checkJs` was off.
- An unresolved JSDoc type displayed as `MissingType`, had `isErrorType() === true`, and produced no diagnostic when `checkJs` was off.

The adapter must therefore verify module/file inclusion and resolution explicitly, inspect error types, and distinguish implicit `any` from explicit `any`. Explicit `any` is a legitimate checker type; unresolved modules, missing semantic files, implicit-any metadata, and error types must be marked incomplete rather than treated as successful strict analysis.

## Public API boundary for dependencies

### Included for dependencies

- Public package entrypoints, exports, re-exports, registrations, and canonical declarations.
- Public properties, attributes, events, inheritance, documentation, and semantic types needed by consumers.
- Public class inheritance and reactive configuration into base declarations when required to describe the public API.
- Dependency target property types used to check bindings in project source files.
- Unsaved overlays for local or linked dependencies that affect consumer-facing registry data.

### Excluded for dependencies

- Analysis of dependency `render` functions or their embedded templates.
- Assignability diagnostics, hover, completion, or other analyzer language features inside third-party dependency sources.
- Diagnostics for code the consumer does not own.
- Scanning arbitrary unreferenced packages.

Navigating to a dependency declaration may remain a host/TypeScript capability, but the analyzer does not promise embedded-template assistance while browsing dependency internals. Project-owned sources retain full template analysis, assignability, hover, and definitions.

### Slots are optional metadata

Dependency slots come only from JSDoc `@slot` or an explicit Custom Elements Manifest. They must not be inferred from dependency render implementations. Project sources may additionally support source-derived slot discovery when full template analysis is implemented.

Missing slot metadata does not make property types or assignability incomplete. Completeness is tracked per capability so that unknown slots or events do not block property and attribute checking.

## Assignability and CEM type text

Correct assignability is a critical invariant:

- Source and target types must belong to the same analysis project and snapshot.
- The operation must use `checker.isTypeAssignableTo` on real TS7 `Type` handles.
- Unknown, error, unresolved, or incomplete target types must not be reported as successful checks.
- Dependency declarations provide target types when available; otherwise the included JavaScript/JSDoc declaration provides the checker type.

For exact primitive text, TS7 exposes `getStringType`, `getNumberType`, and `getBooleanType`. Mapping CEM `type.text` to those intrinsics is technically possible, but it would create a second semantic source alongside declaration-backed checker types. CEM text can be stale, conflicting, or written in a non-TypeScript syntax; a primitive-only exception would still need rules for aliases, nullability, unions, literals, and provenance.

The registry may retain `type.text` for display, completion, hover, and documentation. It is never a checker input or an assignability fallback. A manifest may supply optional metadata such as slots without weakening this rule.

## Resulting registry architecture

```text
Public project/dependency entrypoints
              |
              v
TS7-resolved public semantic module closure
              |
              v
TS7 Program + Checker
  aliases, declarations, inheritance, members, JSDoc, types
              |
              v
Thin registration/framework recognizers
              |
              v
Core registry
  tag/property/attribute indexes, stable identities, provenance,
  per-capability completeness, immutable snapshot DTOs
```

The core finds a property binding by tag name and property name, or an attribute binding by tag name and attribute alias. It does not traverse TypeScript ASTs. Semantic operations are delegated to the adapter using stable declaration identity and snapshot-scoped references.

This discovery model supports TypeScript, JavaScript with JSDoc, JavaScript without declarations, declaration-only packages, and paired declaration/JavaScript packages without requiring a manifest. Its correctness boundaries are explicit module inclusion, declaration precedence, mismatch reporting, snapshot isolation, and checker-only assignability.
