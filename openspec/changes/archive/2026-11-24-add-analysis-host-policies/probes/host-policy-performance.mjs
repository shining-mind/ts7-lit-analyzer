import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cpus, totalmem} from 'node:os';
import {join} from 'node:path';
import {performance} from 'node:perf_hooks';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const {createRegistrySession, findProperty} = await import(
  join(repoRoot, 'packages/analyzer-core/dist/index.js')
);
const fixtureDirectory = join(repoRoot, 'tests/fixtures/webcomponents');
const configFileName = join(fixtureDirectory, 'tsconfig.json');
const consumerFileName = join(fixtureDirectory, 'src/consumer.ts');
const editedFileName = join(fixtureDirectory, 'src/current-lit-element.ts');
const editedSource = await readFile(editedFileName, 'utf8');
const updatedSource = editedSource.replace('count = 0', 'count = 1');
assert.notEqual(updatedSource, editedSource);
const typescript = JSON.parse(
  await readFile(
    join(
      repoRoot,
      'packages/cem-analyzer-ts7/node_modules/typescript/package.json'
    ),
    'utf8'
  )
);
const runsArgument = process.argv.find((argument) =>
  argument.startsWith('--runs=')
);
const runCount = runsArgument
  ? Number(runsArgument.slice('--runs='.length))
  : 3;
assert.ok(
  Number.isInteger(runCount) && runCount > 0 && runCount <= 20,
  '--runs must be an integer from 1 to 20'
);

function nativeProcesses() {
  let output;
  try {
    output = execFileSync('pgrep', ['-f', 'tsc --api --async'], {
      encoding: 'utf8',
    });
  } catch (error) {
    if (error.status === 1) return [];
    throw error;
  }
  return output
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((pidText) => {
      const pid = Number(pidText);
      const rssKb = Number(
        execFileSync('ps', ['-o', 'rss=', '-p', String(pid)], {
          encoding: 'utf8',
        }).trim()
      );
      return {pid, rssBytes: rssKb * 1024};
    });
}

function memorySample() {
  const usage = process.memoryUsage();
  return {
    processHeapUsedBytes: usage.heapUsed,
    processRssBytes: usage.rss,
    matchingNativeRssBytes: nativeProcesses().reduce(
      (total, process) => total + process.rssBytes,
      0
    ),
  };
}

function memoryMeasurement(before, after) {
  return {
    ...after,
    processHeapUsedDeltaBytes:
      after.processHeapUsedBytes - before.processHeapUsedBytes,
    processRssDeltaBytes: after.processRssBytes - before.processRssBytes,
    matchingNativeRssDeltaBytes:
      after.matchingNativeRssBytes - before.matchingNativeRssBytes,
  };
}

function rounded(value) {
  return Number(value.toFixed(3));
}

function timingDelta(before, after) {
  return Object.fromEntries(
    Object.keys(after.totals).map((key) => [
      key,
      rounded(after.totals[key] - before.totals[key]),
    ])
  );
}

async function measureCreation(metrics, create) {
  const before = memorySample();
  const startedAt = performance.now();
  const session = await create();
  metrics.createSession = {
    wallMs: rounded(performance.now() - startedAt),
    memory: memoryMeasurement(before, memorySample()),
  };
  return session;
}

async function measure(session, metrics, name, operation) {
  await session.resetTimingInfo();
  const timingBefore = await session.getTimingInfo();
  assert.equal(timingBefore.enabled, true);
  const memoryBefore = memorySample();
  const startedAt = performance.now();
  const value = await operation();
  const wallMs = performance.now() - startedAt;
  const timingAfter = await session.getTimingInfo();
  metrics[name] = {
    wallMs: rounded(wallMs),
    timing: timingDelta(timingBefore, timingAfter),
    memory: memoryMeasurement(memoryBefore, memorySample()),
  };
  return value;
}

function newNativePids(baseline) {
  const baselinePids = new Set(baseline.map((process) => process.pid));
  return nativeProcesses()
    .map((process) => process.pid)
    .filter((pid) => !baselinePids.has(pid));
}

async function disposeAndVerify(session, baseline, cleanup) {
  const ownedPids = newNativePids(baseline);
  if (session) await session.dispose();
  const deadline = Date.now() + 5000;
  let remaining = ownedPids.filter((pid) =>
    nativeProcesses().some((process) => process.pid === pid)
  );
  while (remaining.length > 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    remaining = ownedPids.filter((pid) =>
      nativeProcesses().some((process) => process.pid === pid)
    );
  }
  cleanup.ownedNativePids = ownedPids;
  cleanup.remainingOwnedNativePids = remaining;
  assert.deepEqual(remaining, [], 'Native processes outlived session disposal');
}

function sessionOptions(eagerness) {
  return {
    mode: 'consumer',
    currentDirectory: fixtureDirectory,
    configFileName,
    collectTiming: true,
    retentionBound: 1,
    ...(eagerness ? {eagerness} : {}),
  };
}

