import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
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

// Stable projection of the eager contract: excludes process-local identities
// (project id, snapshot id, semantic reference ids) but keeps every CEM field,
// evidence range, completeness mask, and issue.
export function projectEagerResult(result: DiscoveryResult) {
  return {
    containsOverlays: result.containsOverlays,
    overlayFiles: result.overlayFiles,
    issues: result.issues,
    components: result.components
      .map((component) => ({
        declaration: component.declaration,
        declarationEvidence: component.declarationEvidence,
        registrations: component.registrations,
        members: component.members.map((member) => ({
          memberName: member.memberName,
          declaration: member.declaration,
        })),
        analysis: component.analysis,
      }))
      .sort((a, b) =>
        a.declarationEvidence.id.localeCompare(b.declarationEvidence.id)
      ),
  };
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

  const baseline = JSON.parse(await readFile(baselineFile, 'utf8'));
  assert.deepEqual(projectEagerResult(result), baseline);
});
