# Spec Delta

## ADDED Requirements

### Requirement: Configured project-reference preservation

Consumer discovery SHALL preserve parsed project references in its synthetic programs so TypeScript source redirection applies in eager and lazy modes. Generated declaration output SHALL NOT be required for referenced source analysis.

#### Scenario: Referenced output import redirects to source

- **WHEN** a consumer project references a composite project and imports a component through that project's configured output path
- **THEN** discovery resolves the referenced source declaration and collects the component without requiring the output file to exist

#### Scenario: Unsaved referenced-source change

- **WHEN** an overlay changes a public member type in a referenced project's source
- **THEN** the successor result exposes the updated type and the previous snapshot retains its original result

#### Scenario: Lazy referenced-source enrichment

- **WHEN** a lazy consumer scope reaches a component through a project-reference output import and enriches it
- **THEN** enrichment uses the redirected source declaration and the current snapshot

### Requirement: Logical operation cancellation

Session analysis, query, scope, enrichment, and update operations SHALL accept an optional cancellation signal. Once cancelled, an operation SHALL reject and SHALL NOT publish a result or commit its session mutations; native in-flight request termination MUST NOT be claimed.

#### Scenario: Pre-cancelled operation

- **WHEN** an operation is called with an already-aborted signal
- **THEN** it rejects with the abort reason before starting operation work

#### Scenario: Cancelled overlay update

- **WHEN** cancellation occurs while an overlay update is in flight
- **THEN** no successor becomes current, the prior overlay state is restored, and a later collection remains usable and reflects the prior content

#### Scenario: Cancelled lazy scope extension

- **WHEN** cancellation occurs while a lazy scope request is in flight
- **THEN** the requested scope and result are not committed and the existing active scope remains usable

#### Scenario: Native request completes after cancellation

- **WHEN** the underlying TypeScript request cannot be cancelled and completes after the operation was aborted
- **THEN** its completion is not published as a successful current operation

### Requirement: Explicit overlay removal

Sessions SHALL remove named unsaved overlays without requiring replacement text. Removal SHALL restore the configured virtual or filesystem content and update snapshot overlay provenance.

#### Scenario: Last overlay removed

- **WHEN** a session removes its only overlay
- **THEN** the successor uses the original configured content and reports `containsOverlays: false` with no removed file in `overlayFiles`

#### Scenario: One of several overlays removed

- **WHEN** one overlay is removed while others remain
- **THEN** only that file returns to configured content and the remaining overlay identities stay visible

#### Scenario: Lazy overlay removal

- **WHEN** an overlay is removed in lazy mode with an active scope
- **THEN** affected in-scope records refresh from configured content without enriching out-of-scope records

### Requirement: Opt-in discovery timing

Sessions SHALL expose serializable TypeScript 7 timing metrics only when instrumentation is enabled, including request counts, round-trip/server/transport timing, IPC byte counts, and node-materialization totals. Reset SHALL clear client and server measurement history.

#### Scenario: Instrumentation disabled by default

- **WHEN** a session is created without timing instrumentation
- **THEN** its metrics report disabled collection and zeroed totals

#### Scenario: Instrumented collection

- **WHEN** an instrumented session performs collection
- **THEN** its metrics contain serializable nonzero request and IPC measurements without TypeScript handles or overlay text

#### Scenario: Timing reset

- **WHEN** an instrumented session resets its timing history
- **THEN** subsequent metrics count only requests made after the reset, apart from the documented timing retrieval request itself

### Requirement: Declared-type anomaly regression evidence

The engine SHALL retain executable evidence that property semantics use verified symbol/location-based checker operations rather than the anomalous `getDeclaredTypeOfSymbol` path on the pinned TypeScript version.

#### Scenario: Referenced property type remains correct

- **WHEN** the regression fixture resolves a referenced component property whose declared-type shortcut returns an anomalous result
- **THEN** the engine still returns the real property type before and after an unsaved referenced-source update

### Requirement: Reproducible host-policy measurements

The change SHALL provide a reproducible probe and report covering cold/warm operation latency, JavaScript and native memory, request counts, and IPC for selected eager/lazy fixtures, with explicit preliminary non-gating budgets and environment details.

#### Scenario: Measurement report

- **WHEN** the documented probe is run on the pinned runtime and fixture
- **THEN** it emits comparable operation metrics and the report distinguishes measured baselines, preliminary budgets, and unverified representative-project performance
