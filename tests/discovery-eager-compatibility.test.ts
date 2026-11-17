import assert from 'node:assert/strict';
import {readFile, writeFile} from 'node:fs/promises';
import {join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

import {
  createDiscoverySession,
  type DiscoveryResult,
} from '../packages/cem-analyzer-ts7/dist/index.js';

const fixtureDirectory = fileURLToPath(
  new URL('fixtures/webcomponents/', import.meta.url)
);
const baselineFile = fileURLToPath(
  new URL('discovery-eager-baseline.json', import.meta.url)
);

// Rewrites machine-specific paths into a stable, portable form: collapses the
// pnpm virtual store to the consumer-facing package path and replaces the
// absolute fixture root with a token, so the baseline carries no private paths.
function normalizePaths<T>(value: T): T {
  if (typeof value === 'string') {
    return value
      .replace(/node_modules\/\.pnpm\/[^/]+\/node_modules\//g, 'node_modules/')
      .replaceAll(fixtureDirectory, '<fixture>/') as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizePaths(item)) as T;
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>).map(([key, item]) => [
        key,
        normalizePaths(item),
      ])
    ) as T;
  }
  return value;
}

// Stable projection of the eager contract: excludes process-local identities
// (project id, snapshot id, semantic reference ids) but keeps every CEM field,
// evidence range, completeness mask, and issue, with portable paths.
export function projectEagerResult(result: DiscoveryResult) {
  const projection = normalizePaths({
    containsOverlays: result.containsOverlays,
    overlayFiles: result.overlayFiles,
    issues: result.issues,
    components: result.components.map((component) => ({
      declaration: component.declaration,
      declarationEvidence: component.declarationEvidence,
      registrations: component.registrations,
      members: component.members.map((member) => ({
        memberName: member.memberName,
        declaration: member.declaration,
      })),
      analysis: component.analysis,
    })),
  });
  projection.components.sort((a, b) =>
    a.declarationEvidence.id.localeCompare(b.declarationEvidence.id)
  );
  return projection;
}

test('default eager session matches the recorded fixture contract', async (t) => {
  const session = await createDiscoverySession({
    mode: 'consumer',
    currentDirectory: fixtureDirectory,
    configFileName: join(fixtureDirectory, 'tsconfig.json'),
  });
  t.after(() => session.dispose());

  const result = await session.collect();
  assert.equal(result.generation, 1);
  assert.ok(result.snapshotId.length > 0);
  assert.equal(result.project.currentDirectory, resolve(fixtureDirectory));

  const projection = projectEagerResult(result);
  // Regenerate the portable baseline with UPDATE_EAGER_BASELINE=1.
  if (process.env.UPDATE_EAGER_BASELINE === '1') {
    await writeFile(baselineFile, `${JSON.stringify(projection, null, 2)}\n`);
    return;
  }
  const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
  assert.deepEqual(projection, baseline);
});
