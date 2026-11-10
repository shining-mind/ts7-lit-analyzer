# Tooling commands

Use the workspace scripts rather than invoking package-specific tool binaries directly. The repository requires Node 26 and pnpm 12.14.0.

- `pnpm build` — compile all packages. Run before tests that consume compiled outputs and before validating package artifacts.
- `pnpm typecheck` — run TypeScript checks without emitting files. This is independent of Oxlint.
- `pnpm lint` — run Oxlint with the repository configuration. Do not treat it as a type check or proof of exact ESLint parity.
- `pnpm format` — format the workspace with Prettier when the requested changes permit broad formatting; otherwise format only the files you changed with `pnpm exec prettier --write <paths>`.
- `pnpm format:check` — verify formatting without modifying files.
- `pnpm test` — run the Node.js smoke and unit tests. Build first when tests import compiled outputs.
- `pnpm test:vscode` — build the extension, then run its Mocha smoke test in a real, isolated VS Code Extension Development Host. The first run downloads the pinned VS Code version.

Run the checks applicable to the changed files and behavior. Before delivering a change, run the standard validation set when applicable: build, typecheck, lint, format check, and tests. Do not claim editor integration from these commands; VS Code behavior requires a real Extension Development Host.

The lint rule mapping and known differences are documented for contributors in `docs/linting.md`; read it only when changing or evaluating the lint configuration itself.
