# Spec Delta

## ADDED Requirements

### Requirement: Inherited class-level documentation

The engine SHALL merge class-level JSDoc metadata — events, slots, CSS parts/properties/states, and summary — from checker-resolved base classes into derived component records at collection or enrichment time. Subclass documentation SHALL take precedence over base documentation, declaration authority SHALL be preserved, and the engine SHALL record which base declaration supplied inherited documentation. Render implementations MUST NOT be inspected for this metadata.

#### Scenario: Dependency base events

- **WHEN** a registered component inherits from a dependency base class whose declarations document `@fires` events
- **THEN** the component record includes those events with evidence identifying the base declaration

#### Scenario: Local base slots and CSS metadata

- **WHEN** a vanilla base class documents `@slot`, `@csspart`, or `@cssprop` and a registered subclass inherits from it
- **THEN** the subclass record includes the inherited slot and CSS metadata without inspecting either render implementation

#### Scenario: Subclass documentation precedence

- **WHEN** both a base class and a subclass document the same event or slot name
- **THEN** the subclass documentation wins and the base fact does not duplicate it

#### Scenario: Declaration base authority

- **WHEN** a dependency base class has both declarations and JavaScript with differing documentation
- **THEN** inherited metadata follows the declaration documentation and no implementation-consistency conflict is invented

#### Scenario: Base class stays a non-component

- **WHEN** an unregistered base class contributes inherited documentation
- **THEN** it does not become a standalone component record solely because its metadata was inherited

### Requirement: Superclass declaration provenance

Superclass references SHALL carry the canonical package name when the checker-resolved base class belongs to a dependency package, and the declaration module path when it belongs to another module; dependency bases SHALL carry both. Local bases SHALL carry module identity without a package name, and built-in bases SHALL carry only the class name without fabricated package or module identity.

#### Scenario: Dependency superclass

- **WHEN** a component's checker-resolved base class is declared in a dependency package
- **THEN** the superclass reference includes the canonical package name and the declaration module path alongside the class name

#### Scenario: Dependency base through a relative import

- **WHEN** a component's base class is imported through a relative specifier inside a dependency package
- **THEN** the superclass reference still includes the dependency's canonical package name and declaration module path, resolved through the checker rather than the import specifier form

#### Scenario: Local superclass

- **WHEN** a component extends a base class declared in another project module
- **THEN** the superclass reference includes the module identity without a package name

#### Scenario: Same-module superclass

- **WHEN** a component extends a base class declared in the same module
- **THEN** the superclass reference includes that module's path without a package name

#### Scenario: Built-in superclass

- **WHEN** a component extends `HTMLElement` directly
- **THEN** the superclass reference carries the class name without a fabricated package or module identity

### Requirement: Base-documentation caching

The engine SHALL cache base-class documentation within a discovery session as isolated per-class entries keyed by declaration identity, each holding the class's own documentation fragment and a base-link stored as declaration identity rather than merged base data. Collection SHALL follow cached links and re-merge each time. The cache SHALL be intra-session and SHALL preserve declaration authority and the current-snapshot boundary.

#### Scenario: Shared base reused across components

- **WHEN** multiple components inherit a common base chain within one session
- **THEN** each distinct base class is resolved once and reused for the other components, rather than re-resolved per component

#### Scenario: Own-file invalidation propagates through links

- **WHEN** a base class's own file changes and the session updates
- **THEN** only that base's cached entry is invalidated, dependent components refresh their inherited documentation through their retained base-links, and subclass entries whose own files are unchanged are not re-resolved

#### Scenario: Concurrent misses coalesce

- **WHEN** several components sharing a base are collected or enriched concurrently and all miss that base's entry
- **THEN** a single resolution is issued and the concurrent walks await it, rather than each issuing its own checker resolution

#### Scenario: Stale in-flight resolution is rejected

- **WHEN** a base entry is invalidated or the snapshot changes while its resolution is in flight
- **THEN** the completing resolution is discarded rather than cached as fresh, and a subsequent collection resolves against the current snapshot

#### Scenario: Failed resolution is retryable

- **WHEN** a base resolution fails
- **THEN** its in-flight promise is evicted so a later collection can retry rather than reusing a cached failure

#### Scenario: Declaration authority preserved through the cache

- **WHEN** a cached base class has both declarations and JavaScript with differing documentation
- **THEN** cached and refreshed inherited metadata follow the authoritative declaration, consistent with uncached collection
