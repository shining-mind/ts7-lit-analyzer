# Proposal

## Why

Issue [#22](https://github.com/shining-mind/ts7-lit-analyzer/issues/22) remains open because the registry foundation delivered session/snapshot mechanics but not the host policies needed for interactive analysis. Research proved a minimal TypeScript 7 project-reference case, but the production session drops parsed `projectReferences` when it creates its synthetic program; cancellation and editor orchestration are absent, and TypeScript 7 timing is not exposed through the engine/core API.

## What Changes

- Preserve configured project references in eager and lazy discovery programs. Verify source redirection through referenced output paths and unsaved source changes in a referenced project without requiring generated declarations.
- Add additive, optional per-operation cancellation using host-neutral `AbortSignal`. Cancellation is logical: native requests may finish, but aborted operations reject at controlled checkpoints, do not publish results or commit session mutations, and leave the session usable. Do not claim native in-flight cancellation.
- Add explicit overlay removal so closing or saving a document can restore filesystem-backed content and correct `containsOverlays`/`overlayFiles` provenance.
- Expose opt-in TypeScript 7 timing collection and module-resolution checker-fallback counts through serializable engine metrics and reset operations; forward cancellation, overlay removal, and metrics through the core registry session without adding core semantics. Normal editor logging performs no timing requests, fallback counting, memory sampling, or instrumentation timers.
- Add VS Code host orchestration: open/dirty document tracking, explicit configured/inferred project association for spawned sessions, independent lazy session ownership, configurable `onType`/`onSave` analysis, debounced/coalesced scheduling with a maximum wait that prevents continuous typing from postponing analysis indefinitely, serialized per-project updates, cross-project overlay propagation, and latest-generation/document-version result acceptance. Preserve TS7 default-project routing as probe evidence for the future shared native-preview transport rather than an unused production session.
- Bound resident project sessions with a configurable LRU policy. A newly active project always receives analysis by evicting an older non-active runtime; document state survives eviction and later reactivation reconstructs current overlays.
- Add leveled VS Code Output diagnostics (`normal`, `verbose`, and `debug`) with correlated lifecycle, routing, scheduling, timing, and resource events. Verbose/debug modes collect logical registry footprints and shared Extension Host memory without claiming exact per-registry JavaScript bytes or logging source text.
- Verify the coordinator with deterministic scheduler tests and real Extension Development Host scenarios, including trigger modes, LRU recovery, and instrumentation disabled in normal mode. Template providers and diagnostics remain outside this change.
- Add reproducible instrumentation measurements and document preliminary, non-gating latency/memory/IPC budgets for the selected fixtures. Retain a regression test for the `getDeclaredTypeOfSymbol` anomaly and the location-based alternatives used by the engine.
- Out of scope: template analysis and diagnostics (#23/#24/#25), native-preview pipe integration and runtime-complete VSIX packaging (#25), native cancellation, solution-builder/watch APIs, runtime tsconfig/reference graph reloading, and comprehensive representative performance certification (#26).

## Capabilities

### New Capabilities

- `editor-host-orchestration`: VS Code ownership of open documents, project routing, lazy session scheduling, cross-project updates, stale-result rejection, and disposal.

### Modified Capabilities

- `ts7-component-discovery`: preserve project references, support logical cancellation and overlay removal, and expose opt-in serializable timing metrics.
- `component-registry`: forward the new operation controls, overlay removal, and timing metrics through the existing single-project session while preserving checker-only semantics.

## Impact

- `packages/cem-analyzer-ts7`: configuration and snapshot construction, additive session operation options and methods, lifecycle/cancellation checkpoints, tests, and anomaly/performance evidence.
- `packages/analyzer-core`: additive registry-session forwarding and contract re-exports; no new semantic implementation or host-specific APIs.
- `packages/vscode-extension`: activation lifecycle, host coordinator and scheduler, analysis/logging settings, Output diagnostics, bounded session residency, orchestration fixtures, and real Extension Development Host tests.
- Documentation and research: current API limitations, cancellation semantics, project-reference boundaries, reproducible measurements, and preliminary budgets feeding #26.
- No new runtime dependencies are planned; use the pinned TypeScript 7 and VS Code APIs already present.
