import assert from 'node:assert/strict';
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

test('discovers representative project and dependency public APIs', async (t) => {
  const session = await createDiscoverySession({
    mode: 'consumer',
    configFileName: join(fixtureDirectory, 'tsconfig.json'),
  });
  t.after(() => session.dispose());

  const result = await session.collect();
  assert.equal(result.containsOverlays, false);
  assert.deepEqual(result.overlayFiles, []);

  for (const name of [
    'FixtureVanillaElement',
    'FixtureCurrentLitElement',
    'FixtureLegacyLitElement',
    'JsOnlyElement',
    'DeclarationOnlyElement',
    'DualElement',
    'MdDialog',
  ]) {
    requireComponent(result.components, name);
  }

  const dual = requireComponent(result.components, 'DualElement');
  const dualCount = dual.declaration.members?.find(
    (member) => member.name === 'count'
  );
  assert.ok(dualCount?.kind === 'field');
  assert.equal(dualCount.type?.text, 'string');
  assert.ok(
    dual.declaration.attributes?.some(
      (attribute) =>
        attribute.name === 'count' && attribute.fieldName === 'count'
    )
  );
});

test('Material Web combines declaration semantics with JavaScript metadata', async (t) => {
  const session = await createDiscoverySession({
    mode: 'consumer',
    configFileName: join(fixtureDirectory, 'tsconfig.json'),
  });
  t.after(() => session.dispose());

  const result = await session.collect();
  const dialog = requireComponent(result.components, 'MdDialog');
  const noFocusTrap = dialog.declaration.members?.find(
    (member) => member.name === 'noFocusTrap'
  );

  assert.ok(noFocusTrap?.kind === 'field');
  assert.equal(noFocusTrap.type?.text, 'boolean');
  assert.equal(noFocusTrap.privacy, undefined);
  assert.ok(
    dialog.declaration.attributes?.some(
      (attribute) =>
        attribute.name === 'no-focus-trap' &&
        attribute.fieldName === 'noFocusTrap'
    )
  );
  assert.equal(
    dialog.analysis.complete & AnalysisCapability.semantics,
    AnalysisCapability.semantics
  );
});
