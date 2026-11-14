# Spec Delta

## Purpose

Collects framework-relevant web-component facts and real TypeScript 7 semantics from project sources and public dependency APIs without executing user code.

## ADDED Requirements

### Requirement: Checker-backed component collection

The engine SHALL use TypeScript 7 programs and checkers for parsing, symbols, aliases, inheritance, members, JSDoc, and types. It MUST NOT implement a parallel class/type analyzer or execute discovered modules.

#### Scenario: TypeScript component

- **WHEN** a project TypeScript class declares fields, accessors, and methods
- **THEN** the engine returns their checker-derived declarations, signatures, types, and source identity

#### Scenario: JavaScript inheritance

- **WHEN** a raw JavaScript component inherits public members from another JavaScript class
- **THEN** the checker resolves the base chain and inherited member origins without a custom inheritance walk

### Requirement: Explicit inputs and semantic module inclusion

Standalone collection SHALL receive roots explicitly from the caller; consumer-project collection SHALL derive dependency entrypoints from actual project imports. The engine SHALL include their required semantic closure without fixed-depth assumptions, arbitrary package-public-root inference, or unreferenced package scans.

#### Scenario: Standalone input roots

- **WHEN** a one-shot caller supplies package or source entrypoints
- **THEN** the engine analyzes their reachable component semantics without guessing additional public entrypoints

#### Scenario: Consumer-project dependency roots

- **WHEN** project TypeScript imports a dependency component entrypoint
- **THEN** that resolved entrypoint seeds dependency discovery and its required semantic closure

#### Scenario: Internal re-export chain

- **WHEN** a public JavaScript entrypoint reaches a component through multiple relative re-exports
- **THEN** every required module is included and the consumer-facing member has its real type rather than an exclusion-induced `any`

#### Scenario: Transitive package re-export

- **WHEN** package A reaches a component through package B
- **THEN** the engine includes the required public semantic modules from both packages

#### Scenario: Unreferenced package

- **WHEN** an installed package is absent from the included project/dependency graph
- **THEN** the engine does not add its components

### Requirement: Canonical module and declaration identity

The engine SHALL resolve package exports, `main`, ESM, CommonJS, aliases, and re-exports to canonical declarations. Package identity SHALL use canonical real paths while retaining consumer-facing module and export provenance.

#### Scenario: Named alias

- **WHEN** a consumer imports a component through a renamed export
- **THEN** the result retains the exported alias and resolves the original class declaration

#### Scenario: Pnpm symlink

- **WHEN** a dependency is reached through a package-manager symlink
- **THEN** declaration identity uses the resolved real path and provenance retains the consumer-facing package path

### Requirement: Declaration authority

When declarations are available, they SHALL be the sole authority for public class shape, inheritance, members, and semantic types. JavaScript SHALL only supplement registration or framework metadata; the engine MUST NOT compare or reconcile declaration and implementation shape.

#### Scenario: Declaration and implementation types differ

- **WHEN** a declaration and its JavaScript implementation describe different member types
- **THEN** the engine returns the declaration type and does not report a conflict

#### Scenario: Declaration and implementation exports differ

- **WHEN** an export described by declarations is absent from JavaScript
- **THEN** declaration-backed public semantics remain valid and no implementation-consistency error is invented

#### Scenario: JavaScript without declarations

- **WHEN** no declaration is available for an included JavaScript component
- **THEN** the engine uses checker-inferred JavaScript and JSDoc semantics

### Requirement: CEM-based discovery records

Base declaration, member, attribute, event, slot, CSS part/property/state, inheritance, and documentation DTOs SHALL use the Custom Elements Manifest schema. TS7 identity, evidence, provenance, semantic references, and completeness SHALL remain separate extensions rather than parallel replacements for CEM fields.

#### Scenario: Declaration DTO

- **WHEN** the engine returns a discovered custom-element class
- **THEN** its base declaration and metadata conform to the CEM schema without containing TypeScript API objects

