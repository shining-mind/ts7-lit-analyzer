# Pull request requirements

## Scope and linking

- Address a defined GitHub issue or approved proposal. Use `Part of #<number>` when the PR completes only part of an issue, `Refs #<number>` for other related work, and `Fixes #<number>` only when merging the PR should close the entire issue. Never use a closing keyword for partial progress.
- Link the corresponding OpenSpec change for substantial behavior or architecture work.
- Keep the PR focused. Separate unrelated fixes and refactoring.
- Do not claim planned, unverified, or partially implemented behavior as complete.

## Description

The PR description must be in English and follow `.github/PULL_REQUEST_TEMPLATE.md`:

1. **Summary** — the problem, the user-visible or architectural outcome, and the main implementation approach.
2. **Changes** — the important behavior, API, configuration, and documentation changes, including intentional compatibility differences. Where applicable, explain the motivation for each change: what was changed and why.
3. **Limitations** — unsupported cases, remaining API gaps, performance concerns, and follow-up work. Do not use this section as a manual test report; CI is responsible for reporting validation results.
4. **Links** — the GitHub issue, OpenSpec change where applicable, and other material references.

Use a clear title following Conventional Commits, such as `feat(analyzer): add Lit property binding diagnostics`.

## Review readiness

Before requesting review:

- Add or update meaningful tests for behavior changes and bug fixes.
- Run applicable build, typecheck, lint, format, and test commands.
- Update documentation and specifications to match verified behavior.
- Check package metadata and packed artifacts when package boundaries or dependencies change.
- Ensure every commit follows Conventional Commits and contains a valid DCO `Signed-off-by` trailer.
- Prefer new focused commits when addressing review feedback so reviewers can inspect changes since the previous review.
- Include a changeset when the repository's release workflow requires one; document explicitly if changesets are not yet configured rather than pretending one was created.
