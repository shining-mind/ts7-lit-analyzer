# ts7-lit-analyzer

> Design-stage project. Packages and the editor extension are under active development; no supported release is available yet.

This project aims to provide type-aware Lit template diagnostics and editor features using TypeScript 7. It targets TypeScript projects that use Lit, including JavaScript-only dependencies consumed by those projects.

The goal is a drop-in replacement for the applicable TypeScript and Lit workflows of [runem/lit-analyzer](https://github.com/runem/lit-analyzer), including its `lit-analyzer` CLI, `ts-lit-plugin`, and `lit-plugin` editor experience. The first release aims for comparable functionality across the CLI and VS Code, while improving accuracy and usability where possible. Corrections to existing false positives or false negatives and any compatibility differences will be documented and tested against TypeScript and Lit semantics. This is a goal, not a claim of existing compatibility.

## Planned capabilities

- HTML and CSS highlighting, completion, hover, definition, diagnostics and fixes.
- Lit property, attribute, boolean, event and content bindings, including directives.
- Component discovery from source and declarations; optional Custom Elements Manifest metadata.
- A CLI suitable for local checks and CI, and a documented indexing API.
- Support for unsaved editor changes and project references.

Standalone JavaScript projects, full discovery for frameworks other than Lit, and browser-hosted analysis are outside the first release.

## Status and design

The overall analyzer architecture remains proposed. The `cem-analyzer-ts7` package implements tested TypeScript 7 component discovery with declaration authority, framework metadata, and snapshot-scoped semantic operations. One pipeline serves two verified modes: the default eager one-shot collection, and an opt-in lazy mode with deferred initialization, caller-scoped collection that grows incrementally, a project-wide syntactic registration index, per-component on-demand enrichment and type resolution from the current snapshot, serialization-time type materialization, a checker-confirmed candidate pre-filter, optional bounded snapshot retention, and generation identity on results. Lazy entries without enrichment report `not-collected` capabilities, never silent completeness. The TS7 program itself stays project-wide in both modes. Project-reference source redirection, logical operation cancellation, explicit overlay removal, and opt-in timing are implemented and covered by the [engine tests](packages/cem-analyzer-ts7/test/).

The `analyzer-core` package implements a tested, host-independent component registry foundation over the engine's records: framework-neutral CEM-composed contracts adopted from the engine, tag and declaration-identity lookups, attribute alias resolution, inheritance references, per-capability completeness, snapshot-scoped views, and checker-only semantic delegation through a single-project registry session (see [component registry](docs/component-registry.md)).

The VS Code extension now implements spawned editor-host orchestration: tab-based open/dirty document tracking, configured and inferred project routing, independent lazy registry sessions, `onType`/`onSave` analysis, debounce with maximum wait, cross-project unsaved overlays, stale-result rejection, logical cancellation, and configurable LRU residency. Its `normal`/`verbose`/`debug` Output levels control all timing and memory instrumentation; normal mode performs none of it. These behaviors are exercised in a real Extension Development Host by [`pnpm test:e2e`](packages/vscode-extension/src/test/). The extension does **not** yet register template diagnostics, completion, hover, or definition providers. Native-request cancellation is not available through the public TS7 client; native-preview pipe integration and runtime-complete VSIX packaging remain [#25](https://github.com/shining-mind/ts7-lit-analyzer/issues/25).

Template diagnostics and CLI analysis are still not provided. The first full-stack milestone remains an end-to-end proof of concept in both CLI and VS Code. Target type construction for templates remains to be verified. [Performance measurements](docs/performance.md) provide a reproducible small-fixture baseline and preliminary non-gating budgets; representative performance and adaptive memory policies remain [#26](https://github.com/shining-mind/ts7-lit-analyzer/issues/26).

See [architecture](docs/architecture.md) for the architecture, milestones, testing strategy and open questions. Remaining package names, copyright ownership and contribution process are pending maintainer decisions. Installation and usage instructions will be added when working artifacts exist.

## Development

The workspace requires Node 26 and pnpm 12.14.0. It uses the public npm registry, exact direct dependency versions, and a 14-day minimum release age for dependency versions. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:discovery
pnpm test:packaging
pnpm test:e2e
```

Root `pnpm test` runs `test:smoke` first, then runs baseline, discovery, packaging, and `test:e2e` in parallel. Smoke commands build automatically. Run one package's smoke tests with `pnpm --filter @ts7-lit-analyzer/analyzer-core test:smoke` or `pnpm --filter @ts7-lit-analyzer/analyzer-cli test:smoke`. `test:discovery` installs the isolated webcomponents fixture, runs the collector package tests, and then exercises the shared fixture through the built public API. When running `test:packaging` or `test:e2e` independently, build first. Add `test:unit` only when real unit tests exist. The four private packages are not released; `cem-analyzer-ts7` implements the tested discovery engine, `analyzer-core` the tested registry foundation, and the VS Code extension the tested host orchestration described above. The CLI remains a placeholder, and the extension has no template providers or runtime-complete VSIX yet. The Oxlint configuration follows Lit's ESLint configuration where supported; see [Formatting and linting](docs/linting.md) for the upstream baseline, rule mapping, and known differences.

Run the serial cold/warm eager/lazy measurements with `node probes/host-policy-performance.mjs --runs=3` after building and installing the webcomponents fixture. See [Performance measurements](docs/performance.md) for the exact command, emitted metrics, environment, and attribution limits.

## Specifications and changes

The architecture document describes the intended system and open questions. OpenSpec tracks proposed changes under `openspec/changes/` and verified behavior under `openspec/specs/`. Use OpenSpec for substantial behavior or architecture changes; small fixes can be handled directly. Do not describe planned features as implemented. The [legacy parity baseline](docs/parity.md) tracks rule and feature coverage, including cases that are still pending.

Run `pnpm exec openspec --help` for the CLI. OpenSpec skills use the shared `.agents/skills/` directory rather than maintaining a complete copy for every agent harness. Add only the minimum harness-specific integration required for compatibility: for example, `.claude/` exists because Claude Code cannot consume `.agents/skills/` directly. Preserve this shared-skill setup when running OpenSpec updates.
