# Design: Lit tooling for TypeScript 7

Status: proposal. None of the implementation or compatibility described here is assumed to exist yet.

## Goal and scope

Build a TypeScript 7-first analysis stack for Lit templates, with a shared core for a CLI, VS Code and a documented indexing API. The first full release aims for the applicable user-facing behavior of `lit-analyzer`, `ts-lit-plugin` and `lit-plugin`: all 23 declared rule IDs and the editor capabilities listed below must have an explicit verified status. Deliberate corrections to legacy behavior are permitted when backed by TypeScript and Lit semantics and regression tests; priority labels do not turn a deferred in-scope capability into parity.

The initial target is Lit in TypeScript projects, including their source, declaration and JavaScript-only dependencies. Standalone JS projects, complete framework-specific discovery beyond Lit, and a browser analysis host are outside this release. The system statically analyzes code, including unsaved buffers, and never runs user code for discovery.

## Architecture

```text
CLI host ───────────┐
                    ├─ shared analyzer ─ semantic provider ─ TS7 project/session
VS Code host ───────┘       │
                    templates, registry, rules, language services
```

Package names are provisional:

```text
packages/
  analyzer/          # core contracts, templates, registry, rules and features
  analyzer-ts7/      # semantic provider and TS7 sessions
  analyzer-cli/      # CLI, configuration, output and exit codes
  vscode-extension/   # extension, providers, grammars and editor tests
fixtures/            # self-contained parity and packaging fixtures
 docs/               # design, compatibility and development documentation
```

The core defines a narrow semantic interface. The TS7 adapter owns projects, module resolution, project references, snapshots and checker operations. Both compared types must come from the same project and snapshot. Use `isTypeAssignableTo(source, target)` for assignability; do not substitute `ts-simple-type` or an approximate custom type checker. Cache only within valid project/snapshot boundaries; reject stale results and honor cancellation. API gaps are blockers to investigate and document, not an excuse to claim successful checking.

## Development conventions and upstream readiness

The project is developed independently with a possible future contribution to `lit/lit`. Use its CONTRIBUTING.md, EditorConfig, Prettier configuration and ESLint rules as the initial reference. Use Oxlint as the planned linter, mapping the effective Lit ESLint rules, options, severities, presets and overrides rather than copying its configuration. At scaffolding time pin an upstream revision and compatible Oxlint/oxlint-tsgolint/TS7 versions, record the mapping and deviations, and verify behavior with positive and negative samples. Lit uses a legacy ESLint config, which Oxlint's flat-config migration tool cannot convert directly. Pay particular attention to import extensions, direct dependency checks, focused tests, unused variables, generic constructors, file-specific overrides and rules inherited from recommended presets. Investigate native rules, compatible JS plugins or independent checks for gaps; do not claim full parity without evidence. Oxlint JS plugins cannot implement type-aware rules. Enable the TS7-based type-aware engine where needed, validating its bundled TypeScript version against the project's selected version. Keep TS7 type checking as a separate check until equivalent coverage is demonstrated. Continue to use Prettier for formatting aligned with Lit. Run formatting, linting, type checking and relevant tests in CI.

Follow Lit's guidance for readable, descriptive code and comments explaining why. Use strict types, prefer `unknown` to `any`, use explicit `.js` extensions for relative imports, and avoid TypeScript-only runtime constructs such as enums, namespaces and parameter properties. Target `esnext` where compatible with the runtime and editor hosts; document any host-specific exceptions. Follow Lit's private-property naming and minification conventions where applicable, rather than assuming every convention applies to an unminified Node or editor host.

Use pnpm 12 and pnpm workspaces for this repository, pinning an exact available version and a compatible Node version. Verify availability and compatibility when bootstrapping; do not assume a particular pnpm 12 release exists. Keep pnpm-specific workspace and lockfile machinery at the repository boundary, and test packed packages with real consumers. A future integration into Lit would require adapting workspace dependency specifiers, lockfile, build and release scripts, test wiring and CI to the upstream repository. Replacing the package manager alone does not establish portability; rehearse integration against the then-current Lit setup before proposing a contribution.

The planned repository license is BSD-3-Clause, matching Lit; confirm the copyright holder and rights to contribute before adding the license. Respect licenses and notices for copied files. Lit requires DCO sign-off on submitted commits and changesets for PRs; establish contribution provenance from the start and meet those requirements when submitting upstream. Whether to require DCO or changesets in this standalone repository is a separate maintainer decision. Discuss proposed integration and package boundaries with Lit maintainers before preparing an upstream PR.

The editor must share a compatible TS7 session or prove an equivalent synchronized approach. Pin compatible versions of the runtime, editor extension and VS Code. The unstable API and middleware capabilities, snapshots and access to target types require executable proof. Content mappers are not the analysis mechanism for HTML inside ordinary TypeScript files. A separate CLI check is required; ordinary `tsc` does not automatically include analyzer diagnostics.

### Templates

