# TypeScript 7 API and architecture research

**Date:** 2026-11-13
**Status:** Research record with dated implementation updates. Version selection and architecture changes remain recommendations unless an update names executable evidence. Runtime verification covers spawned and native-LSP scenarios on TypeScript 7.1.0-beta. Spawned Extension Host orchestration is now implemented and tested; exact-beta native-preview pipe behavior and native in-flight cancellation remain unverified and belong to #25 or later API work. TypeScript 7.0.2 is retained only as a short migration reference.

## Version and compatibility

- npm currently resolves `latest` to TypeScript 7.0.2 and `beta` to 7.1.0-beta. The [7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/) explicitly says 7.0 does not ship a supported API. Its `unstable/*` exports are prototypes, not a compatibility baseline.
- **Select exactly `7.1.0-beta` for the new semantic provider.** It satisfies the workspace’s 14-day minimum-release-age rule. The beta introduces supported-preview import paths including `typescript/async`, `typescript/sync`, `typescript/fs`, and `typescript/ast` ([7.1 Beta announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/), [package exports](https://unpkg.com/typescript@7.1.0-beta/package.json)).
- Upstream reserves breaking changes before 7.1 stable. Pin the exact version and isolate it behind `analyzer-ts7`. After 7.1 stable, upstream intends backward compatibility throughout 7.x for consumers using the provided client ([API versioning status](https://github.com/microsoft/TypeScript/issues/64709)).
- Prefer moving to 7.1 stable only after it satisfies the project’s age policy. If an earlier stable release is required, the maintainer may approve a **TypeScript-specific, explicitly reviewed exception** with its rationale and compatibility evidence. This is not a general dependency-policy exception.
- Use the JavaScript client and native executable from the same package/version. The wire protocol is an implementation detail that may change in minor releases.
- Watch, incremental, and solution-builder/build-orchestrator APIs are outside the stable 7.1 surface. Some checker utilities remain under triage.

## Runtime environment and probe method

The runtime probes used Node `v26.12.1`, `typescript@7.1.0-beta`, and the matching native package `@typescript/typescript-darwin-arm64@7.1.0-beta`. They ran inline JavaScript without adding dependencies or changing project source:

```sh
node --input-type=module <<'NODE'
// probe body
NODE
```

No probe `tsc --api` or `tsc --lsp` processes remained afterward. The workspace build also passed with the exact beta.

## Async API, native transport, and lifecycle

Runtime imports succeeded for `typescript/async`, `typescript/sync`, `typescript/fs`, `typescript/ast`, `typescript/ast/is`, `typescript/ast/factory`, and `typescript/vscode`.

The async client uses JSON-RPC over spawned-process stdio or a Unix domain socket/Windows named pipe and supports request batching. The sync client uses a blocking MessagePack protocol and blocks the Node event loop. The editor must use async because the shipped sync client throws `"Socket connections are not yet supported in the sync client"`.

`new API()` spawns the bundled native executable with `--api --async`. Options cover `cwd`, a custom executable, filesystem callbacks, external-code permission, and timing ([options declarations](https://unpkg.com/typescript@7.1.0-beta/dist/api/options.d.ts), [async client](https://unpkg.com/typescript@7.1.0-beta/dist/api/async/client.js)). ASTs are transferred as binary data and materialized lazily as remote JS nodes; `Project`, `Program`, `Checker`, `Symbol`, `Type`, and `NodeHandle` are native-backed client representations, not legacy in-process `ts.Program` objects.

A configured in-memory project worked with:

```js
import {API} from 'typescript/async';
import {createFileSystemLayer, createFileSystemWithLib} from 'typescript/fs';

const api = new API({collectTiming: true});
const before = await api.createSnapshot({
  fileSystem: createFileSystemWithLib([
    ['/virtual/tsconfig.json', configText],
    ['/virtual/index.ts', numberSource],
  ]),
  openProjects: ['/virtual/tsconfig.json'],
  ensurePrograms: true,
});
```

The native executable was spawned as:

```text
tsc --api --async --cwd <worktree> --useCaseSensitiveFileNames=false --timing
```

`await before.dispose()` made subsequent `getProjects()` throw `Error: Snapshot is disposed`. `api.close()` disposed the remaining snapshot and the native process exited with code `0`, signal `null`. APIs, snapshots, programs, and retained source files therefore require explicit lifecycle management.

## AST, symbols, types, and assignability

AST traversal found a `TaggedTemplateExpression`, its interpolation, a class property declaration, and a union alias. The property symbol’s `valueDeclaration.resolve()` produced a `PropertyDeclaration`.

Before an unsaved edit, runtime queries returned:

```text
target:       number
expression:   "bad"
assignable:   false
union:        Target
constituents: "a", "b"
signature:    (strings, values) => { kind: "result" }
```

After changing only an overlay from `count: number` to `count: string` and calling `snapshot.update(...)` with `ensurePrograms: true`, the same queries returned `string` and `true`. Repeating every query on the old snapshot still returned `number` and `false`, proving snapshot isolation.

These operations work on the exact beta: tagged-template AST access, symbol/declaration resolution, signatures, literal unions, expression and target types, and real `checker.isTypeAssignableTo(source, target)` ([async API declarations](https://unpkg.com/typescript@7.1.0-beta/dist/api/async/api.d.ts)).

### `getDeclaredTypeOfSymbol` anomaly

The anomaly first observed on 7.0.2 persists on 7.1 beta. Declarations say `getDeclaredTypeOfSymbol` should always return the symbol’s declared type, but the runtime result for the tested property was `any`.

Against the same snapshot and resolved `PropertyDeclaration`, all of these returned `number`:

```js
checker.getTypeAtLocation(countName);
checker.getTypeOfSymbol(countSymbol);
checker.getTypeFromTypeNode(countName.parent.type);
```

In contrast:

```js
checker.getDeclaredTypeOfSymbol(countSymbol); // any
```

The same result occurred for the imported property in a project-reference fixture before and after an overlay update. The probes establish the discrepancy, not its native-checker root cause. The permanent `retains the declared-type anomaly and location-based alternatives` regression in `packages/cem-analyzer-ts7/test/project-references.test.ts` now verifies `any` from the declared-type shortcut and `number`/`string` from `getTypeOfSymbolAtLocation` before and after a referenced-source overlay on the pinned beta.

**This is not a blocker for the `count: number` POC.** Three alternatives returned the real target type, and assignability worked. It becomes a blocker only if a required declaration, inheritance, or JS/JSDoc scenario cannot be resolved through those alternatives. Using `any` silently would be unsafe because it could make invalid bindings appear valid. The provider must avoid this method for the POC, verify type results, report unknown/error types as incomplete analysis, and retain a regression probe.

### Local factory nodes are not remote checker inputs

This probe failed with `Error: getNodeId requires a RemoteNode`:

```js
const localNode = createKeywordTypeNode(SyntaxKind.NumberKeyword);
await checker.getTypeFromTypeNode(localNode);
```

Remote type nodes from source files in the same project work, including literal unions. Metadata types must therefore come from project-owned remote syntax or other checker types; locally constructed AST factory nodes are not a shortcut.

## Project references and unsaved dependencies

A project-reference probe used:

```text
/virtual/lib/tsconfig.json
/virtual/lib/src/counter.ts
/virtual/app/tsconfig.json
/virtual/app/index.ts
```

The app config contained `"references": [{"path": "../lib"}]` and the app imported `Counter` from `../lib/src/counter.js`. Only the app config was opened.

- `snapshot.getProjects()` listed only the app config; the referenced lib was not a separate open project.
- The app program nevertheless included `/virtual/lib/src/counter.ts`.
- Initially the imported property was `number`, producing TS2322 for an invalid assignment.
- After an unsaved change to only `lib/src/counter.ts` and `ensurePrograms: true`, the imported property became `string` and app diagnostics became empty.
- The old snapshot retained the original type and TS2322.

Project-reference source redirection and unsaved cross-reference updates work in this scenario. The adapter must not expect every referenced config in `getProjects()`.

> Update (2026-11-18): the production discovery session now retains parsed references and passes them through `createPrograms[0].options.projectReferences` on creation and updates. The eager/lazy regressions in `packages/cem-analyzer-ts7/test/project-references.test.ts` import through `../lib/dist/counter.js` with no generated declaration output, enrich/materialize the redirected source, and verify unsaved changes plus old-snapshot isolation. The standalone module resolver does not expose that redirection to the discovery graph, so the graph falls back to the checker's module-symbol declaration instead of manually mapping output paths. Runtime tsconfig/reference-list changes and solution-builder watching remain unsupported.
>
> The same test file also covers successive overlays on a real disk-backed referenced source. On the pinned beta, removing the last overlay while reusing the previous native snapshot could retain the removed overlay's source text even though a fresh snapshot reads the configured disk content. `removeOverlays` therefore builds a fresh program snapshot while preserving registry invalidation and remaining-overlay provenance; ordinary replacement overlays stay incremental. `restores disk-backed referenced source after overlay removal` is the executable regression, and `docs/performance.md` records the resulting removal cost.

## Native LSP pipe integration

A direct native LSP probe spawned the exact beta with `spawn(getExePath(), ['--lsp', '--stdio'])` and performed Content-Length-framed JSON-RPC:

```text
initialize
initialized
custom/initializeAPISession {}
API.fromLSPConnection({pipe: session.pipe})
```

The server returned `{ "name": "typescript", "version": "7.1.0-beta" }`. The API client had a socket and no second spawned API process.

Using `textDocument/didOpen`, `getCurrentLanguageServerSnapshot`, and `textDocument/didChange`:

- The initial unsaved document produced `number`, `"bad"`, and `assignable: false`.
- After an unsaved property edit, a new canonical snapshot produced `string` and `true`.
- The old LSP snapshot retained `number` and `false`.
- Shutdown and exit completed cleanly.

A second two-document probe used `contracts.ts` with a component property and `index.ts` with an invalid assignment. An LSP `textDocument/diagnostic` request initially returned TS2322. After changing only the component document, another pull returned no diagnostics; pipe snapshots changed accordingly.

This verifies native LSP canonical-state sharing and cross-document unsaved updates. It does not verify VS Code.

### Notification ordering

One attempt sent `didOpen` notifications and immediately queried the API pipe, producing an unexpected/stale AST and `Error: getNodeId requires a RemoteNode`. Adding a `textDocument/diagnostic` request as an ordering barrier before reading canonical state made the scenario pass consistently. This does not prove a deterministic upstream race, but it means the adapter must not assume stdio notifications and separate-pipe snapshot requests are synchronized. Document versions and host synchronization require explicit Extension Host tests.

## Cancellation and staleness

Searches of shipped API and editor declarations/source found no `AbortSignal`, `CancellationToken`, `cancelRequest`, or public `cancel` operation. Runtime inspection also found no cancellation methods on the client prototype.

- No public native in-flight request cancellation was found or exercised.
- This does not prove native internals lack every cancellation mechanism; it proves the public client does not expose one.
- `analyzer-ts7` must attach monotonically increasing generation/document versions and discard results whose generation or snapshot is no longer current.
- Old snapshots returning valid old answers is not stale-result protection. That policy belongs in the adapter and editor host.

Update (2026-11-18): engine and registry operations now accept host-neutral `AbortSignal`, reject at logical boundaries, and commit overlay/scope changes transactionally. The editor serializes mutations and rejects superseded run/generation/document-version results. `packages/cem-analyzer-ts7/test/cancellation.test.ts`, `packages/analyzer-core/test/session.test.ts`, and `packages/vscode-extension/src/test/coordinator-races.test.ts` exercise these guarantees, including native completion after logical abort. This does not terminate native requests or change the public-client limitation above.

### Editor and document lifecycle

Update (2026-11-18): [microsoft/vscode#199282](https://github.com/microsoft/vscode/issues/199282) and [microsoft/vscode#291739](https://github.com/microsoft/vscode/issues/291739) document that closing an editor and disposing a `TextDocument` are different lifecycles. A model opened through `workspace.openTextDocument` can remain in `workspace.textDocuments` after its tabs close, with close notification delayed by minutes. `tabGroups.onDidChangeTabs` is therefore the appropriate signal for editor-overlay removal; split editors require per-tab identity and a visible-tab check on reopen races.

The legacy `packages/vscode-lit-plugin/src/extension.ts` has no document-close handler. Its `ts-lit-plugin` receives `info.project` from tsserver (`packages/ts-lit-plugin/src/index.ts:40-60`) and computes semantic diagnostics on demand against the current language-service program. TypeScript and VS Code consequently own the legacy open-file/program lifecycle; there is no legacy overlay-eviction policy to copy. The new host additionally owns native sessions and must remove overlays when the editor tab closes rather than waiting for model disposal.

The spawned host now implements that policy in `packages/vscode-extension/src/host/documents.ts`. Real Extension Development Host tests cover open/change/save/tab-close, split-safe document identity, unsaved referenced-source updates, and disk-backed overlay restoration in `packages/vscode-extension/src/test/orchestration.test.ts` and `coordinator.test.ts`. Closing does not shrink the engine's historical lazy scope; it removes unsaved overlay state and prevents stale publication.

## Timing and smoke measurements

Three independent native sessions created the same one-file project and ran one initial query followed by five identical warm queries:

| Run | Cold `createSnapshot` | First query | Five warm queries                    |
| --- | --------------------: | ----------: | ------------------------------------ |
| 1   |              25.50 ms |     1.96 ms | 0.414, 0.386, 0.374, 0.312, 0.280 ms |
| 2   |              22.20 ms |     1.12 ms | 0.312, 0.293, 0.317, 0.280, 0.279 ms |
| 3   |              21.79 ms |     1.04 ms | 0.296, 0.259, 0.274, 0.255, 0.255 ms |

Each run reported 15 requests, 3,097 bytes sent, 4,922 bytes received, 39 materialized AST nodes, and one fetched source file. Server time was 16.45–17.46 ms; estimated transport overhead was 6.37–7.02 ms. Native RSS was 49,200–49,632 KB.

These are instrumentation smoke measurements on a trivial project, not representative performance budgets. Async batching and warm queries work.

> Update (2026-11-18): discovery sessions expose `collectTiming` (disabled by default), `getTimingInfo`, and `resetTimingInfo` with serializable metrics. Retrieving timing itself performs a `getServerTiming` protocol request, so request totals and recent history include that retrieval; probes compare deltas and reset semantics rather than treating totals as operation-only measurements. The extension enables timing only in `verbose`/`debug`; `normal` performs no timing retrieval, memory sampling, performance timers, or instrumentation intervals (`packages/vscode-extension/src/test/logging.test.ts`).
>
> `probes/host-policy-performance.mjs` now provides serial cold/warm eager/lazy, enrichment/query, overlay update/removal, IPC/node, memory, and cleanup measurements through the public registry API. The three-run environment, spread, attribution limits, and preliminary non-gating budgets are recorded in `docs/performance.md`. Representative performance and adaptive memory policies remain #26 work.

## Content mappers

[Content mappers PR #4712](https://github.com/microsoft/typescript-go/pull/4712) transforms otherwise unsupported foreign file types such as `.vue`, `.svelte`, `.astro`, or standalone `.html` into TS/JS/JSON virtual outputs. It provides extension-based registration, JSON-RPC mapper processes, project-scoped configuration, original-to-virtual span maps, diagnostics, supplemental outputs, and mapped LSP features. Edits can be written back only through exact length-preserving `Verbatim` mappings; declaration maps are unsupported, and complex frameworks may still require custom language servers.

**They do not solve Lit `html` tagged templates inside ordinary `.ts` files.** There is no per-tag hook within an already parsed TypeScript source file. [Issue #65313](https://github.com/microsoft/TypeScript/issues/65313) requests precisely this missing capability and remains open.

The proposal is potentially useful, especially for embedded-language projections, but its dependency, discovery, and framework-integration semantics are still unresolved. **The project should not wait for it.** The analyzer will continue to own HTML/CSS virtual documents and bidirectional source maps, distinguishing analysis/navigation mappings from exact edit-safe mappings.

## Architecture and package boundaries

### `analyzer`

- Owns Lit-template semantics, HTML/CSS parsing and source maps, a **framework-neutral web-component registry**, rules, shared results, and asynchronous host-neutral semantic contracts.
- Lit is the first-class template host, not the only permitted component provider. A Lit template may consume Lit elements, vanilla `HTMLElement` subclasses, and components from other suppliers, including dependencies.
- The registry describes web components generically: registrations, properties, attributes, events, slots, CSS metadata, documentation, provenance, and declaration references. Framework-specific metadata belongs in extensions/adapters rather than making the base registry Lit-specific.
- Must not import TypeScript AST enums, API handles, Node transport APIs, LSP, or VS Code. Public contracts use opaque snapshot-scoped handles/DTOs, not `Symbol`, `Type`, `Node`, or `Snapshot` from TypeScript.

### `analyzer-ts7`

> Update (2026-11-17): the separate `analyzer-ts7` adapter was dissolved. The `cem-analyzer-ts7` engine owns the TS7 sessions, snapshots, and checker operations described here, and `analyzer-core` consumes the engine's public session API directly. These responsibilities now live in the engine plus host orchestration; the section is retained as the original research record.

- Sole owner of `API`, native process/pipe connections, snapshots, programs, checkers, AST nodes, filesystem overlays, notifications, project references, disposal, generations, and timing.
- Translates TypeScript syntax and semantic facts into core contracts. A snapshot-scoped session object should make cross-snapshot assignability difficult by construction.
- Implements TypeScript mechanics such as alias/re-export resolution and declaration navigation; Lit-specific classification and rules stay in core.
- Uses `getTypeOfSymbol`, `getTypeAtLocation`, or project-owned `getTypeFromTypeNode`; avoids `getDeclaredTypeOfSymbol` for the POC.
- Exposes spawned and pipe-connected factories without depending on VS Code.

### Hosts

- CLI and VS Code consume both core and adapter.
- VS Code obtains the pipe from the native-preview extension and passes it to `analyzer-ts7`; it does not duplicate session or analyzer semantics.
- Exact-beta VS Code remains unverified. The locally installed `TypeScriptTeam.native-preview` bundles TypeScript 7.0.2, and the existing isolated test launch disables other extensions.
- Update (2026-11-18): a host-neutral `createProjectAssociationSession` adapter now exercises `Snapshot.getDefaultProjectForFile` against real TS7 snapshots for configured, inferred, and multiply included files without synthetic-program selection; tests live in `packages/cem-analyzer-ts7/test/project-association.test.ts`. The editor consumes its plain DTO through the core re-export. Native-preview pipe connection/restart lifecycle remains #25 work and is not claimed by this adapter.

Upstream native-preview project cleanup is liveness-based rather than a numerical LRU: [`cleanupConfiguredProjects`](https://github.com/microsoft/typescript-go/blob/main/internal/project/projectcollectionbuilder.go) retains default projects required by open files, their references and ancestors, and explicitly opened API projects; [`ProjectCollection`](https://github.com/microsoft/typescript-go/blob/main/internal/project/projectcollection.go) has no corresponding small fixed capacity. Thus many open files can legitimately retain many programs in the shared native server. The spawned extension instead owns independent native API sessions and implements a configurable live-and-creating bound (default eight) with active-project priority and automatic LRU recovery, covered by `packages/vscode-extension/src/test/coordinator-races.test.ts` and `coordinator.test.ts`. This bound is not a claim about native-preview behavior or an adaptive memory policy.

The production Extension Host currently uses the spawned nearest-containing-config fallback with workspace-qualified configured identities and a synthetic inferred association when no config contains the file. It does not reproduce solution-style or multiply-included project-service selection, does not reload tsconfig/reference graphs at runtime, and does not connect to native-preview; those transport and lifecycle scenarios remain #25. The implemented `onType`/`onSave`, 100 ms debounce, 500 ms maximum wait, and logging-level settings are declared in `packages/vscode-extension/package.json` and exercised by the real Extension Host suite.

## Registry model and preliminary CEM reuse

The base registry must support arbitrary web-component suppliers while preserving source, declaration, and framework provenance. It must distinguish known components, missing runtime imports, incomplete metadata, and conflicting registrations.

**Preliminary decision:** reuse the [Custom Elements Manifest schema](https://raw.githubusercontent.com/webcomponents/custom-elements-manifest/main/schema.d.ts) for the registry’s base DTOs instead of inventing parallel component interfaces. The schema already provides standard vocabulary for declarations, fields, attributes, events, slots, CSS parts/properties, inheritance, references, and documentation, and will simplify optional CEM import/export interoperability.

CEM types are a starting model, not a restriction on the analyzer. Registry-specific interfaces may extend or compose them with:

- real TypeScript type handles from the current TS7 project/snapshot;
- registration evidence and source/declaration identity;
- framework provenance and adapter-specific metadata;
- snapshot identity, cache generations, unsaved state, and analysis completeness.

An existing manifest provides initial candidates and metadata only. TS7 analysis then resolves and refreshes actual registrations, declarations, types, aliases, slots, events, and dependencies. Current project-owned semantic facts take precedence over stale manifest fields; unavailable or unresolvable information is marked incomplete rather than inferred successfully.

CEM `type.text` remains documentation/display data. It is not used for assignability. The corresponding real TS7 type handle is attached separately, so CEM compatibility does not weaken checker semantics or snapshot isolation.

## Recommended first implementation stage: dependency-aware registry

Rather than starting with routine template extraction, the first substantial stage should build a project/dependency-aware web-component registry and prove the semantic information needed by later Lit analysis.

A strong external fixture candidate is [Material Web](https://github.com/material-components/material-web): a substantial Lit-based UI kit whose inheritance, metadata, exports, declarations, slots, events, and component composition can expose integration problems early.

The proposed fixture is a small demo/storybook-style consumer with static pages:

- Focused pages using representative components and checking properties, attribute aliases, slots, events, inheritance, and declarations.
- Complex pages composing many base components to test cross-component contracts and registry behavior in realistic templates.
- Dependency scenarios covering package exports, re-exports, source/declaration resolution, and unsaved dependency changes.

Material Web is a stress-test candidate, not a claim that one kit covers all suppliers. Add focused vanilla/custom-element fixtures so the registry does not become Lit-specific, and use small deterministic cases to explain every failure before scaling to the full kit.

## Recommended change sequence

1. **Web-component registry foundation**
   - Define neutral registration/component/semantic contracts and source/dependency identity.
   - Build initial source discovery and type resolution for properties, attributes, events, and slots without requiring a manifest.
   - Prove a focused Material Web dependency fixture and smaller vanilla cases; document unsupported metadata explicitly.
2. **TS7 provider foundation**
   - Pin 7.1.0-beta and implement async spawned sessions, snapshot/filesystem updates, disposal, generation-based staleness, and symbol/type/signature/assignability operations.
   - Cover unsaved edits, minimal project references, logical cancellation, and timing.
3. **Template extraction and property-binding analysis**
   - Build provider-neutral tagged-template records, virtual HTML, and bidirectional mappings.
   - Resolve `.count=${'bad'}` using source and target types from one snapshot and produce shared diagnostics plus completion/hover/definition data.
4. **CLI vertical slice**
   - Add project selection, shared-result formatting, source ranges, and exit behavior.
5. **VS Code vertical slice**
   - Connect through `initializeAPIConnection` and async `fromLSPConnection`.
   - Implement diagnostics, completion, hover, definition, unsaved updates, restart/reconnection, and stale-response handling in a real Extension Development Host.
6. **POC acceptance hardening**
   - Complete project-reference and cancellation evidence across hosts.
   - Measure cold/warm latency, memory, request counts, and IPC against issue #2 and record preliminary budgets.

## Open questions

- Does the exact beta/native-preview/VS Code combination pass a real pipe-connected Extension Host scenario, including restarts?
- Can in-flight native requests ever be cancelled, or is logical cancellation the only public behavior?
- Which CEM extensions and composition rules are required for registration evidence, snapshot identity, provenance, and semantic type handles?
- How should arbitrary metadata types be represented as remote types in the source expression’s project and snapshot?
- Does the `getDeclaredTypeOfSymbol` anomaly affect any required discovery scenario after location-based alternatives are exhausted?
- What batching and snapshot-retention policy meets interactive latency and native-memory budgets?
- Which Material Web components provide the best focused inheritance, slots, events, and composition fixtures?

## Sources

### TypeScript releases and compatibility

- [Announcing TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [Announcing TypeScript 7.1 Beta](https://devblogs.microsoft.com/typescript/announcing-typescript-7-1-beta/)
- [TypeScript 7.1 beta package exports](https://unpkg.com/typescript@7.1.0-beta/package.json)
- [API status and versioning plan](https://github.com/microsoft/TypeScript/issues/64709)
- [API feature roadmap](https://github.com/microsoft/TypeScript/issues/63875)
- [TypeScript native API design discussion](https://github.com/microsoft/typescript-go/discussions/455)
- [TypeScript Go CHANGES.md](https://github.com/microsoft/typescript-go/blob/main/CHANGES.md)

### TypeScript 7.1 API declarations and implementation

- [API options](https://unpkg.com/typescript@7.1.0-beta/dist/api/options.d.ts)
- [Async client implementation](https://unpkg.com/typescript@7.1.0-beta/dist/api/async/client.js)
- [Filesystem declarations](https://unpkg.com/typescript@7.1.0-beta/dist/api/fs.d.ts)
- [Snapshot protocol declarations](https://unpkg.com/typescript@7.1.0-beta/dist/api/proto.generated.d.ts)
- [Async API declarations](https://unpkg.com/typescript@7.1.0-beta/dist/api/async/api.d.ts)
- [VS Code extension API declarations](https://unpkg.com/typescript@7.1.0-beta/dist/vscode/extensionApi.d.ts)

### Content mappers

- [Content mappers PR #4712](https://github.com/microsoft/typescript-go/pull/4712)
- [Content mappers for tagged template literals — issue #65313](https://github.com/microsoft/TypeScript/issues/65313)

### Component model and fixtures

- [Custom Elements Manifest documentation](https://custom-elements-manifest.open-wc.org/)
- [Custom Elements Manifest schema](https://raw.githubusercontent.com/webcomponents/custom-elements-manifest/main/schema.d.ts)
- [open-wc analyzer package](https://github.com/open-wc/custom-elements-manifest/tree/master/packages/analyzer)
- [Material Web](https://github.com/material-components/material-web)
- [Issue #2 — Prove end-to-end Lit analysis with TypeScript 7](https://github.com/shining-mind/ts7-lit-analyzer/issues/2)

## Appendix A: project-reference fixture

The project-reference probe used the following exact inputs. Paths are virtual and were supplied through the in-memory filesystem.

### `/virtual/lib/tsconfig.json`

```json
{
  "compilerOptions": {
    "composite": true,
    "declaration": true,
    "strict": true,
    "target": "esnext",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": [],
    "rootDir": "src",
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src/**/*.ts"]
}
```

### `/virtual/app/tsconfig.json`

```json
{
  "compilerOptions": {
    "composite": true,
    "strict": true,
    "target": "esnext",
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "types": [],
    "skipLibCheck": true
  },
  "files": ["index.ts"],
  "references": [{"path": "../lib"}]
}
```

### `/virtual/lib/src/counter.ts` — initial snapshot

```ts
export class Counter {
  count: number = 0;
}
```

### `/virtual/lib/src/counter.ts` — unsaved overlay

```ts
export class Counter {
  count: string = '0';
}
```

### `/virtual/app/index.ts`

```ts
import {Counter} from '../lib/src/counter.js';

const counter = new Counter();
counter.count = 'bad';
```

Only `/virtual/app/tsconfig.json` was opened. The probe compared semantic diagnostics and property types before and after applying the overlay, then repeated the same queries on the original snapshot.
