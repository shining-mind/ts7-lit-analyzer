# Tasks

## 1. Package tests

- [x] 1.1 Rename the analyzer command to `test:smoke`, make it build first, and verify its import, version, and TypeScript contract tests pass without a prior workspace build.
- [x] 1.2 Rename the CLI command to `test:smoke`, make it build its workspace dependencies first, and verify its module and bin smoke tests pass without a prior workspace build.
- [x] 1.3 Configure both packages to typecheck tests and build only `src/`; verify typechecking passes and `dist/` contains no tests.

## 2. Workspace integration

- [x] 2.1 Make root `test` run `test:smoke` before parallel baseline, packaging, and `test:e2e` suites; make baseline installation self-contained, retain `test:vscode`, and verify suite selection.
- [x] 2.2 Document the named commands and automatic smoke build in the tooling guide and README, and verify each command.
- [x] 2.3 Run build, typecheck, lint, format check, workspace tests, packaging tests, and VS Code integration tests; verify all pass.