Extract HTML and CSS virtual documents with bidirectional source maps. Resolve Lit tags by symbol/import, including aliases, namespace imports and re-exports, while retaining explicitly configured tags. Model template parts separately from component discovery. Preserve source ranges and edits for incomplete input, CRLF, Unicode, escapes, multiple interpolations and nested templates. Reuse appropriate HTML/CSS language services and grammars with license compliance and attribution.

### Component registry

Discover standard `customElements.define` and `HTMLElementTagNameMap` registrations and Lit decorators/reactive configuration through adapters. Track project, package and declaration identity, registrations, properties and attributes, events, slots, CSS metadata, provenance, coverage and invalidation dependencies. The registry is a thin model, not a replacement checker. It includes discoverable components in the project and included dependencies, not arbitrary unreferenced packages. Completion and checking must not depend on an import in the current file; missing-import analysis is a separate configurable rule and cannot prove runtime registration.

Support aliases, re-exports, declarations, inheritance, generic mixins and JavaScript/JSDoc dependencies. Keep declared property types separate from Lit converter/type options so that a `String` option cannot widen a declared literal union. Invalidate dependent records on edits, changed registrations, dependencies and configuration, including unsaved changes. Do not mix handles between projects or snapshots.

### Optional manifests

A Custom Elements Manifest may supply candidates and metadata; source discovery and checking work without one. Resolve references through package exports and TS7. `type.text` is documentation, not a checker type. Current source facts override stale conflicting metadata; inaccessible source is not proof of deletion. Manifest-only entries provide limited hints and make incomplete type checking visible. Never skip source scanning merely because a manifest exists: a separate coverage, fingerprint and invalidation contract and measurements are prerequisites.

The project does not depend on `@lit-labs/analyzer` or its API; comparison with it can inform requirements. Manifest reading is independent of the generator.

### Binding semantics and outputs

Use the real source and target types for property, attribute, boolean, event, content and element bindings. Cover nullable and union types, generics, converters, `nothing`, `noChange`, built-in and user directives. Unknown or unavailable types must not appear as successful checks. Constructing or obtaining target types for HTML metadata, including literal unions, is a specific proof-of-concept question. Do not promise callback contextual inference solely from event metadata.

The shared result model supplies diagnostics, ranges, completion, hover, definition and edits to both hosts. The CLI supports project selection, globs, severity and suppression, output formats, exit codes and explicit reporting of incomplete analysis. The VS Code host also targets code actions, rename, auto-close, formatting, folding, CSS intelligence/colors and settings. Version edits and discard stale responses.

## Proof of concept and milestones

1. Establish a portable workspace, explicit package exports and dependencies, packaging tests and a legacy behavior fixture matrix.
2. Pin a TS7/runtime/editor combination and implement one end-to-end case without a manifest: discover a component and its `count: number` property, diagnose `.count=${'bad'}` consistently in CLI and VS Code, and return completion, hover and definition. Test a type change in another unsaved document, cancellation and a project reference. Record API gaps and baseline performance.
3. Build robust templates and component discovery, then binding rules, the CLI and editor features. Add the independent optional manifest adapter and CSS support.
4. Verify the full feature and rule matrix, document intentional differences, benchmark representative projects and publish compatibility and known-limit information.

An unavailable API or transport is a documented blocker, not proof of parity. The precise Node, pnpm 12, TypeScript, VS Code and tooling versions will be selected and pinned after feasibility checks. Package naming remains an open decision.

## Testing and packaging

Library and CLI tests use `node:test` and `node:assert/strict`. Node 26 runs TypeScript tests directly with type stripping, while `pnpm typecheck` checks them separately without emitting files. VS Code integration uses `@vscode/test-cli`, `@vscode/test-electron` and Mocha in a real Extension Development Host, with isolated settings and pinned dependencies. Exercise diagnostics and ranges, completion/hover/definition commands, and updates caused by another unsaved document; wait for conditions with timeouts rather than arbitrary sleeps. Verify failure exit codes and logs. Provider tests are complemented by a small visual smoke test for highlighting and displayed suggestions.

Fixtures cover source, declarations, JS-only dependencies, bindings, directives, source coordinates and missing/partial/stale/corrupt manifests. Compare the legacy baseline while testing corrections against actual semantics. Measure cold indexing, warm completion/hover percentiles, update latency, memory and IPC; set budgets from measured baselines.

Every package declares its direct dependencies and normal npm `exports`, `types`, `bin` and `files` as applicable. Build and pack all required packages; install their actual archives into a clean standalone fixture without workspace paths or private services. Verify rewritten workspace dependency specifiers and transitive resolution, CLI execution and editor packaging. This is a packaging test, not a promise that packages are already published. Check licenses and attribution before redistributing copied assets or fixtures.

## Open questions

- Which pinned TS7 and VS Code versions expose the required operations and a usable editor session?
- Can HTML metadata target types and literal unions be obtained in the same snapshot without a custom checker?
- How should JS-only dependencies be included without changing a consumer's build configuration?
- What are acceptable measured latency, memory and IPC budgets?
- What are the final package names, public API stability policy, copyright holder and contribution workflow?
- Whether and how to propose integration with the Lit project is a separate maintainer decision; acceptance upstream is not a prerequisite for this project's work.
