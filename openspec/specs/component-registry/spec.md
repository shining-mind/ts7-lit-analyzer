# component-registry Specification

## Purpose

Provides the host-independent web-component registry in the analyzer core: adopted discovery contracts, indexing and lookup over discovery records, snapshot-scoped views, explicit completeness, and checker-only semantic operations shared by the CLI and editor hosts.

## Requirements

### Requirement: Framework-neutral registry contracts

The registry SHALL adopt the discovery engine's host-safe contracts as its public API: Custom Elements Manifest schema DTOs as the extensible base for declarations, members, attributes, events, slots, and CSS metadata, with identity, registration evidence, provenance, semantic references, and completeness as separate extensions. The core SHALL re-export these contracts without redefining them. Contracts MUST NOT contain live TypeScript runtime handles or Lit-specific fields.

#### Scenario: Serializable contracts

- **WHEN** a registry entry is serialized to JSON and parsed back
- **THEN** all contract fields survive without TypeScript API objects, functions, or overlay text

#### Scenario: Vanilla and Lit share one contract

- **WHEN** a vanilla `HTMLElement` component and a Lit component are represented in the registry
- **THEN** both use the same contract shapes, with framework differences confined to generic evidence and strategy fields

#### Scenario: Direct record adoption

- **WHEN** the registry receives discovery results from the engine
- **THEN** records are indexed without structural adaptation or contract translation

### Requirement: Component lookup by tag and declaration identity

The registry SHALL resolve components by registered tag name and by stable declaration identity, and SHALL expose component iteration with project and package identity. Lookup misses SHALL be explicit absences, not errors or fabricated entries.

#### Scenario: Registered tag lookup

- **WHEN** a consumer looks up a tag registered by a project or dependency component
- **THEN** the registry returns the component entry with its registrations, declaration identity, and provenance

#### Scenario: Unknown tag

- **WHEN** a consumer looks up a tag that no included component registers
- **THEN** the registry reports an explicit absence without inventing a component

#### Scenario: Stable identity across edits

- **WHEN** an overlay changes a component's source offsets without changing its module or class identity
- **THEN** the declaration identity remains stable while source-range evidence updates

### Requirement: Member, attribute, event, and slot access

The registry SHALL expose property, attribute, event, and slot access for a component, including attribute-to-property alias resolution derived from discovery metadata. Member access SHALL distinguish documented metadata from semantic member data.

#### Scenario: Property access

- **WHEN** a consumer requests a declared property of a component
- **THEN** the registry returns the member with its declaration evidence and semantic reference when collected

#### Scenario: Attribute alias resolution

- **WHEN** a consumer resolves an attribute name that discovery maps to a differently named property
- **THEN** the registry returns the aliased property and retains the attribute-to-property mapping evidence

#### Scenario: Event and slot access

- **WHEN** a component documents events or slots
- **THEN** the registry returns the documented event and slot records with their metadata provenance

### Requirement: Inheritance and declaration references

The registry SHALL expose superclass references with package and module identity when available, and inherited member origins through declaration evidence. Inheritance data SHALL come from discovery records without re-walking TypeScript ASTs in the registry.

#### Scenario: Dependency superclass reference

- **WHEN** a component inherits from a base class declared in a dependency
- **THEN** the registry exposes the superclass reference with the dependency's package and module identity

#### Scenario: Inherited member origin

- **WHEN** a component exposes a member declared in a base class
- **THEN** the member's declaration evidence identifies the base declaration rather than the subclass

### Requirement: Snapshot-scoped registry views

A registry view SHALL identify its project, snapshot, and generation. Applying a successor discovery result SHALL replace the view's data while unaffected entries may be structurally reused. Views SHALL expose snapshot-level overlay provenance without overlay text.

#### Scenario: View identity

- **WHEN** a registry view is created from a discovery result
- **THEN** the view reports the result's project, snapshot, generation, `containsOverlays`, and `overlayFiles`

#### Scenario: Successor replaces the view

