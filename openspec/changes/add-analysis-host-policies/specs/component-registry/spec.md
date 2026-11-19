# Spec Delta

## ADDED Requirements

### Requirement: Registry operation cancellation

Registry-session analysis, query, scope, enrichment, and update operations SHALL accept and forward optional cancellation signals to the discovery engine. Cancelled operations SHALL NOT replace the current registry view.

#### Scenario: Cancelled collection

- **WHEN** a registry collection is cancelled while engine analysis is in flight
- **THEN** the operation rejects and the previous registry view remains current

#### Scenario: Cancelled semantic query

- **WHEN** a registry semantic query is cancelled
- **THEN** the rejection is propagated without constructing a parallel type answer in the core

### Requirement: Registry overlay removal

Registry sessions SHALL expose overlay removal through the composed discovery session and apply the successor result as a new registry view.

#### Scenario: Closing an unsaved source overlay

- **WHEN** a registry session removes an unsaved overlay
- **THEN** the current view uses configured content and exposes the corrected snapshot overlay provenance

### Requirement: Diagnostic TypeScript timing access

Registry sessions SHALL expose the engine's serializable timing snapshot and reset operation for editor diagnostics and performance probes without measuring or synthesizing semantic metrics in the core. Timing collection SHALL remain disabled unless explicitly requested by the host.

#### Scenario: Instrumented registry session

- **WHEN** a registry session is created with timing enabled and collects a view
- **THEN** its timing snapshot exposes the engine's request, latency, and IPC measurements

#### Scenario: Disabled registry instrumentation

- **WHEN** timing is not enabled for a registry session
- **THEN** the session reports disabled, zeroed metrics and normal collection behavior is unchanged
