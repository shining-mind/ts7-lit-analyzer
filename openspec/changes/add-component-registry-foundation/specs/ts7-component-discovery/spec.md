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