- **WHEN** an overlay update produces a successor discovery result applied to the registry
- **THEN** affected entries reflect the update, unaffected entries remain available, and the view reports the successor snapshot and generation

#### Scenario: Unsaved dependency change

- **WHEN** an overlay changes a dependency member type consumed by a project component
- **THEN** the successor view exposes the updated consumer-facing semantics and the previous view retains its original data

### Requirement: Explicit completeness and unsupported metadata

The registry SHALL surface per-capability completeness as complete, incomplete, or not-collected, together with discovery issues. Empty optional metadata SHALL be presented as undocumented, never as confirmed absence, and incomplete semantics MUST NOT be presented as successful analysis.

#### Scenario: Unenriched entry

- **WHEN** a lazy-mode entry has not been semantically enriched
- **THEN** the registry reports its semantic capabilities as not-collected rather than complete or empty-success

#### Scenario: Incomplete member

- **WHEN** discovery marks a member's semantics incomplete with an issue
- **THEN** the registry surfaces the incompleteness and the issue instead of a resolved type

#### Scenario: Undocumented slots

- **WHEN** a component has no documented slot metadata
- **THEN** the registry reports slot coverage as undocumented or unknown, not as a confirmed absence of slots

### Requirement: Checker-only semantic operations

Registry type queries and assignability SHALL delegate to the semantic provider using references from one project and snapshot. Contracts SHALL carry types only as opaque snapshot-scoped references and materialized display text, never as live TypeScript handles or a redeclared type model. CEM `type.text` SHALL remain display documentation and MUST NOT be used as an assignability input or fallback.

#### Scenario: Primitive assignability

- **WHEN** a consumer checks a string expression against a collected number property through the registry
- **THEN** the provider returns non-assignable using real checker types from the same snapshot

#### Scenario: Display text does not drive checking

- **WHEN** a member's `type.text` disagrees with its checker-resolved type
- **THEN** assignability uses the checker type and the text remains display-only

#### Scenario: Cross-snapshot rejection

- **WHEN** a semantic reference from another project or snapshot is supplied to a registry operation
- **THEN** the operation is rejected instead of mixing checker handles

#### Scenario: Live type query

- **WHEN** a consumer queries a member type after an overlay update
- **THEN** the returned text and reference come from the current snapshot

### Requirement: Dependency identity through exports and re-exports

The registry SHALL retain canonical declaration identity for dependency components reached through exports, renamed re-exports, and package-manager symlinks, while preserving consumer-facing module and export provenance.

#### Scenario: Renamed re-export

- **WHEN** a project imports a dependency component through a renamed re-export
- **THEN** the registry entry keeps the original declaration identity and records the consumer-facing alias and module provenance

#### Scenario: Symlinked package

- **WHEN** a dependency is reached through a package-manager symlink
- **THEN** declaration identity uses the canonical real path while provenance retains the consumer-facing package path

### Requirement: Discovery-backed registry session

A registry session SHALL compose a discovery session with the registry without requiring a Custom Elements Manifest: creation, collection, overlay updates, semantic operations, and disposal. The session SHALL delegate checker operations to the discovery engine and own no parallel TypeScript semantics.

#### Scenario: Consumer project session

- **WHEN** a session is created for a TypeScript project that imports project and dependency components
- **THEN** collection produces a registry view containing both project and dependency components with their identities

#### Scenario: Overlay update through the session

- **WHEN** the session applies an unsaved source or dependency overlay
- **THEN** the registry receives the successor view and semantic operations use the successor snapshot

#### Scenario: Disposal

- **WHEN** the session is disposed
- **THEN** native resources are released and further session operations are rejected

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

### Requirement: Module-resolution fallback visibility

Registry views SHALL forward the discovery result's optional module-resolution checker-fallback count without interpreting it or issuing additional requests.

#### Scenario: Instrumented registry view

- **WHEN** an instrumented discovery result records checker fallbacks
- **THEN** its registry view exposes the same count for host diagnostics

#### Scenario: Uninstrumented registry view

- **WHEN** discovery instrumentation is disabled
- **THEN** its registry view omits the fallback count
