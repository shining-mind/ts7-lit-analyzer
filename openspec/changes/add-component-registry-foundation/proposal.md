# Proposal

## Why

The verified `cem-analyzer-ts7` engine returns serializable, host-safe component records, but nothing indexes them for templates, the CLI, or the editor: the analyzer core still holds placeholder contracts. Issue [#21](https://github.com/shining-mind/ts7-lit-analyzer/issues/21) builds that registry foundation and unblocks [#22](https://github.com/shining-mind/ts7-lit-analyzer/issues/22). A fixture probe on 2026-11-17 confirmed two engine gaps that block the issue's acceptance criteria: `MdDialog` reports no events although its dependency base class `Dialog` documents `@fires open/opened/close/closed/cancel` in both `.js` and `.d.ts`, and superclass references carry only a name without package/module provenance.

The engine also absorbed the responsibilities originally proposed for `packages/analyzer-ts7` (TS7 sessions, snapshots, module resolution, checker operations), and its public contracts are already the host-safe boundary the core would otherwise re-declare. Maintainer decisions on 2026-11-17: dissolve `analyzer-ts7`, let the core consume the engine directly, and rename `packages/analyzer` to `packages/analyzer-core` so the name reflects the shared host-independent analysis core rather than a second "analyzer" alongside the engine.

## What Changes

- Rename `packages/analyzer` to `packages/analyzer-core` (`@ts7-lit-analyzer/analyzer-core`), updating consumers, workspace/packaging tests, the legacy fixture's `file:` dependency and frozen lockfile, tooling docs, and architecture docs. Public export names (`analyzerPackageVersion`, shared scenario contracts) are preserved.
- Remove the empty placeholder `packages/analyzer-ts7`. The core consumes `cem-analyzer-ts7` directly through its public session API; the engine keeps no workspace dependencies and remains independently extractable.
- Adopt the engine's host-safe contracts as the core's public registry contracts by re-export: CEM schema DTOs as the extensible base with separate identity, evidence, provenance, semantic-reference, and completeness extensions. No mirrored contracts, no TypeScript API objects, no Lit-specific fields.
- Add a thin registry model to the core: lookup by tag name and declaration identity, property/attribute/event/slot access with attribute-to-property alias resolution, inheritance references, and explicit completeness surfacing (`complete`, `incomplete`, `not-collected`). Empty optional metadata is presented as undocumented, never as confirmed absence.
- Bind registry views to one project, snapshot, and generation; applying a successor discovery result replaces the view, preserves overlay provenance (`containsOverlays`, `overlayFiles`), and rejects stale semantic operations.
- Add a core registry session composing engine sessions: creation, collection, lazy scope/enrichment pass-through, overlay updates, member type queries, assignability, and disposal. Checker operations delegate to the engine; the core owns no parallel TypeScript semantics. CEM `type.text` remains display-only and is never an assignability input or fallback.
- Fix the discovery engine: inherit class-level JSDoc metadata (events, slots, CSS parts/properties/states, summary) from checker-resolved base classes, including dependency bases, without inspecting render implementations; retain package and module provenance on superclass references.
- Extend the shared `tests/fixtures/webcomponents` fixture: focused vanilla and Lit elements with documented events/slots/CSS metadata, a re-export dependency package with a renamed export, and simple and composed Lit `html` demo pages. Add focused Material Web assertions: `MdDialog` properties, attributes, inherited events, declaration identity, and explicitly unknown slots (Material Web documents no `@slot`; render-derived slots stay excluded).
- Rewrite the package boundary in both architecture documents and the AGENTS.md package description; document unsupported metadata and incomplete analysis; add a root registry integration workflow. Rescope issue #22 as engine host-policy extensions (project references, cancellation, timing) plus core orchestration, not a new provider package.
- Out of scope: template extraction and binding analysis (#23, #5), CLI/editor integration (#24, #25), the optional manifest adapter (#6), and host policies themselves (#22).

## Capabilities

### New Capabilities

- `component-registry`: host-neutral web-component registry in the analyzer core: adopted discovery contracts, indexing and lookup over discovery records, snapshot-scoped views and invalidation, explicit completeness, checker-only semantic delegation, and the discovery-backed registry session.

### Modified Capabilities

- `ts7-component-discovery`: add requirements for inherited class-level documentation metadata from base classes and for superclass declaration provenance (package/module identity). Existing collection, declaration-authority, and snapshot contracts are unchanged.

## Impact

- `packages/analyzer-core` (renamed from `analyzer`): registry contracts re-export, registry model and session, unit and in-memory session tests; new dependencies `@ts7-lit-analyzer/cem-analyzer-ts7` (`workspace:*`) and `custom-elements-manifest` 2.1.0.
- `packages/analyzer-ts7`: removed; it exported nothing and no package imports it.
- `packages/analyzer-cli`, `packages/vscode-extension`: dependency specifier and import renames only.
- `packages/cem-analyzer-ts7`: additive metadata inheritance and superclass provenance; public contracts and extractability unchanged.
- Tests and fixtures: workspace/packaging package lists, legacy fixture dependency and lockfile, new webcomponents fixture elements/pages/re-export package with updated frozen lockfile, root `test:registry` workflow.
- Documentation: `.agents/docs/architecture.md`, `.agents/docs/tooling.md`, `docs/architecture.md`, `docs/parity.md`, AGENTS.md package description, README status, a registry behavior/limitations document, and discovery research status. Package naming is partially settled by maintainer decision; remaining names stay provisional.
- Issues: implements #21 (parent #2); unblocks #22 with a rescoped body. Engine gap fixes are included because the #21 acceptance criteria require them.