async function runEager() {
  const baseline = nativeProcesses();
  const metrics = {};
  const cleanup = {};
  let session;
  try {
    session = await measureCreation(metrics, () =>
      createRegistrySession(sessionOptions())
    );
    const cold = await measure(session, metrics, 'collectCold', () =>
      session.collect()
    );
    const component = cold.byTagName('fixture-current-lit');
    assert.ok(component);
    assert.equal(findProperty(component, 'count')?.type?.text, 'number');
    await measure(session, metrics, 'collectWarm', () => session.collect());
    const query = await measure(session, metrics, 'memberTypeWarm', () =>
      session.memberType(component.declarationEvidence.id, 'count')
    );
    assert.equal(query?.text, 'number');
    await measure(session, metrics, 'overlayUpdate', () =>
      session.update([{fileName: editedFileName, text: updatedSource}])
    );
    const restored = await measure(session, metrics, 'overlayRemoval', () =>
      session.removeOverlays([editedFileName])
    );
    assert.equal(restored.containsOverlays, false);
    assert.equal(
      findProperty(restored.byTagName('fixture-current-lit'), 'count')?.type
        ?.text,
      'number'
    );
  } finally {
    await disposeAndVerify(session, baseline, cleanup);
  }
  return {metrics, cleanup};
}

async function runLazy() {
  const baseline = nativeProcesses();
  const metrics = {};
  const cleanup = {};
  let session;
  try {
    session = await measureCreation(metrics, () =>
      createRegistrySession(sessionOptions('lazy'))
    );
    const scoped = await measure(session, metrics, 'collectScopeCold', () =>
      session.collectScope([consumerFileName])
    );
    const component = scoped.byTagName('fixture-current-lit');
    assert.ok(component);
    const id = component.declarationEvidence.id;
    await measure(session, metrics, 'collectWarm', () => session.collect());
    await measure(session, metrics, 'collectScopeWarm', () =>
      session.collectScope([consumerFileName])
    );
    await measure(session, metrics, 'enrichCold', () => session.enrich([id]));
    const coldQuery = await measure(session, metrics, 'memberTypeCold', () =>
      session.memberType(id, 'count')
    );
    assert.equal(coldQuery?.text, 'number');
    const warmQuery = await measure(session, metrics, 'memberTypeWarm', () =>
      session.memberType(id, 'count')
    );
    assert.equal(warmQuery?.text, 'number');
    const materialized = await measure(
      session,
      metrics,
      'materializeTypes',
      () => session.materializeTypes()
    );
    assert.equal(
      findProperty(materialized.byTagName('fixture-current-lit'), 'count')?.type
        ?.text,
      'number'
    );
    await measure(session, metrics, 'overlayUpdate', () =>
      session.update([{fileName: editedFileName, text: updatedSource}])
    );
    const restored = await measure(session, metrics, 'overlayRemoval', () =>
      session.removeOverlays([editedFileName])
    );
    assert.equal(restored.containsOverlays, false);
    await session.collectScope([consumerFileName]);
    await session.enrich([id]);
    const current = await session.materializeTypes();
    assert.equal(
      findProperty(current.byTagName('fixture-current-lit'), 'count')?.type
        ?.text,
      'number'
    );
  } finally {
    await disposeAndVerify(session, baseline, cleanup);
  }
  return {metrics, cleanup};
}

function distribution(values) {
  const sorted = [...values].sort((first, second) => first - second);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 0
      ? (sorted[middle - 1] + sorted[middle]) / 2
      : sorted[middle];
  return {
    min: rounded(sorted[0]),
    median: rounded(median),
    max: rounded(sorted.at(-1)),
    mean: rounded(
      sorted.reduce((total, value) => total + value, 0) / sorted.length
    ),
  };
}

function summarize(runs) {
  const summary = {};
  for (const mode of ['eager', 'lazy']) {
    summary[mode] = {};
    for (const name of Object.keys(runs[0][mode].metrics)) {
      summary[mode][name] = {
        wallMs: distribution(runs.map((run) => run[mode].metrics[name].wallMs)),
      };
    }
  }
  return summary;
}

const runs = [];
for (let index = 0; index < runCount; index += 1) {
  runs.push({index: index + 1, eager: await runEager(), lazy: await runLazy()});
}
const fixtureStatus = execFileSync(
  'git',
  ['status', '--short', '--', 'tests/fixtures/webcomponents'],
  {cwd: repoRoot, encoding: 'utf8'}
).trim();
const report = {
  schemaVersion: 1,
  measuredAt: new Date().toISOString(),
  environment: {
    node: process.version,
    typescript: typescript.version,
    platform: process.platform,
    architecture: process.arch,
    cpu: cpus()[0]?.model ?? 'unknown',
    logicalCpuCount: cpus().length,
    totalMemoryBytes: totalmem(),
  },
  fixture: {
    path: 'tests/fixtures/webcomponents',
    revision: execFileSync('git', ['rev-parse', 'HEAD'], {
      cwd: repoRoot,
      encoding: 'utf8',
    }).trim(),
    workingTreeStatus: fixtureStatus || 'clean',
  },
  configuration: {runCount, retentionBound: 1, serial: true},
  attribution: {
    processMemory: 'Whole probe process; not an exact per-registry allocation.',
    nativeMemory:
      'Aggregate RSS of processes matching "tsc --api --async"; not a supported per-session identity.',
    timing:
      'Public timing totals differenced around each operation after reset and baseline retrieval; timing retrieval itself performs requests.',
  },
  runs,
  summary: summarize(runs),
};
console.log(JSON.stringify(report, null, 2));
