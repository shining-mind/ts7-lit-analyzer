# Tasks

## 1. Standalone package and contracts

- [x] 1.1 Scaffold `packages/cem-analyzer-ts7` with exact TypeScript 7.1.0-beta and CEM schema 2.1.0 dependencies, package-local configs, and no workspace-package imports; verify its build/typecheck and document the boundary in both architecture documents.
- [x] 1.2 Add CEM-composed discovery DTOs for stable identity, evidence, provenance, per-capability completeness, opaque semantic references, and snapshot-level `containsOverlays`/`overlayFiles`; verify schema-conformance and source-state tests expose no TypeScript API objects or overlay text.
- [x] 1.3 Add the package to workspace entrypoint and standalone packaging tests; verify its packed artifact imports in the isolated consumer without workspace paths or undeclared dependencies.

## 2. Analysis snapshots and module inclusion

- [x] 2.1 Implement the disposable discovery session, derived analysis options, caller-supplied standalone roots, consumer-import dependency roots, and explicit TS7 semantic closure; verify direct, multi-file relative, and multi-package tests succeed with depth 0 without arbitrary package-root inference.
- [x] 2.2 Verify package `exports`, `main`, ESM, CommonJS, renamed re-exports, and pnpm symlink fixtures resolve canonical declarations and retain consumer-facing provenance without including unreferenced packages.
- [x] 2.3 Verify session/snapshot disposal and cross-project or cross-snapshot semantic operations are rejected through public API tests.

## 3. Checker semantics and declaration authority

- [x] 3.1 Implement checker-backed classes, fields, accessors, methods, inheritance, documentation, and semantic references; verify vanilla `HTMLElement`, TypeScript, and raw JavaScript/JSDoc tests cover real types, inherited origins, signatures, and same-snapshot primitive assignability.
- [x] 3.2 Implement declaration-only and declaration/JavaScript handling with declarations as the sole public semantic authority; verify differing JS types/exports create no conflicts and raw JavaScript is used only when declarations are absent.
- [x] 3.3 Add Material Web 2.5.0 to the shared webcomponents fixture and verify through root public-API integration that `MdDialog` exposes declaration-backed `noFocusTrap: boolean` plus JavaScript-supplied `no-focus-trap` metadata without manifest/render analysis.

## 4. Framework evidence and completeness

- [x] 4.1 Implement the framework strategy contract and built-in vanilla/Lit strategies for global/direct custom registry definitions, `HTMLElementTagNameMap`, observed attributes, `lit`/`lit-element`, decorators/compiled decorators, and static reactive properties; verify strategy composition, registry scope/identity, and evidence/range tests.
- [x] 4.2 Implement the complete CEM-compatible JSDoc surface and aliases, including member/component tags, CSS parts/properties/states, slots, events, visibility, defaults, and reflection; verify the supplied legacy-Lit fixture, class/member placement, and inline event evidence without CSS/render extraction or assigning semantic types from documentation text.
- [x] 4.3 Implement per-capability semantic completeness; verify unresolved modules, missing semantic files, implicit `any`, error types, and unsupported syntax are explicit while explicit `any` remains a valid checker type with `checkJs` disabled.

## 5. Incremental updates and workspace validation

- [x] 5.1 Implement overlay-based successor snapshots and selective invalidation; verify direct/transitive JS, declaration, and implementation overlays update semantics, old snapshots remain unchanged, FS-only/one-shot overlay results report correct `containsOverlays`/`overlayFiles`, and newly reachable or newly registered components are not lost.
- [x] 5.2 Implement structural sharing and lazy successor-handle resolution; verify an edit preserves unaffected record object identity, does not eagerly recompute unaffected semantic types, and correctly adds, updates, or removes cross-file registration/tag-map evidence.
- [x] 5.3 Update the discovery research and current-status documentation for declaration authority, the standalone package, CEM issue findings, and supported limits; verify no text claims registry, template, editor, upstream, or benchmark results that tests do not establish.
- [x] 5.4 Create the shared `tests/fixtures/webcomponents` project and representative `tests/discovery-integration.test.ts`; keep the recognizer matrix in package-local in-memory tests and verify root `test:discovery` runs both levels with the fixture's frozen install.
- [x] 5.5 Reuse unchanged per-file module-resolution edges and provenance across overlays; re-resolve changed importers, unresolved dependencies, changed package-manifest inputs, and newly reachable modules; prune unreachable modules and verify unaffected importers are not resolved again without claiming an O(change) TS7 program update.
- [x] 5.6 Run strict OpenSpec validation, build, typecheck, lint, format check, and the full root test suite; verify every requirement scenario is exercised and all checks pass.
