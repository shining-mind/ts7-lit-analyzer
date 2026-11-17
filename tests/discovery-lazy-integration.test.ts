import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

import {
  AnalysisCapability,
  createDiscoverySession,
  type WebComponentRecord,
} from '../packages/cem-analyzer-ts7/dist/index.js';

const fixtureDirectory = fileURLToPath(
  new URL('fixtures/webcomponents/', import.meta.url)
);
const configFileName = join(fixtureDirectory, 'tsconfig.json');
const consumerFileName = join(fixtureDirectory, 'src/consumer.ts');

function requireComponent(
  components: readonly WebComponentRecord[],
  name: string
): WebComponentRecord {
  const component = components.find(
    (candidate) => candidate.declaration.name === name
  );
  assert.ok(component, `Expected discovered component ${name}`);
  return component;
}

test('lazy scoped discovery matches the eager component set on the fixture', async (t) => {
  const session = await createDiscoverySession({
    mode: 'consumer',
    currentDirectory: fixtureDirectory,
    configFileName,
    eagerness: 'lazy',
  });
  t.after(() => session.dispose());

  const empty = await session.collect();
  assert.deepEqual(empty.components, []);
  assert.equal(empty.snapshotId, '');

  const result = await session.collectScope([consumerFileName]);
  const eager = await createDiscoverySession({
    mode: 'consumer',
    currentDirectory: fixtureDirectory,
    configFileName,
  });
  let eagerNames: string[];
  try {
    eagerNames = (await eager.collect()).components
      .map((component) => component.declaration.name)
      .sort();
  } finally {
    await eager.dispose();
  }
  assert.deepEqual(
    result.components.map((component) => component.declaration.name).sort(),
    eagerNames
  );

  for (const component of result.components) {
    assert.equal(component.analysis.complete, AnalysisCapability.registration);
    assert.deepEqual(component.declaration.members, []);
  }

  const dialog = requireComponent(result.components, 'MdDialog');
  assert.equal(dialog.declaration.tagName, 'md-dialog');
  requireComponent(result.components, 'DualElement');
  requireComponent(result.components, 'DeclarationOnlyElement');
  requireComponent(result.components, 'JsOnlyElement');
});

test('lazy index keeps out-of-scope project components discoverable', async (t) => {
  const session = await createDiscoverySession({
    mode: 'consumer',
    currentDirectory: fixtureDirectory,
    configFileName,
    eagerness: 'lazy',
  });
  t.after(() => session.dispose());

  const result = await session.collectScope([
    join(fixtureDirectory, 'src/current-lit-element.ts'),
  ]);
  requireComponent(result.components, 'FixtureCurrentLitElement');
  const vanilla = requireComponent(result.components, 'FixtureVanillaElement');
  assert.equal(vanilla.declaration.tagName, 'fixture-vanilla');
  assert.equal(vanilla.analysis.complete, AnalysisCapability.registration);

  const enriched = await session.enrich([vanilla.declarationEvidence.id]);
  const enrichedVanilla = requireComponent(
    enriched.components,
    'FixtureVanillaElement'
  );
  assert.ok(enrichedVanilla.analysis.complete & AnalysisCapability.semantics);
  assert.ok(
    enrichedVanilla.declaration.members?.some(
      (member) => member.name === 'heading'
    )
  );
});

test('lazy on-demand types follow declaration overlays on the fixture', async (t) => {
  const session = await createDiscoverySession({
    mode: 'consumer',
    currentDirectory: fixtureDirectory,
    configFileName,
    eagerness: 'lazy',
  });
  t.after(() => session.dispose());

  const result = await session.collectScope([consumerFileName]);
  const dual = requireComponent(result.components, 'DualElement');
  const dualId = dual.declarationEvidence.id;
  const dialogId = requireComponent(result.components, 'MdDialog')
    .declarationEvidence.id;
  await session.enrich([dualId, dialogId]);
  const before = await session.getMemberType(dualId, 'count');
  const dialogBefore = await session.getMemberType(dialogId, 'noFocusTrap');
  assert.equal(before?.text, 'string');
  assert.ok(dialogBefore);

  const declarationFileName = dual.declarationEvidence.fileName;
  const original = await readFile(declarationFileName, 'utf8');
  const updated = await session.update([
    {
      fileName: declarationFileName,
      text: original.replaceAll('string', 'number'),
    },
  ]);
  const invalidated = requireComponent(updated.components, 'DualElement');
  assert.equal(invalidated.analysis.complete, AnalysisCapability.registration);

  await session.enrich([dualId]);
  const after = await session.getMemberType(dualId, 'count');
  assert.equal(after?.text, 'number');
  assert.ok(before);
  assert.ok(after);
  await assert.rejects(
    session.isAssignable(before.reference, after.reference),
    /project|snapshot/i
  );
  const dialogAfter = await session.getMemberType(dialogId, 'noFocusTrap');
  assert.ok(dialogAfter);
  assert.equal(
    await session.isAssignable(dialogBefore.reference, dialogAfter.reference),
    true
  );

  const materialized = await session.materializeTypes();
  const materializedDual = requireComponent(
    materialized.components,
    'DualElement'
  );
  const count = materializedDual.declaration.members?.find(
    (member) => member.name === 'count'
  );
  assert.ok(count?.kind === 'field');
  assert.equal(count.type?.text, 'number');
});