#### Scenario: Semantic extension

- **WHEN** a CEM member has an associated checker type
- **THEN** the snapshot-scoped semantic reference is attached separately from CEM `type.text`

### Requirement: Framework collection strategies

The engine SHALL separate framework recognition into strategies with built-in vanilla `HTMLElement` and Lit support. Strategies SHALL produce framework evidence and metadata while the checker remains the sole source of class, inheritance, member, and type semantics.

#### Scenario: Vanilla HTMLElement component

- **WHEN** a class extends `HTMLElement` directly or through a vanilla base class without using Lit
- **THEN** the vanilla strategy collects its registration and public metadata through checker-resolved inheritance

#### Scenario: Current or legacy Lit import

- **WHEN** a component derives from `LitElement` imported from `lit` or `lit-element`
- **THEN** the Lit strategy recognizes its framework metadata through the resolved class identity

#### Scenario: Multiple applicable strategies

- **WHEN** a Lit component is also an `HTMLElement` subclass
- **THEN** vanilla and Lit evidence compose without duplicating class semantics or replacing declaration-backed types

### Requirement: Registration and reactive metadata

The engine SHALL recognize supported literal global or direct custom `CustomElementRegistry.define`, `HTMLElementTagNameMap`, Lit custom-element decorators, reactive decorators or their compiled form, and static reactive-property configuration. It SHALL retain evidence and source ranges for each fact.

#### Scenario: Standard registration

- **WHEN** source registers a class with a literal tag name
- **THEN** the result links the tag, class declaration, and registration evidence

#### Scenario: Direct custom registry

- **WHEN** a source creates `new CustomElementRegistry()` and calls its `define` with a literal tag and component class
- **THEN** the result links the tag and class and records custom-registry scope plus registry declaration identity

#### Scenario: Attribute alias

- **WHEN** Lit reactive configuration maps a property to a different attribute name
- **THEN** the result retains the property, attribute alias, and configuration evidence separately from the declared type

#### Scenario: Vanilla observed attributes

- **WHEN** an `HTMLElement` subclass declares a static literal `observedAttributes` list and corresponding public accessors
- **THEN** the vanilla strategy links the attributes to checker-resolved members and retains their evidence

#### Scenario: Declaration-only tag mapping

- **WHEN** a declaration-only package provides `HTMLElementTagNameMap`
- **THEN** the engine resolves the tag and class without requiring JavaScript implementation analysis

### Requirement: Snapshot-scoped semantic references

Collected semantic references SHALL identify their project and snapshot and SHALL remain opaque outside the TS7 engine. Checker operations, including assignability, SHALL use real handles from one project and snapshot rather than display text.

#### Scenario: Primitive assignability

- **WHEN** the engine checks a string expression against a collected number property
- **THEN** it uses real checker types from the same snapshot and returns non-assignable

#### Scenario: Cross-snapshot reference

- **WHEN** a semantic reference is supplied to a different project or snapshot
- **THEN** the engine rejects the operation instead of mixing checker handles

### Requirement: Dependency public API boundary

Dependency collection SHALL be limited to consumer-facing component APIs. The engine MUST NOT analyze dependency render functions or provide analyzer diagnostics, hover, completion, or similar language features inside third-party dependency sources.

#### Scenario: Dependency with render logic

- **WHEN** an included dependency component contains render templates and internal implementation-only components
- **THEN** the engine collects its public API without analyzing those templates or registering implementation-only components merely because they are rendered

#### Scenario: Consumer uses dependency property

- **WHEN** project source consumes a collected dependency property
- **THEN** the dependency's declaration or JavaScript/JSDoc type remains available for consumer-side semantic operations

### Requirement: CEM-compatible JSDoc metadata

