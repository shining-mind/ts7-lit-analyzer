# ts7-component-discovery Specification

## Purpose

Collects framework-relevant web-component facts and real TypeScript 7 semantics from project sources and public dependency APIs without executing user code.

## Requirements

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

#### Scenario: New or removed cross-file registration

- **WHEN** an overlay adds or removes a supported `define`, tag-map, decorator, or compiled-decorator registration in a file other than the class declaration
- **THEN** the successor collects or re-enriches the referenced class and adds, updates, or removes the corresponding component registration

### Requirement: Incremental module graph

The successor module graph SHALL retain unchanged per-file resolution edges and provenance, re-resolve changed importers and newly reachable modules, and exclude unreachable modules. Collection SHALL include every module new to the successor graph. Host-side graph reuse MUST NOT be presented as a guarantee that the TypeScript 7 program update itself is O(change).

#### Scenario: Newly reachable side-effect import

- **WHEN** an overlay adds a side-effect import of an existing but previously unreachable component module
- **THEN** the successor graph includes the new module and returns its registered component without requiring a re-export

#### Scenario: Unchanged importer

- **WHEN** an overlay changes a file without changing another importer
- **THEN** the successor reuses the unchanged importer's resolution edges and does not resolve its module specifiers again

#### Scenario: Import removal prunes the graph

- **WHEN** an overlay removes the last reachable import of a component module
- **THEN** the successor excludes that module and its component unless another root or import still reaches it

### Requirement: Resolution input invalidation

External dependency edges SHALL record package manifests used during resolution. After any non-empty overlay update, unresolved dependencies SHALL be retried. An importer SHALL also be re-resolved when a recorded resolution input changes, even if its source text is unchanged.

#### Scenario: Missing import target is created

- **WHEN** an overlay creates the target of a previously unresolved import without editing the importer
- **THEN** the successor retries resolution, collects the newly reachable component, and removes the stale unresolved-module issue

#### Scenario: Package manifest changes

- **WHEN** an overlay changes a package manifest used by an unchanged importer
- **THEN** the successor re-resolves that importer and replaces the old target and component with the newly resolved target

### Requirement: Deferred lazy initialization

A lazy-mode session SHALL perform no module-graph construction or component collection at creation time. The first scoped request SHALL trigger the work needed for that scope. Eager-mode sessions SHALL retain the verified one-shot initialization behavior.

#### Scenario: No work before the first request

- **WHEN** a lazy-mode session is created and no scoped request is made
- **THEN** no module graph or component collection is performed and no components are returned

#### Scenario: First request initializes the scope

- **WHEN** the first scoped request names project files
- **THEN** the engine builds the collection scope required by those files over the project-wide TypeScript program and registration index, and returns their reachable components

#### Scenario: Laziness scopes collection, not the program

- **WHEN** the first scoped request initializes a lazy session
- **THEN** the TypeScript program and registration index span the configured project, while member collection is limited to the active scope

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

- **WHEN** an installed package is neither a project root nor reached by the project import closure
- **THEN** the package is not included in the TypeScript program and its components are not added

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

Sessions SHALL expose serializable TypeScript 7 timing metrics only when instrumentation is enabled, including request counts, round-trip/server/transport timing, IPC byte counts, and node-materialization totals. Reset SHALL clear client and server measurement history. Instrumented discovery results SHALL expose the number of checker fallbacks performed while building their backing module graphs; uninstrumented results SHALL omit that count and SHALL NOT increment its counter.

#### Scenario: Instrumentation disabled by default

- **WHEN** a session is created without timing instrumentation
- **THEN** its metrics report disabled collection and zeroed totals

#### Scenario: Instrumented collection

- **WHEN** an instrumented session performs collection
- **THEN** its metrics contain serializable nonzero request and IPC measurements without TypeScript handles or overlay text

#### Scenario: Timing reset

- **WHEN** an instrumented session resets its timing history
- **THEN** subsequent metrics count only requests made after the reset, apart from the documented timing retrieval request itself

#### Scenario: Project-reference fallback is counted

- **WHEN** an instrumented session resolves a referenced output import through the checker fallback
- **THEN** its result reports a positive module-resolution fallback count without module specifiers or source text

#### Scenario: Fallback counting is disabled

- **WHEN** a session without instrumentation resolves the same import
- **THEN** its result omits the module-resolution fallback count and performs no fallback-count increments

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
