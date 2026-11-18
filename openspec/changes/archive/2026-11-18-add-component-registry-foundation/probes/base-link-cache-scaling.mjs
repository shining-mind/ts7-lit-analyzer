// Isolated per-class link cache for base documentation, at scale. Dozens of
// components inherit a shared chain (Comp{i} -> AppBase -> SharedBase ->
// HTMLElement). Implements the proposed design: cache each class's OWN resolved
// data (JSDoc fragment + a base LINK stored as declaration identity, not the
// base's data), walk the chain by following cached links, and re-merge each time.
// Because an entry stores only a link to its base (not the base's subtree),
// invalidation is own-file: editing SharedBase evicts only SharedBase's entry;
// every subclass keeps its link and reuses the fresh base data at merge time.
//
// Demonstrates:
//   1. Scaling — naive (no cache) base-walk IPC grows ~linearly with component
//      count; the link cache makes a warm walk ~0 IPC regardless of N.
//   2. Own-file invalidation — a real JSDoc edit to the shared base re-resolves
//      exactly ONE entry (O(1)), not N; the change propagates to all N merges.
//      A merged-subtree cache would instead evict all N entries (O(N)).
//
// Synthetic in-memory project; indicative single runs, not performance budgets.
// Feeds the base-doc caching decision under #26 (performance) / #34 (transport).
// Run from the repository root after `pnpm build`:
//   node openspec/changes/add-component-registry-foundation/probes/base-link-cache-scaling.mjs
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const pkgDir = join(repoRoot, 'packages/cem-analyzer-ts7');
const tsDir = join(pkgDir, 'node_modules/typescript');
const {getInstanceType} = await import(
  join(pkgDir, 'dist/strategies/abstract.js')
);
const {selectDeclaration} = await import(
  join(pkgDir, 'dist/semantics/collection.js')
);
const {collectClassDocumentation} = await import(
  join(pkgDir, 'dist/discovery/jsdoc.js')
);
const {API, ModuleKind, ModuleResolutionKind} = await import(
  join(tsDir, 'dist/api/async/api.js')
);
const {createFileSystemWithLib} = await import(join(tsDir, 'dist/api/fs.js'));
const {ScriptTarget, isClassDeclaration, isClassExpression} = await import(
  join(tsDir, 'dist/ast/index.js')
);

const compilerOptions = {
  strict: true,
  target: ScriptTarget.ESNext,
  module: ModuleKind.NodeNext,
  moduleResolution: ModuleResolutionKind.NodeNext,
  types: [],
  skipLibCheck: true,
  allowJs: true,
  checkJs: false,
  maxNodeModuleJsDepth: 0,
};
const rootFiles = ['/virtual/src/index.ts'];
const SHARED_KEY = '/virtual/src/shared-base.ts#SharedBase';
const fmt = (t) => ({
  requests: t.requestCount,
  serverMs: +t.serverTimeMs.toFixed(1),
  transportMs: +t.transportOverheadMs.toFixed(1),
});

function buildFiles(n) {
  const files = [
    [
      '/virtual/src/shared-base.ts',
      "/** @fires base-event - Base event. */\nexport class SharedBase extends HTMLElement {\n  baseProp: string = '';\n}\n",
    ],
    [
      '/virtual/src/app-base.ts',
      "import {SharedBase} from './shared-base.js';\n/** @fires app-event - App event. */\nexport class AppBase extends SharedBase {\n  appProp: number = 0;\n}\n",
    ],
  ];
  const imports = [];
  for (let i = 0; i < n; i++) {
    files.push([
      `/virtual/src/comp${i}.ts`,
      `import {AppBase} from './app-base.js';\nexport class Comp${i} extends AppBase {\n  value: number = 0;\n}\ncustomElements.define('x-comp-${i}', Comp${i});\n`,
    ]);
    imports.push(`import './comp${i}.js';`);
  }
  files.push(['/virtual/src/index.ts', imports.join('\n') + '\n']);
  return files;
}

async function resolveBase(declaration, checker) {
  const instanceType = await getInstanceType(checker, declaration);
  const [baseType] = (await instanceType?.getBaseTypes()) ?? [];
  const baseSymbol = baseType ? await baseType.getSymbol() : undefined;
  if (!baseSymbol) return undefined;
  const selected = await selectDeclaration(baseSymbol);
  if (
    !selected ||
    (!isClassDeclaration(selected) && !isClassExpression(selected))
  ) {
    return undefined;
  }
  return {declaration: selected, name: baseSymbol.name};
}