The engine SHALL collect `@attr`/`@attribute`, `@prop`/`@property`, `@part`/`@csspart`, `@slot`, `@cssprop`/`@cssproperty`, `@cssState`, `@fires`/`@event`, `@tag`/`@tagname`, `@summary`, `@internal`/`@ignore`, `@default`, and `@reflect`. Optional metadata MUST NOT affect semantic member completeness.

#### Scenario: Component and member documentation

- **WHEN** a component uses component, tag, summary, attribute, property, default, or reflection tags
- **THEN** the corresponding CEM fields retain the documented values and source identity

#### Scenario: CSS and content metadata

- **WHEN** a component declares CSS property, CSS state, shadow part, named slot, or default slot tags
- **THEN** the engine returns the corresponding CEM CSS and slot records without inspecting CSS or render implementations

#### Scenario: Internal member documentation

- **WHEN** a member is marked `@internal` or `@ignore`
- **THEN** it is omitted from public metadata even if its JavaScript visibility would otherwise make it public

#### Scenario: Inline event documentation

- **WHEN** a supported event dispatch has an adjacent JSDoc type, event name, or description
- **THEN** the engine combines that evidence with the dispatched event type without requiring class-level `@fires`

#### Scenario: Documentation type is not semantic evidence

- **WHEN** `@attr`, `@prop`, or inline event documentation contains type text
- **THEN** the text remains CEM documentation and does not replace a checker-resolved semantic type

#### Scenario: Missing optional documentation

- **WHEN** a component has no slot, event, or CSS metadata tags
- **THEN** the corresponding coverage is unknown or empty while semantic member collection remains complete

### Requirement: Explicit semantic completeness

The engine SHALL distinguish complete semantic collection from unresolved modules, missing required files, implicit `any`, error types, and unsupported syntax. Explicit `any` SHALL remain a valid checker type, and failures MUST NOT be hidden by display text or absent dependency diagnostics.

#### Scenario: Unresolved re-export with diagnostics disabled

- **WHEN** a JavaScript re-export cannot be resolved and `checkJs` is disabled
- **THEN** the engine reports incomplete collection even if TypeScript emits no dependency diagnostic

#### Scenario: Unresolved JSDoc type

- **WHEN** the checker returns an error type for a public member
- **THEN** the engine marks that member's semantics incomplete and does not present it as resolved

#### Scenario: Explicit any

- **WHEN** a resolved declaration explicitly declares `any`
- **THEN** the engine preserves the real checker type without classifying it as an unresolved failure

### Requirement: Overlay source provenance

Every discovery result SHALL expose snapshot-level `containsOverlays` and `overlayFiles` metadata. A one-shot consumer SHALL be able to distinguish filesystem-only results from results influenced by unsaved content without receiving the overlay text.

#### Scenario: Filesystem-only result

- **WHEN** collection uses no overlays
- **THEN** the result reports `containsOverlays: false` and an empty overlay file list

#### Scenario: One-shot overlay result

- **WHEN** collection uses an unsaved source or dependency overlay
- **THEN** the result reports `containsOverlays: true` and identifies the affected file identities

### Requirement: Incremental unsaved updates

Unsaved overlays SHALL produce a new isolated discovery snapshot with selective invalidation. The engine SHALL reuse unaffected records, resolve successor semantic handles lazily, and preserve the old snapshot until it is disposed.

#### Scenario: Direct or transitive JavaScript edit

- **WHEN** an unsaved overlay changes a direct or transitive dependency member
- **THEN** the new snapshot exposes the update through exports and the old snapshot retains its original result

#### Scenario: Declaration edit in a dual package

- **WHEN** an unsaved declaration overlay changes a public property type
- **THEN** the new consumer-facing semantics use the new declaration type

#### Scenario: Implementation edit in a dual package

- **WHEN** only JavaScript implementation metadata changes
- **THEN** the new snapshot updates supplemented metadata without overriding declaration-backed types

#### Scenario: Unaffected component

- **WHEN** one component file changes
- **THEN** unaffected component records are structurally reused and their successor semantic types are not eagerly recomputed
