# Design

## Context

Package exports and the CLI bin point to `dist/`. Tests will use those public interfaces rather than relative source imports.

## Goals / Non-Goals

**Goals:**

- Add the concrete smoke tests listed in the spec.
- Allow each package test suite to run independently.

**Non-Goals:**

- Test unimplemented analysis or CLI diagnostics.
- Change production behavior.

## Decisions

- Put TypeScript tests in each package's `test/` directory and run them with `node --test test/*.test.ts`.
- Make each `test:smoke` command build the package and its workspace dependencies first, so stale or missing `dist/` cannot affect results.
- Use `tsconfig.json` for source and test typechecking with `noEmit`.
- Use `tsconfig.build.json` for source-only production output.
- Make root `test:smoke` build and run package and repository smoke tests.
- After smoke completes, run baseline, packaging, and `test:e2e` in parallel. This avoids concurrent builds writing to shared `dist/` directories.
- Keep `test:vscode` as the underlying extension command and expose `test:e2e` for the aggregator. Add `test:unit` only with real unit tests.

## Risks / Trade-offs

These tests only catch broken package metadata and entry points. They do not establish analyzer or diagnostic correctness.