async function classDeclaration(fileName, name, checker) {
  const moduleSymbol = await checker.getSymbolOfSourceFile(fileName);
  const exports = await checker.getExportsOfModule(moduleSymbol);
  const symbol = exports.find((s) => s.name === name);
  return selectDeclaration(symbol);
}

// Naive walk: replicates today's collectBaseDocumentation, full IPC per level,
// no reuse across components. This is the price of no cache.
async function naiveBaseDocs(declaration, ctx) {
  const entries = [];
  const visited = new Set();
  let current = declaration;
  for (;;) {
    const base = await resolveBase(current, ctx.checker);
    if (!base) break;
    const sf = base.declaration.getSourceFile();
    const key = `${sf.fileName}#${base.name}`;
    if (visited.has(key) || (await ctx.program.isSourceFileDefaultLibrary(sf)))
      break;
    visited.add(key);
    entries.push({key, fragment: collectClassDocumentation(base.declaration)});
    current = base.declaration;
  }
  return entries;
}

// Isolated link cache: entry = own fragment + base LINK (identity), no subtree.
function createLinkCache(initialCtx) {
  let ctx = initialCtx;
  const cache = new Map();
  let resolutions = 0;

  async function ensureEntry(declaration, name) {
    const key = `${declaration.getSourceFile().fileName}#${name}`;
    const hit = cache.get(key);
    if (hit) return {key, ...hit};
    resolutions++;
    const fragment = collectClassDocumentation(declaration);
    const base = await resolveBase(declaration, ctx.checker);
    let baseLinkKey;
    if (
      base &&
      !(await ctx.program.isSourceFileDefaultLibrary(
        base.declaration.getSourceFile()
      ))
    ) {
      baseLinkKey = `${base.declaration.getSourceFile().fileName}#${base.name}`;
    }
    const entry = {fragment, baseLinkKey};
    cache.set(key, entry);
    return {key, ...entry};
  }

  async function ensureEntryByKey(key) {
    const hit = cache.get(key);
    if (hit) return {key, ...hit};
    const name = key.slice(key.lastIndexOf('#') + 1);
    const declaration = await classDeclaration(
      key.slice(0, key.lastIndexOf('#')),
      name,
      ctx.checker
    );
    return ensureEntry(declaration, name);
  }

  async function baseDocs(declaration, name) {
    const start = await ensureEntry(declaration, name);
    const fragments = [];
    const visited = new Set();
    let linkKey = start.baseLinkKey;
    while (linkKey && !visited.has(linkKey)) {
      visited.add(linkKey);
      const entry = await ensureEntryByKey(linkKey);
      fragments.push(entry.fragment);
      linkKey = entry.baseLinkKey;
    }
    return fragments;
  }

  return {
    baseDocs,
    evict: (key) => cache.delete(key),
    setContext: (next) => {
      ctx = next;
    },
    resetResolutions: () => {
      resolutions = 0;
    },
    get resolutions() {
      return resolutions;
    },
  };
}

async function openProject(files) {
  const api = new API({
    cwd: '/virtual',
    runExternalCode: false,
    collectTiming: true,
  });
  const snapshot = await api.createSnapshot({
    fileSystem: createFileSystemWithLib(files),
    createPrograms: [{rootFiles, compilerOptions}],
    ensurePrograms: true,
  });
  const project = snapshot.operation.createdPrograms[0].getProject();
  return {
    api,
    snapshot,
    ctx: {program: project.program, checker: project.checker},
  };
}

async function componentsOf(n, checker) {
  const components = [];
  for (let i = 0; i < n; i++) {
    components.push({
      name: `Comp${i}`,
      declaration: await classDeclaration(
        `/virtual/src/comp${i}.ts`,
        `Comp${i}`,
        checker
      ),
    });
  }
  return components;
}

