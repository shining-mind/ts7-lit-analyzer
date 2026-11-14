# Proposal

## Why

The registry and all later template features need one reliable source of component semantics, and the TypeScript 7 probes now define how to collect them from TypeScript, JavaScript, declarations, and dependencies. This change isolates that collection engine before issue [#21](https://github.com/shining-mind/ts7-lit-analyzer/issues/21) adds CEM-based registry contracts or consumer-facing features.

## What Changes

- Add a focused asynchronous TypeScript 7 discovery engine as a new independently extractable `packages/cem-analyzer-ts7` package with derived analysis configuration, caller-supplied or consumer-import roots, disposable snapshots, and stable declaration identity.
- Collect custom-element registrations, classes, public properties, methods, attributes, inheritance, exports, aliases, documentation, and snapshot-scoped semantic references through the real TS7 checker.
- Use separate built-in collection strategies for vanilla `HTMLElement` subclasses and Lit components from both `lit` and legacy `lit-element`; recognize global and direct custom `CustomElementRegistry` registrations without replacing checker semantics.
- Reuse the complete Custom Elements Manifest schema for base declaration and metadata DTOs, composing it with separate TS7 identity, evidence, provenance, semantic references, and completeness records.
- Treat project TypeScript as the primary input and project JavaScript as second-class input, while fully supporting JavaScript with or without JSDoc, declaration-only packages, and declaration/JavaScript packages in dependencies; never execute discovered user code.
- Treat declarations as authoritative whenever present; JavaScript may supplement registration or framework metadata, but the engine does not compare or reconcile JavaScript with declaration shape.
- Limit dependency discovery to public component APIs; do not analyze dependency render functions or provide diagnostics/language features inside dependency sources.
- Collect the complete CEM-compatible optional JSDoc set: `@attr`/`@attribute`, `@prop`/`@property`, `@part`/`@csspart`, `@slot`, `@cssprop`/`@cssproperty`, `@cssState`, `@fires`/`@event`, `@tag`/`@tagname`, `@summary`, `@internal`/`@ignore`, `@default`, and `@reflect`, independently of property/type completeness. Manifest reading is deferred.
- Support unsaved source and dependency overlays, snapshot isolation, selective invalidation, structural sharing of unaffected records, and lazy semantic-handle resolution; mark every result with snapshot-level `containsOverlays` and `overlayFiles` provenance so one-shot consumers can distinguish filesystem-only data.
- Exclude registry indexes, CEM import/export, template extraction, binding diagnostics, CLI/editor integration, and general-purpose session management from this change.

## Capabilities

### New Capabilities

- `ts7-component-discovery`: Snapshot-scoped TypeScript 7 collection of web-component registrations, public class semantics, and dependency metadata.

### Modified Capabilities

None.

## Impact

- `packages/cem-analyzer-ts7`: the complete self-contained implementation and public discovery API, with no dependencies on other workspace packages and no TypeScript API objects in result contracts.
- `packages/analyzer` and `packages/analyzer-ts7`: unchanged in this change; registry assembly and host semantic sessions remain follow-up work.
- Architecture and packaging: document the new package boundary and verify its public artifacts in the standalone packaging fixture.
- Tests and fixtures: real TS7 in-memory cases for depth, module formats, declarations, raw JavaScript, metadata, incompleteness, and overlays, plus a focused declaration-backed dependency fixture.
- Dependencies: direct pins of TypeScript 7.1.0-beta and `custom-elements-manifest` 2.1.0 in `cem-analyzer-ts7`; fixture-only Lit/Material Web dependencies for integration coverage. The CEM analyzer itself is not a runtime dependency.
- Upstream context: no existing CEM TypeScript 7 proposal was found on 2026-11-14; link adjacent issues [CEM #267](https://github.com/open-wc/custom-elements-manifest/issues/267), [CEM #172](https://github.com/open-wc/custom-elements-manifest/issues/172), and [CEM #295](https://github.com/open-wc/custom-elements-manifest/issues/295) without treating them as approval or prior art for a TS7 backend.
- Documentation: align the component-discovery research with declaration authority and record the implemented engine's supported boundaries without claiming registry or template support.
