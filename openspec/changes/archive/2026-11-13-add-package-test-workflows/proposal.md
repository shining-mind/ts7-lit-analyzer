# Proposal

## Why

The analyzer and CLI packages need their own smoke tests and test commands for issue #1. These tests validate the package scaffold, not semantic analysis.

## What Changes

- Analyzer: verify the package import, `analyzerPackageVersion`, and exported TypeScript contracts.
- CLI: verify the package import and the bin startup output and exit code.
- Add self-contained `test:smoke` commands that build before running Node 26 smoke tests.
- Typecheck tests but exclude them from production builds.
- Make root `test` an aggregator: smoke/build first, then independent suites in parallel. Map `test:e2e` to VS Code and add `test:unit` only when real unit tests exist.

## Capabilities

### New Capabilities

- `package-testing`: Package-level smoke tests and test commands.

### Modified Capabilities

None.

## Impact

Changes package tests, manifests, TypeScript configurations, root scripts, and development documentation. No production behavior or dependencies change.

Links: #1.
