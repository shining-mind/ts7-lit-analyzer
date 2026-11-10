# Commit requirements

## Authorization and scope

- Do not commit, push, publish, or change external services unless requested.
- Preserve unrelated work and keep each commit focused on the requested change.

## Conventional Commits

Every commit message must follow [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/):

```text
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

- Use a lowercase type such as `feat`, `fix`, `build`, `chore`, `ci`, `docs`, `refactor`, `perf`, `style`, or `test`.
- Use a concise imperative description without a trailing period.
- Add a scope when it clarifies the affected package or subsystem.
- Use `feat` for new functionality and `fix` for bug fixes. Use the type that describes the primary change.
- Explain motivation, behavior changes, and relevant issue links in the body when the subject is insufficient.
- Mark breaking changes with `!` after the type or scope and include a `BREAKING CHANGE:` footer describing the change.
- Keep each commit focused on one logical change. Do not mix unrelated cleanup with features or fixes.

Examples:

```text
feat(analyzer): diagnose incompatible property bindings
fix(cli): report incomplete analysis with a nonzero exit code
docs: document Oxlint differences from Lit ESLint
```

## Developer Certificate of Origin

Every commit must be certified under the [Developer Certificate of Origin](https://developercertificate.org/). Use the repository's configured real `user.name` and active `user.email`.

Always create commits with `git commit -s`, for example:

```sh
git commit -s -m "docs: add contribution guidelines"
```

The `-s` flag must append a trailer in this form:

```text
Signed-off-by: Jane Doe <jane.doe@example.com>
```

Do not create unsigned commits, fabricate another person's sign-off, or replace the configured identity. When amending or rebasing is explicitly requested, preserve or restore valid sign-offs on every resulting commit. Do not commit unless the user requested it.