console.log('=== 1. Scaling: naive (no cache) vs isolated link cache ===');
console.log(
  'chain: Comp{i} -> AppBase -> SharedBase -> HTMLElement (depth 2)\n'
);
for (const n of [25, 50, 100]) {
  const files = buildFiles(n);
  const {api, snapshot, ctx} = await openProject(files);
  const components = await componentsOf(n, ctx.checker);

  await api.resetTimingInfo();
  let start = performance.now();
  const coldKeys = new Set();
  let coldVisits = 0;
  for (const {declaration} of components) {
    const entries = await naiveBaseDocs(declaration, ctx);
    coldVisits += entries.length;
    for (const e of entries) coldKeys.add(e.key);
  }
  const coldWall = performance.now() - start;
  const cold = fmt((await api.getTimingInfo()).totals);

  const cache = createLinkCache(ctx);
  await api.resetTimingInfo();
  start = performance.now();
  for (const {declaration, name} of components)
    await cache.baseDocs(declaration, name); // populate
  const populate = fmt((await api.getTimingInfo()).totals);
  const populateResolutions = cache.resolutions;

  cache.resetResolutions();
  await api.resetTimingInfo();
  start = performance.now();
  for (const {declaration, name} of components)
    await cache.baseDocs(declaration, name); // warm
  const warmWall = performance.now() - start;
  const warm = fmt((await api.getTimingInfo()).totals);
  const warmResolutions = cache.resolutions;

  console.log(
    `N=${n}: baseVisits=${coldVisits} distinctBases=${coldKeys.size} redundant=${coldVisits - coldKeys.size}`
  );
  console.log(
    `  naive cold : wall=${coldWall.toFixed(1)}ms ${JSON.stringify(cold)}`
  );
  console.log(
    `  populate   : ${JSON.stringify(populate)} classResolutions=${populateResolutions}`
  );
  console.log(
    `  link warm  : wall=${warmWall.toFixed(1)}ms ${JSON.stringify(warm)} classResolutions=${warmResolutions}`
  );
  await snapshot.dispose();
  await api.close();
}

console.log('\n=== 2. Own-file invalidation (N=60) ===');
{
  const n = 60;
  const files = buildFiles(n);
  const {api, snapshot, ctx} = await openProject(files);
  const components = await componentsOf(n, ctx.checker);
  const cache = createLinkCache(ctx);
  for (const {declaration, name} of components)
    await cache.baseDocs(declaration, name); // populate fully

  const before = await cache.baseDocs(
    components[0].declaration,
    components[0].name
  );
  const beforeEvents = before.flatMap(
    (f) => f.events?.map((e) => e.name) ?? []
  );

  // Real JSDoc edit to the shared base: add @fires base-changed.
  const editedFiles = files.map(([f, t]) =>
    f.endsWith('shared-base.ts')
      ? [
          f,
          t.replace(
            '@fires base-event - Base event.',
            '@fires base-event - Base event.\n * @fires base-changed - Changed.'
          ),
        ]
      : [f, t]
  );
  const nextSnapshot = await snapshot.update({
    fileSystem: createFileSystemWithLib(editedFiles),
    createPrograms: [{rootFiles, compilerOptions}],
    ensurePrograms: true,
  });
  const nextProject = nextSnapshot.operation.createdPrograms[0].getProject();
  cache.setContext({
    program: nextProject.program,
    checker: nextProject.checker,
  });

  // Evict ONLY the changed class. Subclass entries keep their links.
  cache.evict(SHARED_KEY);
  cache.resetResolutions();
  await api.resetTimingInfo();
  const start = performance.now();
  const results = [];
  for (const {declaration, name} of components)
    results.push(await cache.baseDocs(declaration, name));
  const invWall = performance.now() - start;
  const inv = fmt((await api.getTimingInfo()).totals);
  const invResolutions = cache.resolutions;

  const allHaveChanged = results.every((frags) =>
    frags.some((f) => f.events?.some((e) => e.name === 'base-changed'))
  );
  console.log(`before edit, base events seen: [${beforeEvents.join(', ')}]`);
  console.log(
    `after edit + evict(SharedBase only): wall=${invWall.toFixed(1)}ms ${JSON.stringify(inv)}`
  );
  console.log(
    `classResolutions=${invResolutions} (expected 1: only SharedBase; subclasses reused links)`
  );
  console.log(
    `change propagated to all ${n} components: ${allHaveChanged}; independent of N (O(1) re-resolution)`
  );
  console.log(
    `contrast: a merged-subtree cache embeds base data in every component entry, so the same edit evicts all ${n} entries -> O(N) re-resolution.`
  );
  await nextSnapshot.dispose();
  await snapshot.dispose();
  await api.close();
}
