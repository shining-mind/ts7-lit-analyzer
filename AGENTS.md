# TypeScript 7 Lit Analyzer

This is a public, English-language project developing type-aware Lit template diagnostics and editor features with TypeScript 7. The design-stage workspace contains four private packages: the analyzer core, TypeScript 7 semantic provider, CLI, and VS Code extension. It uses Node 26, pnpm workspaces, strict TypeScript, Oxlint, Prettier, and Node.js tests. The architecture is a proposal; do not present planned functionality as implemented.

## Rules

- Treat every document linked under Routing as an integral, mandatory part of these instructions, not as optional guidance. Before each action, check whether a corresponding routed instruction applies and ensure you have read it before acting; comply with all applicable instructions.
- Keep source code, tests, fixtures, issues, specifications, and other project artifacts in English.
- Track meaningful work in a GitHub issue and add it to the project board. Record blocking dependencies as issue relationships so the execution order is visible.
- Use issues for outcomes and progress. Elaborate substantial changes, requirements, scenarios, and implementation tasks in OpenSpec, linking the change and issue. Keep proposed work in `openspec/changes/` and verified behavior in `openspec/specs/`; sync or archive only after implementation and validation.
- Preserve the distinction between actual capabilities, intended parity, and unverified TypeScript 7 or editor API assumptions.
- Follow established project patterns and package boundaries. Keep the analyzer core, TypeScript 7 semantic provider, CLI, and editor host separate.
- Source and target types used for assignability must belong to the same TypeScript project and snapshot. Never replace the TypeScript 7 checker with approximate assignability.
- Keep source code, fixtures, and documentation self-contained. Do not include private information, organization-specific paths, or services.
- Use strict TypeScript, explicit `.js` extensions for relative imports, and clear names. Document tooling exceptions and keep the Oxlint rule mapping honest about gaps.
- Add meaningful tests for changed behavior when the relevant test workflow exists. Do not add tests to packages that have no test setup unless the task includes establishing one.
- Run applicable build, typecheck, lint, format, and test checks. Editor features require a real Extension Development Host; unit or mocked tests do not establish VS Code integration.

## Routing

Read only the documents relevant to the task:

- [Project overview](./README.md) — when you need to understand project goals, current status, scope, or development commands
- [Monorepo layers and boundaries](./.agents/docs/architecture.md) — before starting a task when deciding where code should live and which package owns each responsibility
- [Architecture proposal](./docs/architecture.md) — before changing semantic analysis, architecture, milestones, or compatibility assumptions
- [Source development](./.agents/docs/develop.md) — before any `.ts` or `.scss` edit: style, TypeScript, Lit, SCSS, and comments
- [OpenSpec changes](./openspec/changes/) and [verified specifications](./openspec/specs/) — before working on a feature or substantial behavior change; also read the linked GitHub issue
- [Tooling commands](./.agents/docs/tooling.md) — before running build, typecheck, lint, formatting, or test commands; also before changing tool configuration or versions
- [Pull request requirements](./.agents/docs/pull-requests.md) — before preparing or reviewing a pull request
- [Commit requirements](./.agents/docs/commit.md) — before creating, amending, or reviewing a commit
- [Contributor guidelines](./CONTRIBUTING.md) and [commit requirements](./.agents/docs/commit.md) — before updating contributor guidance or DCO requirements
