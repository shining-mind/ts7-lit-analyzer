# Spec Delta

## Purpose

Defines the initial smoke tests and independent test commands for the analyzer and CLI packages.

## ADDED Requirements

### Requirement: Analyzer package smoke tests

The analyzer tests SHALL import the package through its public exports, verify `analyzerPackageVersion` is `0.0.0`, and typecheck usage of `AnalyzerConfig`, `SourceRange`, `AnalyzerDiagnostic`, `AnalyzerCodeFix`, and `AnalyzerCodeFixAction`.

#### Scenario: Analyzer contract is consumable

- **WHEN** the analyzer package tests run after a build
- **THEN** the public import, version, and TypeScript contract checks pass

### Requirement: CLI package smoke tests

The CLI tests SHALL import the package through its public exports and run its bin, verifying no runtime module exports, exit code 0, empty stderr, and `ts7-lit-analyzer 0.0.0` on stdout.

#### Scenario: CLI interfaces are consumable

- **WHEN** the CLI package tests run after a build
- **THEN** the public module and executable checks pass

### Requirement: Independent test commands

Each package SHALL provide a `test:smoke` command that builds its public artifacts before running smoke tests. Root `test` SHALL run smoke/build before parallel independent suites.

#### Scenario: Run one package suite

- **WHEN** a contributor runs `pnpm --filter <package> test:smoke`
- **THEN** current artifacts are built and only that package's smoke tests run

#### Scenario: Validate production output

- **WHEN** typechecking and building complete
- **THEN** tests are typechecked and no test files appear in `dist/`

#### Scenario: Run standard workspace tests

- **WHEN** a contributor runs root `pnpm test`
- **THEN** smoke/build completes before baseline, packaging, and VS Code e2e suites run in parallel

#### Scenario: Run a named suite

- **WHEN** a contributor runs `test:smoke`, `test:baseline`, `test:packaging`, or `test:e2e`
- **THEN** only the selected suite and its required prerequisites run; no empty `test:unit` command is required
