# Spec Delta

## ADDED Requirements

### Requirement: Deferred lazy initialization

A lazy-mode session SHALL perform no module-graph construction or component collection at creation time. The first scoped request SHALL trigger the work needed for that scope. Eager-mode sessions SHALL retain the verified one-shot initialization behavior.

#### Scenario: No work before the first request

- **WHEN** a lazy-mode session is created and no scoped request is made
- **THEN** no module graph or component collection is performed and no components are returned

#### Scenario: First request initializes the scope

- **WHEN** the first scoped request names project files
- **THEN** the engine builds the scope required by those files and returns their reachable components

#### Scenario: Eager mode unchanged

- **WHEN** an eager-mode session is created and collected
- **THEN** initialization and results match the verified one-shot contract

#### Scenario: Empty scope stays uninitialized

- **WHEN** a scoped request names no files and no scope is active
- **THEN** no snapshot or index is constructed and the result is empty

### Requirement: Scoped roots and incremental scope extension

Lazy collection SHALL start from a caller-supplied file subset and include its component-relevant semantic closure. Extending the scope SHALL add newly reached modules and records without rebuilding unaffected records, and SHALL NOT seed unreferenced packages.

#### Scenario: Opened-file scope reaches dependencies

- **WHEN** the scope names a consumer file that imports a dependency component
- **THEN** the dependency component is discovered without its file being opened

#### Scenario: Scope extension reuses records

- **WHEN** another file is added to the active scope
- **THEN** previously collected unaffected records are structurally reused

#### Scenario: Unreferenced package excluded

- **WHEN** an installed package is absent from the project import closure
- **THEN** its components are not added

### Requirement: Project-wide registration index

The engine SHALL maintain a syntactic index of supported registrations, tag-map entries, and decorators across the project file set and its import closure without collecting member types. The index SHALL make cross-file registrations and unopened dependency components discoverable and SHALL refresh on overlays. Entries without semantic enrichment SHALL report `not-collected` capabilities.

#### Scenario: Cross-file registration discoverable

- **WHEN** a component class is registered in a file outside the active scope
- **THEN** the index links the tag to the class and the component becomes discoverable

#### Scenario: Unenriched entry is unknown

- **WHEN** an indexed component has not been semantically enriched
- **THEN** its semantic capabilities are `not-collected`, never complete

#### Scenario: Index refresh on overlay

- **WHEN** an overlay adds or removes a supported registration
- **THEN** the successor generation's index reflects the change

#### Scenario: Dependency reached only from an out-of-scope root

- **WHEN** a project root outside the active scope imports and registers a dependency component
- **THEN** the index includes that component with its declaration provenance and package identity, and enrichment can collect its semantics

### Requirement: On-demand semantic enrichment

The engine SHALL enrich indexed components with checker-backed class semantics per component on request, using the current project and snapshot, and SHALL record per-capability completeness at enrichment time. Eager mode SHALL continue to collect all components in one pass.

#### Scenario: Enrich on request

- **WHEN** a consumer requests semantics for an indexed component
- **THEN** the engine returns checker-derived members and per-capability completeness for that component

#### Scenario: Unrequested semantics stay unknown

- **WHEN** no enrichment is requested for an indexed component
- **THEN** its semantic capabilities remain `not-collected`

### Requirement: On-demand type resolution

In lazy mode the registry SHALL store identity, evidence, and framework metadata without eagerly materialized type text. Semantic types SHALL resolve from the current snapshot's checker at query time, and type text SHALL materialize on request or at serialization. Assignability SHALL keep the same-project and same-snapshot invariant.

#### Scenario: Live type query after an overlay

- **WHEN** a consumer queries a member type after an overlay update
- **THEN** the resolved type reflects the current snapshot

#### Scenario: Serialization materializes text

- **WHEN** a lazy-mode result is serialized for CLI or manifest output
- **THEN** type text is materialized from the current snapshot

#### Scenario: Cross-snapshot rejection preserved

- **WHEN** a semantic reference from another project or snapshot is supplied
- **THEN** the operation is rejected instead of mixing checker handles

### Requirement: Candidate pre-filter

Full member semantics SHALL be collected only for checker-confirmed component candidates in both modes. The pre-filter SHALL preserve the discovered component set of unfiltered collection.

#### Scenario: Non-component skipped

- **WHEN** an exported class is not a framework component candidate
- **THEN** its full member semantics are not collected

#### Scenario: Component set preserved

- **WHEN** the same project is collected with and without the pre-filter
- **THEN** the discovered component records are equivalent

### Requirement: Scoped incremental updates

Lazy-mode overlay updates SHALL apply the verified incremental-update, module-graph, and resolution-input guarantees within the active scope. A scoped update SHALL still invalidate in-scope records that depend on changed out-of-scope files, and SHALL NOT enrich records outside the active scope.

#### Scenario: Scoped edit updates affected records

- **WHEN** an overlay changes a file inside the active scope
- **THEN** affected in-scope records update and unaffected in-scope records are structurally reused

#### Scenario: Out-of-scope dependency still invalidates

- **WHEN** an overlay changes an out-of-scope base class of an in-scope component
- **THEN** the dependent in-scope component updates while unrelated in-scope records are reused

#### Scenario: Stale references of invalidated records are rejected

- **WHEN** an overlay invalidates an enriched record whose member type changed
- **THEN** a previously issued reference for that record is rejected and the caller must re-query

#### Scenario: Reused record references survive

- **WHEN** an overlay leaves an enriched record structurally reused
- **THEN** a previously issued reference for that record resolves through the successor snapshot

### Requirement: Bounded snapshot retention

Sessions SHALL support an explicit retention bound for retained snapshots. Without a bound, retention SHALL preserve the verified default behavior. Disposal SHALL release current and retained native resources according to session ownership.

#### Scenario: Bound honored

- **WHEN** a retention bound is configured and more updates occur than the bound allows
- **THEN** no more previous snapshots than the bound are retained

#### Scenario: Default unchanged

- **WHEN** no retention bound is configured
- **THEN** retention and disposal match the verified default behavior

### Requirement: Generation identity

Each result SHALL carry a monotonically increasing session generation identity in addition to snapshot identity so hosts can discard stale results. Generation identity SHALL NOT replace project and snapshot validation for semantic operations.

#### Scenario: Generations increase

- **WHEN** two successive updates complete
- **THEN** their results carry increasing generation identities

#### Scenario: Staleness remains host policy

- **WHEN** a host discards an older generation's result
- **THEN** semantic operations still validate project and snapshot identity independently
