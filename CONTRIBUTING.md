# Contributing to ts7-lit-analyzer

Thank you for your interest in contributing to ts7-lit-analyzer!

There are many ways to contribute to the project, and we have many different needs to be addressed. All contributions, from issues, to PRs, to reports of successful usage, are appreciated and valuable.

## Code of Conduct

We have a [Code of Conduct](./CODE_OF_CONDUCT.md), please follow it in all interactions with project maintainers and fellow users.

## Filing Issues

Issues are one of the most important ways to contribute to ts7-lit-analyzer.

Please search through open and closed issues to see if a similar issue already exists. If not, open an issue and try to provide a minimal reproduction if you can.

Occasionally we'll close issues if they appear stale or are too vague - please don't take this personally! Please feel free to re-open issues we've closed if there's something we've missed and they still need to be addressed.

Substantial behavior and architecture changes are planned in [OpenSpec](./openspec/). Keep proposals and specifications in English and link them to the corresponding GitHub issue.

## Pull Requests

Pull requests are greatly appreciated! To ensure a smooth review process, please follow these steps:

1. Make sure there's an open issue that the PR addresses. Use `Part of #(issue number)` when the PR completes only part of an issue, and `Fixes #(issue number)` only when merging it should close the entire issue.
2. Please discuss the general shape of the change ahead of time. This can save much time for reviewers and submitters alike. Many times there may be existing ideas on how to handle an issue that are not fully written out, and asking about it will bring out more details.
3. All PRs that change behavior or fix bugs should have new or updated tests.
4. Try to create a set of descriptive commits that each do one focused change. Commit messages must follow [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/).
5. When addressing review comments, try to add new commits, rather than modifying previous commits. This makes it easier for reviewers to see what changed since the last review. `git commit --fixup {SHA}` is really useful for this. Requests to rebase require changing commits.
6. If you [allow changes to be committed to your PR branches](https://help.github.com/articles/allowing-changes-to-a-pull-request-branch-created-from-a-fork/) we can fix some small things in the PR for you, speeding up the review process. This is especially useful if you're new to TypeScript and need help with type annotations.
7. Please run `pnpm lint` and `pnpm format` before submitting PRs. PRs that don't lint and aren't formatted will fail continuous integration tests. Run the other applicable validation commands described below as well.
8. Complete the pull request template, including the motivation for significant changes and any remaining implementation limitations. CI reports validation results; a manual test report is not required in the PR description.

## Code Style

We follow the [Google JavaScript Style Guide](https://google.github.io/styleguide/jsguide.html), but there are a couple of points worth emphasizing:

1. Clear is better than clever. Optimize for simple, readable code first.
2. Prefer longer, more descriptive names, over shorter names. For most variables, minification means we don't pay for extra characters in production.
3. Always err on the side of too many comments. When commenting, "why" is more important than "what".
4. If you're tempted to add a "what" comment, see if you can't restructure the code and use more descriptive names so that the comment is unnecessary.

## TypeScript

We use TypeScript to automatically check the code for type errors and document the types of fields and attributes for easier reading. If you don't know TypeScript, we hope it doesn't discourage you from contributing - TypeScript is a superset of JavaScript that focuses on adding type annotations.

TypeScript is hopefully relatively easy to pick up, but if you have any problems we're more than happy to help. You can submit a pull request with type warnings and we'll either help you fix them, or if you allow commits to your PR branch, fix them for you. VS Code is a very nice IDE for TypeScript development if you care to try it.

We stick to a subset of TypeScript that is more strict and closer to standard JavaScript.

1. We have strict compiler options turned on. Do not change them.
2. Prefer the `unknown` type over `any`.
3. Prefer the `object` type over `Object`.
4. Prefer named type aliases over complex inline types.
5. Use web-compatible, full URLs as import specifiers, including file extensions: `import * as foo from './foo.js'`, not `import * as foo from './foo'`.
6. Only use TypeScript for types:
   1. We compile to the `esnext` target and don't use TypeScript for "downlevel" compilation. Do not change that.
   2. Don't use features that are not part of the type system:
      1. `namespace`
      2. `enum`
      3. Parameter properties (initialize class fields in the constructor parameter list)

## Private Property Prefixing

This codebase follows Lit's conventions regarding prefixing for private properties and fields where property minification, subclassing, or cross-version sharing makes them applicable. Do not apply browser-library minification conventions blindly to Node.js packages.

1. **`_` prefix for private properties** - Most `private`-annotated fields intended for minification should be prefixed with a single underscore.
2. **`_$` prefix for private properties shared between versions** - Properties that are private to a library but could be accessed by a different version should use `_$` and be registered in the host's stable-property mechanism where one exists. These properties are often marked internal when TypeScript cannot mark them `private` for type reasons.
3. **`__` prefix for private fields on exported classes** - Private fields on a class intended to be subclassed outside its package should use a double underscore when package-level minification namespacing is required.

## Developer Certificate of Origin (DCO)

We require that all commits are certified under the [Developer Certificate of Origin (DCO)](https://developercertificate.org/). By contributing, you agree that you have the right to submit your work under the project's license.

To certify your commits, include a `Signed-off-by` line in every commit message using your real legal name and an active email address:

    Signed-off-by: Jane Doe <jane.doe@example.com>

A GitHub DCO check runs on all pull requests to enforce this requirement.

### How to Sign Your Commits

Git provides a built-in flag to append this line automatically using your configured `user.name` and `user.email`:

```bash
git commit -s -m "docs: add contribution guidelines"
```

DCO sign-off is different from cryptographic GPG or SSH commit signing.

## Set up

You'll need [**Node** 26](https://nodejs.org/en) and **pnpm** 12.14.0 installed on your machine.

```bash
node -v
v26.0.0

git clone https://github.com/shining-mind/ts7-lit-analyzer.git
cd ts7-lit-analyzer
pnpm install --frozen-lockfile
pnpm build
```

Dependencies are installed from the public npm registry. Declare every direct dependency with an exact version and do not use version ranges. Newly resolved package versions must have been published at least 14 days ago; choose an older compatible release when necessary rather than bypassing the workspace policy. The workspace also blocks exotic transitive dependencies, rejects trust downgrades for releases from the past year, and does not run unapproved dependency build scripts. Review any proposed exception explicitly instead of disabling these checks.

## Tests and validation

Library and workspace tests use `node:test` and `node:assert/strict`. Node 26 runs TypeScript tests directly with type stripping. Build packages before running tests that import their compiled entry points. The isolated legacy parity fixture has its own TypeScript 5 installation and frozen lockfile; `pnpm test` installs it before running the baseline tests.

Run the applicable checks from the repository root:

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm test:packaging
pnpm test:vscode
```

VS Code integration requires a real Extension Development Host. Unit or mocked tests do not establish editor integration.
