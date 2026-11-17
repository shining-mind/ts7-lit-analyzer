// Performance measurements for the 2026-11-16 lazy-discovery research.
// Run from the repository root after `pnpm build` and `pnpm test:discovery`
// (the webcomponents fixture must be installed):
//   node openspec/changes/add-lazy-discovery-mode/probes/performance.mjs
// Measures: fixture phase breakdown, BFS program-reload waves, synthetic
// scaling, warm semantic-query latency, and JS-heap/native RSS memory.
import {execSync} from 'node:child_process';
import {existsSync, readFileSync} from 'node:fs';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const pkgDir = join(repoRoot, 'packages/cem-analyzer-ts7');
const tsDir = join(pkgDir, 'node_modules/typescript');
const {createDiscoverySession} = await import(join(pkgDir, 'dist/index.js'));
const {buildModuleGraph} = await import(join(pkgDir, 'dist/graph/index.js'));
const {createSemanticCollector} = await import(
  join(pkgDir, 'dist/semantics/index.js')
);
const {mergeComponentMetadata} = await import(
  join(pkgDir, 'dist/discovery/metadata.js')
);
const {API, ModuleKind, ModuleResolutionKind} = await import(
  join(tsDir, 'dist/api/async/api.js')
);
const {createFileSystemLayer} = await import(join(tsDir, 'dist/api/fs.js'));
const {ScriptTarget} = await import(join(tsDir, 'dist/ast/index.js'));

const fixtureDirectory = join(repoRoot, 'tests/fixtures/webcomponents');

function nativeRssKb() {
  try {
    return execSync('pgrep -f "tsc --api --async"', {encoding: 'utf8'})
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((pid) => ({
        pid,
        rssKb: Number(
          execSync(`ps -o rss= -p ${pid}`, {encoding: 'utf8'}).trim()
        ),
      }));
  } catch {
    return [];
  }
}

function mem() {
  const m = process.memoryUsage();
  return {
    heapMB: +(m.heapUsed / 1048576).toFixed(1),
    rssMB: +(m.rss / 1048576).toFixed(1),
    native: nativeRssKb(),
  };
}

async function timed(label, fn) {
  const start = performance.now();
  const value = await fn();
  console.log(`${label}: ${(performance.now() - start).toFixed(1)} ms`);
  return value;
}

console.log('=== A. Fixture end-to-end (consumer mode) ===');
console.log('memory before:', JSON.stringify(mem()));
const session = await timed('createDiscoverySession (snapshot+graph)', () =>
  createDiscoverySession({
    mode: 'consumer',
    configFileName: join(fixtureDirectory, 'tsconfig.json'),
  })
);
console.log('memory after session:', JSON.stringify(mem()));
const result = await timed('collect() cold', () => session.collect());
console.log('memory after collect:', JSON.stringify(mem()));
console.log(
  `components=${result.components.length} resultJSONKB=${(JSON.stringify(result).length / 1024).toFixed(1)}`
);
console.log(
  'members per component:',
  JSON.stringify(
    result.components.map((c) => [
      c.declaration.name,
      c.declaration.members?.length ?? 0,
    ])
  )
);
await timed('collect() warm (cached)', () => session.collect());
const vanillaFile = join(fixtureDirectory, 'src/vanilla-element.ts');
const vanillaText = readFileSync(vanillaFile, 'utf8');
const updated = await timed('update() single project file overlay', () =>
  session.update([
    {fileName: vanillaFile, text: vanillaText.replace('string', 'number')},
  ])
);
console.log(
  `structurally reused records: ${updated.components.filter((c) => result.components.some((old) => old === c)).length}/${updated.components.length}`
);
const consumerFile = join(fixtureDirectory, 'src/consumer.ts');
const consumerText = readFileSync(consumerFile, 'utf8');
const pos = consumerText.indexOf('dialog.noFocusTrap') + 'dialog.'.length;
const ref = await timed('getTypeAtPosition cold', () =>
  session.getTypeAtPosition(consumerFile, pos)
);
let start = performance.now();
for (let i = 0; i < 20; i++) await session.getTypeAtPosition(consumerFile, pos);
console.log(
  `getTypeAtPosition warm avg: ${((performance.now() - start) / 20).toFixed(2)} ms`
);
const numberPos =
  consumerText.indexOf('jsOnly.count = 1') + 'jsOnly.count = '.length;
const numRef = await session.getTypeAtPosition(consumerFile, numberPos);
start = performance.now();
for (let i = 0; i < 20; i++) await session.isAssignable(numRef, ref);
console.log(
  `isAssignable warm avg: ${((performance.now() - start) / 20).toFixed(2)} ms`
);
await timed('dispose', () => session.dispose());

