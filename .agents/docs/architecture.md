# Monorepo layers and boundaries

Read this document before deciding where code should live or which package owns a responsibility. For semantic design, milestones, and unverified assumptions, read `docs/architecture.md`.

## Package responsibilities

- `packages/analyzer-core/` owns host-independent contracts (adopted from the discovery engine), the component registry, template analysis, rules, shared language-service results, and the single-project registry session. It consumes `cem-analyzer-ts7` directly through the engine's public session API and must not depend on the CLI or VS Code. Host policies such as open-file tracking, scheduling, and multi-project routing stay in the hosts.
- `packages/cem-analyzer-ts7/` owns the independently extractable CEM-based web-component discovery engine, including its discovery-specific TS7 snapshots, module closure, checker operations, and built-in framework strategies. It must not depend on other workspace packages.
- `packages/analyzer-cli/` owns command-line configuration, project and file selection, output, and exit codes. It consumes the shared core rather than implementing analysis independently.
- `packages/vscode-extension/` owns editor activation, providers, transport, grammars, settings, and Extension Host integration. It consumes shared analysis results and must not duplicate analyzer semantics.

The core depends on the engine, not vice versa, so the engine remains independently extractable. There is no separate TypeScript 7 adapter package: the engine's public session API is the narrow semantic interface, and the core composes it without re-declaring contracts or duplicating checker operations. Keep host-specific APIs out of the core and analyzer semantics out of the CLI and editor hosts.

## Package and dependency boundaries

- Declare every direct dependency in the consuming package and import through normal package exports.
- Keep pnpm workspace machinery at the repository boundary and verify packed artifacts before claiming portability.
- Do not add editor, CLI, or TypeScript runtime dependencies to packages that do not consume them. The core consumes TypeScript 7 semantics transitively through the engine; it does not import the TypeScript API directly.
