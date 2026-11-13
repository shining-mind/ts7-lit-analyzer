# ts7-lit-analyzer

> Design-stage project. No packages or editor extension are available yet.

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

This is a proposed architecture, not a working implementation. The first milestone is an end-to-end proof of concept with a real TypeScript 7 checker in both CLI and VS Code, without requiring a manifest. API availability, editor transport, target type construction and performance remain to be verified.

See [architecture](docs/architecture.md) for the architecture, milestones, testing strategy and open questions. Package names, copyright ownership and contribution process are pending maintainer decisions. Installation and usage instructions will be added when working artifacts exist.

## Development

The workspace requires Node 26 and pnpm 12.14.0. It uses the public npm registry, exact direct dependency versions, and a 14-day minimum release age for dependency versions. From the repository root:

```sh
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:packaging
pnpm test:vscode
```

Build before running the smoke tests. The four private packages contain only placeholder entry points; there is no analyzer, CLI, or VS Code extension implementation yet. The Oxlint configuration follows Lit's ESLint configuration where supported; see [Formatting and linting](docs/linting.md) for the upstream baseline, rule mapping, and known differences.

## Specifications and changes

The architecture document describes the intended system and open questions. OpenSpec tracks proposed changes under `openspec/changes/` and verified behavior under `openspec/specs/`. Use OpenSpec for substantial behavior or architecture changes; small fixes can be handled directly. Do not describe planned features as implemented. The [legacy parity baseline](docs/parity.md) tracks rule and feature coverage, including cases that are still pending.

Run `pnpm exec openspec --help` for the CLI. OpenSpec skills use the shared `.agents/skills/` directory rather than maintaining a complete copy for every agent harness. Add only the minimum harness-specific integration required for compatibility: for example, `.claude/` exists because Claude Code cannot consume `.agents/skills/` directly. Preserve this shared-skill setup when running OpenSpec updates.