console.log('\n=== B. Fixture phase breakdown (instrumented internals) ===');
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
  experimentalDecorators: true,
};
const rootFiles = [
  'src/consumer.ts',
  'src/current-lit-element.ts',
  'src/legacy-lit-element.ts',
  'src/vanilla-element.ts',
].map((f) => join(fixtureDirectory, f));
const api = new API({cwd: fixtureDirectory, runExternalCode: false});
const initialSnapshot = await api.createSnapshot({
  fileSystem: createFileSystemLayer([]),
  createPrograms: [{rootFiles, compilerOptions}],
});
let waves = 0;
const built = await timed('buildModuleGraph', () =>
  buildModuleGraph({
    api,
    initial: {
      snapshot: initialSnapshot,
      project: initialSnapshot.operation.createdPrograms[0].getProject(),
    },
    rootFiles,
    compilerOptions,
    fileExists: (f) => existsSync(f),
    reload: async (roots, base) => {
      waves++;
      const snapshot = await base.snapshot.update({
        fileSystem: createFileSystemLayer([]),
        createPrograms: [{rootFiles: roots, compilerOptions}],
      });
      return {
        snapshot,
        project: snapshot.operation.createdPrograms[0].getProject(),
      };
    },
  })
);
console.log(`waves=${waves} modules=${built.graph.modules.length}`);
const semantics = createSemanticCollector({
  program: built.project.program,
  project: {id: 'probe', currentDirectory: fixtureDirectory},
  snapshotId: 'snapshot-probe',
});
const collected = [];
const sourceFiles = [];
await timed('semantics over all modules', async () => {
  for (const module of built.graph.modules) {
    const sf = await built.project.program.getSourceFile(module.fileName);
    if (sf) sourceFiles.push(sf);
    collected.push(...(await semantics.collectSourceFile(module.fileName)));
  }
});
console.log(`exported classes collected before filtering: ${collected.length}`);
const merged = await timed('mergeComponentMetadata (all files)', () =>
  mergeComponentMetadata(collected, {
    program: built.project.program,
    checker: built.project.checker,
    sourceFiles,
  })
);
console.log(`merged components: ${merged.length}`);
const single = collected.filter((c) =>
  c.declarationEvidence.fileName.endsWith('current-lit-element.ts')
);
await timed('merge ONE component, full-file scan context', () =>
  mergeComponentMetadata(single, {
    program: built.project.program,
    checker: built.project.checker,
    sourceFiles,
  })
);
await timed('merge ONE component, single-file scan context', () =>
  mergeComponentMetadata(single, {
    program: built.project.program,
    checker: built.project.checker,
    sourceFiles: sourceFiles.filter((sf) =>
      sf.fileName.endsWith('current-lit-element.ts')
    ),
  })
);
await built.snapshot.dispose();
await api.close();

console.log('\n=== C. Synthetic scaling (standalone, in-memory) ===');
function syntheticFiles(n) {
  const files = [];
  const imports = [];
  for (let i = 0; i < n; i++) {
    files.push({
      fileName: `/virtual/src/c${i}.ts`,
      text:
        `export class Element${i} extends HTMLElement {\n` +
        "  alpha: number = 0;\n  beta: string = '';\n  gamma: boolean = false;\n  delta: string[] = [];\n}\n" +
        `customElements.define('x-el-${i}', Element${i});\n`,
    });
    imports.push(`import './c${i}.js';`);
  }
  files.push({
    fileName: '/virtual/src/index.ts',
    text: imports.join('\n') + '\n',
  });
  return files;
}
for (const n of [50, 200, 400]) {
  const files = syntheticFiles(n);
  const s = await timed(`N=${n} createSession`, () =>
    createDiscoverySession({
      mode: 'standalone',
      currentDirectory: '/virtual',
      rootFiles: ['/virtual/src/index.ts'],
      files,
    })
  );
  const r = await timed(`N=${n} collect`, () => s.collect());
  console.log(
    `N=${n} components=${r.components.length} JSONKB=${(JSON.stringify(r).length / 1024).toFixed(0)} memory=${JSON.stringify(mem())}`
  );
  await timed(`N=${n} update(one file)`, () =>
    s.update([
      {
        fileName: files[0].fileName,
        text: files[0].text.replace('alpha: number', 'alpha: string'),
      },
    ])
  );
  await s.dispose();
}

console.log('\n=== D. Re-export chain depth (BFS waves) ===');
function chainFiles(depth) {
  const files = [
    {
      fileName: '/virtual/src/index.ts',
      text: "export {DeepElement} from './r0.js';\n",
    },
  ];
  for (let i = 0; i < depth; i++) {
    const next = i === depth - 1 ? './component.js' : `./r${i + 1}.js`;
    files.push({
      fileName: `/virtual/src/r${i}.ts`,
      text: `export {DeepElement} from '${next}';\n`,
    });
  }
  files.push({
    fileName: '/virtual/src/component.ts',
    text: "export class DeepElement extends HTMLElement { value: number = 0; }\ncustomElements.define('x-deep', DeepElement);\n",
  });
  return files;
}
for (const depth of [10, 30]) {
  const files = chainFiles(depth);
  const chainApi = new API({cwd: '/virtual', runExternalCode: false});
  const layer = () =>
    createFileSystemLayer(files.map((f) => [f.fileName, f.text]));
  const snap = await chainApi.createSnapshot({
    fileSystem: layer(),
    createPrograms: [{rootFiles: ['/virtual/src/index.ts'], compilerOptions}],
  });
  let chainWaves = 0;
  const chainBuilt = await timed(`depth=${depth} buildModuleGraph`, () =>
    buildModuleGraph({
      api: chainApi,
      initial: {
        snapshot: snap,
        project: snap.operation.createdPrograms[0].getProject(),
      },
      rootFiles: ['/virtual/src/index.ts'],
      compilerOptions,
      fileExists: (f) => files.some((file) => file.fileName === f),
      reload: async (roots, base) => {
        chainWaves++;
        const next = await base.snapshot.update({
          fileSystem: layer(),
          createPrograms: [{rootFiles: roots, compilerOptions}],
        });
        return {
          snapshot: next,
          project: next.operation.createdPrograms[0].getProject(),
        };
      },
    })
  );
  console.log(
    `depth=${depth} waves=${chainWaves} modules=${chainBuilt.graph.modules.length}`
  );
  await chainBuilt.snapshot.dispose();
  await chainApi.close();
}
