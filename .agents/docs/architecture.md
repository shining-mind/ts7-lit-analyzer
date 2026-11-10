# Monorepo layers and boundaries

Read this document before deciding where code should live or which package should own a responsibility. For semantic design, milestones, and unverified assumptions, read `docs/architecture.md`.

## Package responsibilities

- `packages/analyzer/` owns host-independent contracts, template analysis, component registry, rules, and shared language-service results. It must not depend on the TypeScript 7 adapter, CLI, or VS Code.
- `packages/analyzer-ts7/` owns TypeScript 7 projects, sessions, snapshots, module resolution, project references, and checker operations. It implements the analyzer core's narrow semantic interface.
- `packages/analyzer-cli/` owns command-line configuration, project and file selection, output, and exit codes. It consumes the shared analyzer rather than implementing analysis independently.
- `packages/vscode-extension/` owns editor activation, providers, transport, grammars, settings, and Extension Host integration. It consumes shared analysis results and must not duplicate analyzer semantics.

Dependencies point inward toward host-independent analyzer contracts. Keep host-specific APIs out of the core and analyzer semantics out of the CLI and editor adapters.

## Package and dependency boundaries

- Declare every direct dependency in the consuming package and import through normal package exports.
- Keep pnpm workspace machinery at the repository boundary and verify packed artifacts before claiming portability.
- Do not add editor, CLI, or TypeScript runtime dependencies to packages that do not consume them.
