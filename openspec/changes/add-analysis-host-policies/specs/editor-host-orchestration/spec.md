# Spec Delta

## Purpose

Coordinates VS Code documents, projects, and registry sessions so interactive analysis uses current unsaved content according to the selected trigger policy without publishing stale results, mixing project state, or retaining unbounded native sessions.

## ADDED Requirements

### Requirement: Open-document state tracking

The editor host SHALL track supported workspace documents by URI and document version. Dirty document text SHALL become analysis overlay input when the selected trigger policy runs analysis; saving or closing SHALL remove that overlay while retaining already collected scope data.

#### Scenario: Dirty document opened

- **WHEN** a supported document is opened with unsaved text
- **THEN** its project scope is scheduled for initial analysis and its URI, version, and text are available as overlay input

#### Scenario: Document changed

- **WHEN** a tracked document changes
- **THEN** the latest version and text replace its previous desired overlay input without losing the document state even if analysis is deferred

#### Scenario: Document saved or closed

- **WHEN** a tracked document is saved or closed
- **THEN** its unsaved overlay is removed and no later scheduled update reintroduces the old version

### Requirement: Per-document project association

The editor host SHALL use TS7's default-project association for a document when available, including inferred projects. Otherwise it SHALL apply an explicit configured/inferred fallback and own an independent lazy registry session per resident association.

#### Scenario: Several project configurations

- **WHEN** documents belonging to different tsconfig projects are open
- **THEN** each document uses its associated project and resident sessions retain distinct project identities

#### Scenario: Multi-root workspace

- **WHEN** workspace folders contain projects with the same relative configuration path
- **THEN** their documents and sessions remain isolated by workspace folder and canonical project identity

#### Scenario: Document without a configured project

- **WHEN** an open document has no configured project and TS7 or the spawned fallback associates it with an inferred project
- **THEN** the host analyzes it under a stable inferred-project identity without fabricating a tsconfig path

#### Scenario: Multiple containing projects

- **WHEN** a document belongs to multiple configured projects and a TS7 association is available
- **THEN** the host uses the default project returned by TS7 rather than choosing by configuration-path proximity

### Requirement: Configurable analysis triggers

The editor host SHALL provide `onType` and `onSave` analysis modes, defaulting to `onType`, plus configurable debounce and maximum-wait intervals for type-driven analysis. Both modes SHALL perform initial analysis on open and immediate save/close reconciliation.

#### Scenario: Type-driven analysis

- **WHEN** `onType` is selected and a tracked document changes
- **THEN** its latest state becomes eligible for analysis after the configured debounce using the coalesced serialized scheduler

#### Scenario: Continuous typing reaches maximum wait

- **WHEN** changes keep arriving before the trailing debounce expires for the configured maximum-wait interval
- **THEN** the oldest pending change makes the latest coalesced state due for analysis no later than that interval instead of restarting the wait indefinitely

#### Scenario: Maximum wait expires during an earlier run

- **WHEN** maximum wait expires while an earlier session mutation has not settled
- **THEN** one due run retains the latest coalesced state and starts after the earlier run settles without concurrent mutations or a promise of fixed completion latency

#### Scenario: Save-driven changes are deferred

- **WHEN** `onSave` is selected and a tracked document changes without being saved
- **THEN** the host updates only desired document state, marks the accepted view stale, and does not schedule analysis or mutate session overlays for that change

#### Scenario: Save-driven analysis

- **WHEN** a document is saved in either mode
- **THEN** its saved state is reconciled immediately, its unsaved overlay is removed, and any obsolete type-driven work is superseded

#### Scenario: Close in either mode

- **WHEN** a tracked document is closed in either mode
- **THEN** its overlay is removed immediately and subsequent publication for the closed document is rejected

### Requirement: Cross-project unsaved updates

When analysis is triggered, the editor host SHALL propagate the current open-document overlay set to every resident project session so edits in a referenced project are visible to dependent consumers. An evicted session SHALL receive the complete current overlay set when recreated rather than an incremental history.

#### Scenario: Referenced project document changes

- **WHEN** an analysis trigger accepts an unsaved edit to a component in one project consumed through a project reference by another resident project
- **THEN** the consumer session updates against the same current document version without mixing project or snapshot identities

#### Scenario: Evicted consumer catches up

- **WHEN** a project was evicted while relevant overlays changed and is subsequently reactivated
- **THEN** its replacement session reconciles the complete current overlay set before publishing a current view

### Requirement: Coalesced serialized scheduling

In `onType` mode, the editor host SHALL debounce and coalesce document changes per project while bounding postponement with maximum wait. In both modes it SHALL serialize session mutations and immediately reconcile save/close. Session creation or completion for a superseded workspace state SHALL NOT become current.

#### Scenario: Rapid consecutive changes

- **WHEN** several document versions arrive while type-driven work is pending or in flight
- **THEN** earlier work is logically cancelled or superseded and a following run applies only the latest coalesced state

#### Scenario: Save during debounce

- **WHEN** a document is saved while its project has pending scheduled work
- **THEN** pending timers are flushed or replaced so the saved state is applied without reintroducing its unsaved overlay

#### Scenario: Superseded session creation

- **WHEN** asynchronous session creation finishes after its project state has been superseded or disposed
- **THEN** the host disposes that session rather than publishing it as current

### Requirement: Bounded resident project sessions

