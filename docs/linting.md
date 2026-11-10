# Formatting and linting

## Upstream baseline

The configuration is based on Lit revision `b17fb14470c69a68205c10b69451883da07f4dde` (`chore: enforce typescript erasable syntax in config files (#5420)`, 2026-11-05), using its root `.prettierrc.json` and `.eslintrc.json`.

The local tool versions are pinned in `package.json`: Prettier 3.9.10 and Oxlint 1.90.0. TypeScript checking remains a separate `pnpm typecheck` command.

## Prettier

`.prettierrc.json` is identical to Lit's configuration: single quotes, no bracket spacing, and ES5-compatible trailing commas. `.prettierignore` is intentionally project-specific because generated and dependency paths differ between the repositories.

Run `pnpm format` to format files and `pnpm format:check` to verify formatting.

## Oxlint mapping

The Oxlint configuration maps Lit's effective ESLint configuration as follows:

- `eslint:recommended` is represented by Oxlint's `correctness` category at error severity.
- `plugin:@typescript-eslint/eslint-recommended` and `plugin:@typescript-eslint/recommended` are represented by the TypeScript plugin, the correctness category, and explicitly configured TypeScript rules.
- `import/extensions` is `error` with `always` and `ignorePackages: true`, so the rule targets relative imports without requiring extensions in package specifiers.
- `no-prototype-builtins`, `@typescript-eslint/ban-types`, `explicit-module-boundary-types`, `no-empty-function`, and `no-non-null-assertion` are disabled.
- `@typescript-eslint/no-explicit-any` is an error, except in `*_test.ts` files.
- `@typescript-eslint/no-unused-vars` is a warning with `argsIgnorePattern: "^_"`.
- `@typescript-eslint/consistent-generic-constructors` is an error.
- Browser and ES2020 globals are enabled. Node globals are enabled for this repository's Node.js packages and tests instead of copying Lit's package-specific override paths.

Run `pnpm lint`. Type-aware Oxlint rules and `oxlint-tsgolint` are not enabled; they have not yet been validated against the selected TypeScript 7 version.

## Known differences and gaps

This is a best-effort rule mapping, not a claim of exact ESLint parity.

- Oxlint 1.90.0 does not provide `no-only-tests/no-only-tests` or `import/no-extraneous-dependencies`. Focused tests and undeclared dependencies therefore require separate checks; neither is currently enforced by `pnpm lint`.
- Oxlint's correctness category is its own maintained rule set. It covers many ESLint recommended rules but is not guaranteed to contain exactly the same rules or implementations as the versions used by Lit. It can also enable additional correctness checks.
- Some TypeScript ESLint recommended rules have no Oxlint equivalent or differ in implementation. Explicitly configured unsupported-by-default rules cover `no-array-constructor`, `ban-ts-comment`, `no-namespace`, `no-unnecessary-type-constraint`, and `no-var-requires`; other supported recommended rules come from the correctness category.
- Oxlint does not reproduce ESLint's TypeScript-parser override semantics exactly. JavaScript and TypeScript files use the same configured rule set, subject to the explicit overrides.
- Lit's file-specific environment and dependency-rule exceptions have not been copied verbatim because their paths target packages that do not exist in this repository.
- Formatting, linting, and TypeScript checking are independent checks. A successful Oxlint run does not establish type correctness.

Revisit this mapping when updating Oxlint or the Lit baseline. Document any replacement checks before describing an unsupported rule as covered.
