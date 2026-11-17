// Lazy-mode performance measurements for the add-lazy-discovery-mode change.
// Run from the repository root after `pnpm build` and `pnpm test:discovery`
// (the webcomponents fixture must be installed):
//   node openspec/changes/add-lazy-discovery-mode/probes/lazy-performance.mjs
// Measures: deferred creation, cold scoped collection, per-component
// enrichment, cold/warm member type queries, complex-type materialization,
// scoped updates, scope extension, and JS-heap/native RSS memory.
// Indicative single runs, not performance budgets; feeds issue #26.
import {execSync} from 'node:child_process';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {fileURLToPath} from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const pkgDir = join(repoRoot, 'packages/cem-analyzer-ts7');
const {createDiscoverySession} = await import(join(pkgDir, 'dist/index.js'));

const fixtureDirectory = join(repoRoot, 'tests/fixtures/webcomponents');
const configFileName = join(fixtureDirectory, 'tsconfig.json');
const consumerFileName = join(fixtureDirectory, 'src/consumer.ts');
const litFileName = join(fixtureDirectory, 'src/current-lit-element.ts');

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

function memory(label) {
  const usage = process.memoryUsage();
  console.log(
    `memory ${label}:`,
    JSON.stringify({
      heapMB: +(usage.heapUsed / 1048576).toFixed(1),
      rssMB: +(usage.rss / 1048576).toFixed(1),
      native: nativeRssKb(),
    })
  );
}

async function timed(label, run) {
  const start = performance.now();
  const value = await run();
  console.log(`${label}: ${(performance.now() - start).toFixed(1)} ms`);
  return value;
}

function options(extra = {}) {
  return {
    mode: 'consumer',
    currentDirectory: fixtureDirectory,
    configFileName,
    eagerness: 'lazy',
    ...extra,
  };
}

console.log('=== A. Deferred creation and cold scoped collection ===');
const session = await timed('lazy createDiscoverySession (config only)', () =>
  createDiscoverySession(options())
);
memory('after lazy creation');
const empty = await timed('collect() before scope (empty)', () =>
  session.collect()
);
console.log('empty components:', empty.components.length);

const scoped = await timed('collectScope([consumer.ts]) cold', () =>
  session.collectScope([consumerFileName])
);
console.log(
  'indexed components:',
  scoped.components.map((component) => component.declaration.name).join(', ')
);
memory('after cold scoped collection');

console.log('=== B. Per-component enrichment and type queries ===');
const dialog = scoped.components.find(
  (component) => component.declaration.name === 'MdDialog'
);
const dialogId = dialog.declarationEvidence.id;
await timed('enrich([MdDialog]) cold', () => session.enrich([dialogId]));
const memberNames = ['open', 'noFocusTrap', 'ariaExpanded', 'quick'];
for (const name of memberNames) {
  const cold = await timed(`getMemberType(${name}) cold`, () =>
    session.getMemberType(dialogId, name)
  );
  console.log(`  ${name}: ${cold?.text?.slice(0, 60)}`);
}
for (const name of memberNames) {
  await timed(`getMemberType(${name}) warm`, () =>
    session.getMemberType(dialogId, name)
  );
}
await timed('materializeTypes() cold (MdDialog enriched)', () =>
  session.materializeTypes()
);
memory('after enrichment and materialization');

console.log('=== C. Scoped updates and scope extension ===');
const litSource = await import('node:fs/promises').then((fs) =>
  fs.readFile(litFileName, 'utf8')
);
await timed('update() single in-scope file overlay', () =>
  session.update([
    {fileName: litFileName, text: litSource.replace('count = 0', 'count = 1')},
  ])
);
await timed('collectScope([current-lit-element.ts]) extension', () =>
  session.collectScope([litFileName])
);
const narrow = await createDiscoverySession(options());
await timed('narrow session collectScope([current-lit-element.ts]) cold', () =>
  narrow.collectScope([litFileName])
);
const narrowResult = await narrow.collect();
console.log('narrow scope indexed components:', narrowResult.components.length);
await narrow.dispose();
await session.dispose();
memory('after dispose');

console.log('=== D. Eager comparison (pre-filtered) ===');
const eager = await createDiscoverySession({
  mode: 'consumer',
  currentDirectory: fixtureDirectory,
  configFileName,
});
await timed('eager collect() cold (pre-filtered)', () => eager.collect());
memory('after eager collect');
await eager.dispose();
