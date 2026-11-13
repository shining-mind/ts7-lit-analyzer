# Code Factory

Use this workflow when approved OpenSpec changes are implemented by background agents while the main session continues planning and review. The orchestrator schedules work and reviews results; implementation details belong in the [Code Factory agent prompt](./code-factory-agent-prompt.md).

## Scheduling invariants

- The main session plans exactly one change at a time. Never draft two changes concurrently.
- The main session reviews exactly one agent result at a time. Never stage or compare two agent results together.
- Planning and review are mutually exclusive modes. Switch between them at defined checkpoints rather than interleaving their edits.
- `wip_limit` controls how many dispatched but unaccepted changes may exist in Code Factory. It defaults to 3 and can be changed by the user for the session. The limit includes implementation in progress, results awaiting review, and results in rework; it is not merely a limit on running agent processes.
- An agent finishing does not free a feature slot. Only user acceptance of the result frees it. Until acceptance, retain its worktree and branch.
- When the number of unaccepted results reaches `wip_limit`, do not plan or dispatch another change. Review existing results one at a time until a slot is freed.
- Keep the cycle moving within that capacity: plan while below `wip_limit` and no review is ready; otherwise review one completed result. Never exceed the limit merely to stay busy. If all available feature slots are still running and no result is ready, wait for the next completion.
- Changing `wip_limit` affects subsequent scheduling and does not cancel existing work. If the user lowers it below the current unaccepted count, finish and review existing results without planning or dispatching until the count is below the new limit.
- Review completed results in completion order unless the user sets another priority.

## 1. Plan and approve one change

Start planning only when the unaccepted count is below `wip_limit` and no result is waiting for review.

The user selects the next issue or approved proposal. If the user has not explicitly named one, ask before starting; do not infer the next task from issue numbering, project-board order, or dependencies alone.

Work in the main checkout until the change has a linked issue, complete required artifacts, concrete testable scenarios, and implementation tasks. Validate it with `openspec validate --strict` and obtain user approval before delegation.

Do not start another planning task while a review is pending. If an agent completes during planning, finish and approve the current change first, dispatch it within `wip_limit`, and then switch to one queued review.

## 2. Dispatch an isolated implementation

Create a dedicated branch and worktree from the current approved base branch. Keep worktrees under the ignored `.worktrees/` directory and name both branch and directory after the change.

Move the approved change directory from the main checkout into the same `openspec/changes/` location in the worktree. Do not leave a copy in the main checkout: the worktree becomes the single source of truth for that active change.

Fill every placeholder in [the agent prompt](./code-factory-agent-prompt.md) and launch the implementation agent in that worktree. One worktree has one active change and one owning agent. Do not edit its contents while the agent is running.

The agent returns its implementation, validation, and status for the orchestrator's review. Retain the branch and worktree until the result is accepted, including while it awaits review or rework.

## 3. Continue the pipeline

After dispatch, plan one next change only if the unaccepted count is below `wip_limit` and no review is ready. Never plan a second change in parallel with the first.

When another agent finishes, add its result to the review queue. Complete the current planning checkpoint before selecting a review. If no review is ready and capacity remains, continue planning; if a review is ready, do not start a new planning cycle before reviewing it. Once the unaccepted count reaches `wip_limit`, stop new planning and process the review queue.

## 4. Stage one result for review

Before review, ensure the agent's branch contains the current base-branch changes and its worktree is clean. Ask the agent to synchronize its branch if needed.

Review exactly one branch against the current base. Generate a binary-capable patch and apply it to the main session's index without merging or checking out the agent branch:

```sh
git diff --binary <base>..<agent-branch> > .worktrees/<change>.patch
git apply --index .worktrees/<change>.patch
```

This stages additions, modifications, deletions, and renames for review with `git diff --cached`. The agent branch and commits remain unchanged. If the current branch is protected, create the final review branch before applying the patch; do not commit directly to protected `main`.

The main checkout must not contain another agent's staged patch or an active change draft at this point. Preserve unrelated user work and stop on conflicts instead of resetting it.

Inspect the staged diff, run the applicable checks on the staged deliverable, and verify that the implementation matches its approved spec and does not claim unverified behavior.

## 5. Request rework or accept

For rework, keep the review scoped to this agent and its existing feature slot. Apply any approved spec revisions in its worktree, record the review findings, and resume the same agent with the rework portion of the agent prompt so it retains context.

Before applying an updated result, reverse the exact previously staged patch:

```sh
git apply -R --index .worktrees/<change>.patch
```

If reversal fails because the staged result was edited manually, stop and resolve the difference explicitly; never use `reset --hard` or discard user edits. Then generate and stage the new patch as above.

For acceptance, follow the commit and pull-request requirements. Sync and archive the OpenSpec change only after implementation and validation are accepted. Update PR links to the main spec and archived change. Remove the worktree only when its result is preserved and no further rework is expected. Acceptance frees one feature slot; redelegation for rework does not.

After acceptance or redelegation, select exactly one next action: the oldest queued review, dispatch of an approved change within `wip_limit`, or planning of one user-selected new change within `wip_limit`. Do not leave an actionable review or approved implementation waiting while starting unrelated work.

## Safety and traceability

- Keep one active change per worktree and one owner of that worktree at a time.
- Do not share build outputs or mutable fixtures between concurrent agents without an existing isolation mechanism.
- Do not force-push, delete remote branches, or rewrite public history as part of this pipeline.
- Preserve issue links, OpenSpec artifacts, DCO trailers, and unrelated work throughout every cycle.
- If the scheduler or patch workflow conflicts with user edits, pause and report rather than choosing a destructive shortcut.
