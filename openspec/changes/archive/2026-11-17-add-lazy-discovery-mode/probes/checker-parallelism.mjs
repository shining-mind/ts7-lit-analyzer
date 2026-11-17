// Investigates whether batching checker requests (Promise.all) parallelizes
// native type computation or only saves transport round-trips. Compares a
// sequential for-await loop against Promise.all on distinct cold methods of
// one snapshot, using API server timing to separate server work from transport.
// Indicative single runs, not performance budgets; feeds issue #34.
// Run from the repository root after `pnpm build`:
//   node openspec/changes/add-lazy-discovery-mode/probes/checker-parallelism.mjs
import {performance} from 'node:perf_hooks';
import {API, ModuleKind, ModuleResolutionKind} from 'typescript/async';
import {ScriptTarget} from 'typescript/ast';
import {createFileSystemWithLib} from 'typescript/fs';

const paramTypes = [
  'string',
  'number',
  'boolean',
  'string | number',
  'Array<string>',
  '{ x: number; y: string }',
  'string | null',
  'number[]',
  'Record<string, number>',
  '(() => void) | null',
];
const paramList = paramTypes.map((t, i) => `p${i}: ${t}`).join(', ');
const methodCount = 20;
const methods = Array.from(
  {length: methodCount},
  (_, i) => `  m${i}(${paramList}): void {}`
).join('\n');
const source = `export class Widget extends HTMLElement {\n${methods}\n}\ncustomElements.define('x-widget', Widget);\n`;

const api = new API({collectTiming: true});
const snapshot = await api.createSnapshot({
  fileSystem: createFileSystemWithLib([['/virtual/index.ts', source]]),
  createPrograms: [
    {
      rootFiles: ['/virtual/index.ts'],
      compilerOptions: {
        allowJs: true,
        strict: true,
        target: ScriptTarget.ESNext,
        module: ModuleKind.NodeNext,
        moduleResolution: ModuleResolutionKind.NodeNext,
        types: [],
        skipLibCheck: true,
      },
    },
  ],
  ensurePrograms: true,
});

const program = snapshot.operation.createdPrograms[0];
const checker = program.getProject().checker;
const moduleSymbol = await checker.getSymbolOfSourceFile('/virtual/index.ts');
const exports = await checker.getExportsOfModule(moduleSymbol);
const classSymbol = exports.find((s) => s.name === 'Widget');
const classType = await checker.getTypeOfSymbol(classSymbol);
const [ctor] = await classType.getConstructSignatures();
const instanceType = await checker.getReturnTypeOfSignature(ctor);
const props = await instanceType.getProperties();

async function paramsOf(name) {
  const sym = props.find((p) => p.name === name);
  const type = await checker.getTypeOfSymbol(sym);
  const [sig] = await type.getCallSignatures();
  const symbols = await sig.getParameters();
  return Promise.all(
    symbols.map(async (symbol) => ({
      symbol,
      decl: await symbol.valueDeclaration?.resolve(),
    }))
  );
}

// Pre-resolve symbols/declarations so the measured loop only does type queries.
const half = methodCount / 2;
const seqMethods = [];
const parMethods = [];
for (let i = 0; i < half; i++) {
  seqMethods.push(await paramsOf(`m${i}`));
  parMethods.push(await paramsOf(`m${half + i}`));
}

async function typeText({symbol, decl}) {
  const type = await checker.getTypeOfSymbolAtLocation(symbol, decl);
  return checker.typeToString(type, decl);
}

// Parallel runs first so it is cold; sequential runs second (warm cache).
// If batching still wins cold, the gain is transport, not native parallelism.
await api.resetTimingInfo();
let start = performance.now();
const parTexts = await Promise.all(
  parMethods.flatMap((params) => params.map((param) => typeText(param)))
);
const parWall = performance.now() - start;
const parTiming = (await api.getTimingInfo()).totals;

await api.resetTimingInfo();
start = performance.now();
const seqTexts = [];
for (const params of seqMethods) {
  for (const param of params) {
    seqTexts.push(await typeText(param));
  }
}
const seqWall = performance.now() - start;
const seqTiming = (await api.getTimingInfo()).totals;

const perMethod = paramTypes.length;
// Compare method-by-method (seq m_i vs par m_{half+i} have identical signatures).
let identical = true;
for (let m = 0; m < half; m++) {
  for (let p = 0; p < perMethod; p++) {
    if (seqTexts[m * perMethod + p] !== parTexts[m * perMethod + p]) {
      identical = false;
    }
  }
}

const fmt = (t) => ({
  wallMs: +t.wall.toFixed(1),
  serverMs: +t.server.toFixed(1),
  transportMs: +t.transport.toFixed(1),
  requests: t.requests,
});
console.log('queries per mode:', half * perMethod);
console.log(
  'sequential:',
  fmt({
    wall: seqWall,
    server: seqTiming.serverTimeMs,
    transport: seqTiming.transportOverheadMs,
    requests: seqTiming.requestCount,
  })
);
console.log(
  'parallel:  ',
  fmt({
    wall: parWall,
    server: parTiming.serverTimeMs,
    transport: parTiming.transportOverheadMs,
    requests: parTiming.requestCount,
  })
);
console.log('type texts identical & ordered:', identical);
console.log('sample types:', seqTexts.slice(0, perMethod));

await snapshot.dispose();
await api.close();
