# Proposal

## Why

The parity matrix covers all 23 rule IDs, but several fixture references point to files that do not exist and the false-positive/false-negative audit is unfinished. Issue #1 needs an honest coverage record, not new analyzer functionality.

## What Changes

- Give every rule and feature row a real local fixture, a pinned upstream reference, or an explicit `no upstream fixture` status.
- Explain the gaps for `no-invalid-attribute-name`, `no-invalid-tag-name`, `no-invalid-css`, and the three skipped `no-invalid-boolean-binding` scenarios.
- Audit the existing baseline scenarios for observable legacy false positives and false negatives; record only evidenced cases and the audit's limits.
- Remove placeholder paths and clarify that `pending` means missing coverage, not planned TS7 functionality.
- Update the verified issue #1 acceptance checkboxes without claiming complete feature parity.

## Capabilities

### New Capabilities

- `parity-reporting`: Accurate fixture references, baseline statuses, and known legacy accuracy limitations.

### Modified Capabilities

None.

## Impact

Changes `docs/parity.md` and issue #1 documentation only. No analyzer behavior, dependencies, or new semantic fixtures are required.

Links: #1.
