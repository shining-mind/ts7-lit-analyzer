# Code Factory agent prompt

Fill the placeholders and give this prompt to the implementation agent. For rework, resume the same agent and append the review feedback instead of starting a new agent.

```text
Implement the approved OpenSpec change `<change-name>` in the dedicated worktree `<worktree-path>`. The change artifacts are already present under `openspec/changes/<change-name>/`; the linked issue is #<issue-number> and the base branch is `<base-branch>`.

Work only in this worktree. Do not edit the orchestrator's checkout or another agent's worktree. You own this worktree until you finish or pause.

Before editing:
- Read `AGENTS.md` and every routed document applicable to your actions.
- Read the complete change artifacts and linked issue.
- Run `pnpm exec openspec instructions apply --change <change-name> --json` and follow the returned task source paths and lines.
- Check that the worktree and branch match the requested change and base.

Implement every pending task with the smallest focused change that satisfies the approved spec. Do not add unapproved behavior or claim unverified TS7 or editor capabilities. If the implementation reveals a design problem or blocker, stop and report it instead of silently changing scope.

After each verified task, mark its checkbox and rerun the apply instructions to confirm progress. Add or update meaningful tests and documentation required by the change.

Run all applicable build, typecheck, lint, format, package, integration, and Extension Host checks required by the project instructions and change tasks. Confirm generated or temporary files are not included accidentally.

Create focused worktree-local commits as authorized by Code Factory. Every commit must follow Conventional Commits and be created with `git commit -s`, preserving the configured identity and DCO trailer. Do not push, create a PR, sync or archive specs, or change external services unless the orchestrator explicitly requests it.

Before finishing, ensure the branch contains the current `<base-branch>` changes when requested by the orchestrator. Resolve conflicts locally and preserve DCO sign-offs. Leave the worktree clean and all deliverable changes committed.

Return a compact, technically complete handoff:
- implemented behavior and files changed;
- commit hashes;
- exact validation commands and outcomes;
- OpenSpec task progress;
- remaining limitations or blockers;
- confirmation that the worktree is clean.

For a rework cycle, address the supplied review feedback in this same worktree, update the change artifacts if the approved plan changed, add focused DCO-signed commits, and rerun the applicable validation.
```

## Required placeholders

- `<change-name>` — the approved OpenSpec change name.
- `<worktree-path>` — the absolute path to the dedicated worktree.
- `<issue-number>` — the linked GitHub issue number.
- `<base-branch>` — the branch the implementation started from and must remain current with.

For rework, append the staged review findings and any approved spec revisions. Do not replace the original context with only the feedback.