The editor host SHALL enforce a configurable positive limit on live and asynchronously creating registry sessions. When the limit is reached, a newly active project SHALL obtain a slot through automatic LRU eviction of a non-active runtime rather than being denied analysis. The active editor's project SHALL have eviction priority protection, and document/project associations SHALL NOT count against the session limit.

#### Scenario: New project at the residency limit

- **WHEN** a document from another project becomes active while the resident-session limit is full
- **THEN** the least-recently-used eligible runtime is cancelled and disposed, after which the new project is created and analyzed without requiring the user to close another project

#### Scenario: Evicted runtime had in-flight work

- **WHEN** eviction selects a runtime with pending or in-flight work
- **THEN** that work is logically cancelled, settlement and disposal precede slot reuse, and no result from the evicted runtime is published

#### Scenario: Evicted dirty document is reactivated

- **WHEN** a document whose runtime was evicted becomes active or receives a new analysis trigger
- **THEN** the host recreates the session from the tracked URI, latest version, current text, and complete overlay state without losing unsaved edits

#### Scenario: Background broadcast would exceed the limit

- **WHEN** dirty overlays change while some associated projects are evicted
- **THEN** the broadcast updates resident sessions only and does not recreate evicted sessions merely to perform background work

### Requirement: Generation and document-version staleness

The editor host SHALL accept a result only when its project run, registry generation, contributing document versions, and residency ownership are current. Cancellation, eviction, or failure from superseded work SHALL NOT replace current state or surface as a current failure.

#### Scenario: Older operation finishes last

- **WHEN** an older analysis operation completes after a newer document version has been scheduled
- **THEN** its result is discarded and the latest accepted view corresponds to the newest complete input state

#### Scenario: Current operation fails

- **WHEN** the newest non-cancelled analysis operation fails
- **THEN** the host reports that failure with project identity while retaining the last known good view explicitly as stale

### Requirement: Leveled diagnostic output and opt-in measurements

The editor host SHALL write diagnostics to a VS Code Output channel using `normal`, `verbose`, and `debug` levels. Normal mode SHALL log only important lifecycle events, warnings, and errors and SHALL NOT enable TS7 timing, request timing snapshots, sample process memory, or run instrumentation timers solely for diagnostics. Verbose and debug modes MAY enable those measurements, with debug providing the most detailed correlated event metadata.

#### Scenario: Normal mode has no instrumentation overhead

- **WHEN** documents are analyzed with normal logging
- **THEN** no diagnostic memory sampler, instrumentation timer, TS7 timing collection, or timing-retrieval request is active

#### Scenario: Verbose operational diagnostics

- **WHEN** verbose logging is enabled and an analysis run completes
- **THEN** the Output channel records correlated routing, scheduling, lifecycle, duration, timing, and resource summaries without source text

#### Scenario: Module-resolution fallback diagnostics

- **WHEN** verbose or debug logging accepts an instrumented analysis result
- **THEN** its accepted-run summary includes the current result's module-resolution fallback count without module specifiers or source text

#### Scenario: Debug stale-result diagnostics

- **WHEN** debug logging is enabled and work is cancelled, evicted, or rejected as stale
- **THEN** the Output channel records the relevant project/session identity, document versions, run/generation identity, reason, and available timing/resource deltas without source text or AST dumps

#### Scenario: Instrumentation is disabled again

- **WHEN** the user returns from verbose or debug to normal logging
- **THEN** diagnostic samplers and timers stop and subsequent sessions run with TS7 timing disabled without requiring a VS Code restart

### Requirement: Honest registry memory diagnostics

Verbose/debug resource diagnostics SHALL distinguish per-runtime logical footprints from shared process memory. They SHALL NOT claim exact per-registry JavaScript consumption or native RSS without a supported process identity. Isolated probe measurements SHALL retain their attribution limitations.

#### Scenario: Registry resource summary

- **WHEN** a verbose/debug memory sample is taken after a lifecycle event or analysis run
- **THEN** it reports the runtime's logical footprint and the shared Extension Host memory sample with explicit scope and does not force garbage collection or create a heap profile

#### Scenario: Native memory cannot be attributed

- **WHEN** the active spawned TS7 API does not expose a supported process identity for a session
- **THEN** production diagnostics omit per-session native RSS rather than guessing from process-name matches

### Requirement: Editor lifecycle cleanup

Editor deactivation, project removal, and runtime eviction SHALL cancel pending work, clear timers and diagnostic samplers, dispose owned sessions, and prevent subsequent result publication. `deactivate()` SHALL await owned cleanup.

#### Scenario: Extension deactivation

- **WHEN** the extension deactivates with scheduled and in-flight work
- **THEN** all owned work is logically cancelled and all sessions are disposed without later publication

### Requirement: Real editor-host verification

Open/change/save/close behavior, both trigger modes, type-driven maximum wait, project routing, cross-project updates, LRU eviction/recovery, staleness, logging levels, and normal-mode instrumentation inactivity SHALL be exercised in a real Extension Development Host; deterministic scheduler tests alone SHALL NOT establish VS Code integration.

#### Scenario: Extension Host orchestration

- **WHEN** the orchestration fixture is exercised in the Extension Development Host
- **THEN** observed project/session state and document versions demonstrate the required routing, update, eviction, logging, and staleness behavior without claiming template diagnostics
