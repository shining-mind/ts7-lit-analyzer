import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

import {
  AnalysisCapability,
  capabilityStatus,
  createRegistrySession,
  findEvent,
  findProperty,
  findSlot,
  memberDeclaration,
  optionalMetadataCoverage,
  resolveAttribute,
  superclassReference,
  type RegistrySession,
  type RegistryView,
  type SemanticReference,
} from '../packages/analyzer-core/dist/index.js';

const fixtureDirectory = fileURLToPath(
  new URL('fixtures/webcomponents/', import.meta.url)
);
const configFileName = join(fixtureDirectory, 'tsconfig.json');
const consumerFile = join(fixtureDirectory, 'src/consumer.ts');

async function withSession(
  run: (session: RegistrySession, view: RegistryView) => Promise<void>
): Promise<void> {
  const session = await createRegistrySession({
    mode: 'consumer',
    configFileName,
  });
  try {
    await run(session, await session.collect());
  } finally {
    await session.dispose();
  }
}

function component(view: RegistryView, name: string) {
  const found = view
    .components()
    .find((candidate) => candidate.declaration.name === name);
  assert.ok(found, `Expected component ${name}`);
  return found;
}

function reference(
  view: RegistryView,
  name: string,
  memberName: string
): SemanticReference {
  const record = component(view, name);
  const ref = record.members.find(
    (member) => member.memberName === memberName
  )?.type;
  assert.ok(ref, `Missing reference ${name}.${memberName}`);
  return ref;
}

test('consumer session collects project and dependency components with view identity', async () => {
  await withSession(async (_session, view) => {
    assert.equal(view.containsOverlays, false);
    assert.deepEqual(view.overlayFiles, []);
    assert.equal(view.project.configFileName, configFileName);
    for (const name of [
      'FixtureVanillaMetadataElement',
      'FixtureLitMetadataElement',
      'FixtureCurrentLitElement',
      'MdDialog',
      'MdFilledButton',
      'JsOnlyElement',
    ]) {
      component(view, name);
    }
    assert.equal(view.byTagName('md-dialog')?.declaration.name, 'MdDialog');
    assert.equal(view.byTagName('x-not-registered'), undefined);
  });
});

test('vanilla and Lit fixtures share one framework-neutral contract', async () => {
  await withSession(async (_session, view) => {
    const vanilla = component(view, 'FixtureVanillaMetadataElement');
    const lit = component(view, 'FixtureLitMetadataElement');
    const revived = JSON.parse(JSON.stringify(vanilla));
    assert.equal(revived.declaration.name, 'FixtureVanillaMetadataElement');
    assert.equal(findEvent(vanilla, 'vanilla-change')?.name, 'vanilla-change');
    assert.equal(findSlot(vanilla, 'header')?.name, 'header');
    assert.equal(
      findEvent(lit, 'lit-select')?.type?.text,
      'CustomEvent<string>'
    );
    assert.deepEqual(superclassReference(vanilla), {name: 'HTMLElement'});
    assert.equal(superclassReference(lit)?.name, 'LitElement');
    assert.ok(superclassReference(lit)?.package);
  });
});

test('Material Web resolves properties, attributes, inherited events, and provenance', async () => {
  await withSession(async (_session, view) => {
    const dialog = component(view, 'MdDialog');
    assert.equal(findProperty(dialog, 'noFocusTrap')?.type?.text, 'boolean');
    const alias = resolveAttribute(dialog, 'no-focus-trap');
    assert.equal(alias?.property?.name, 'noFocusTrap');

    const eventNames = (dialog.declaration.events ?? []).map(
      (event) => event.name
    );
    for (const name of ['open', 'opened', 'close', 'closed', 'cancel']) {
      assert.ok(eventNames.includes(name), `Missing inherited event ${name}`);
    }
    assert.match(
      memberDeclaration(dialog, 'open')?.fileName ?? '',
      /dialog\/internal\/dialog\.d\.ts$/
    );

    const superclass = superclassReference(dialog);
    assert.equal(superclass?.name, 'Dialog');
    assert.equal(superclass?.package, '@material/web');
    assert.match(superclass?.module ?? '', /dialog\/internal\/dialog\.d\.ts$/);

    assert.equal(
      optionalMetadataCoverage(dialog, AnalysisCapability.slots),
      'undocumented'
    );
    assert.equal(
      capabilityStatus(dialog, AnalysisCapability.semantics),
      'complete'
    );
  });
});

test('re-exported dependency keeps canonical identity through pnpm symlinks', async () => {
  await withSession(async (_session, view) => {
    const record = view.byTagName('fixture-js-only');
    assert.ok(record);
    assert.equal(record.declaration.name, 'JsOnlyElement');
    assert.match(
      record.declarationEvidence.fileName,
      /@fixture\/js-only\/element\.js$/
    );
    assert.equal(record.declarationEvidence.package?.name, '@fixture/js-only');
    assert.match(
      record.declarationEvidence.package?.realPath ?? '',
      /node_modules\/@fixture\/js-only$/
    );
    assert.equal(view.byDeclarationId(record.declarationEvidence.id), record);
    assert.ok(
      record.consumerProvenance?.some(
        (provenance) =>
          provenance.exportName === 'PublicJsOnlyElement' &&
          provenance.package?.name === '@fixture/reexport' &&
          /@fixture\/reexport\/index\.js$/.test(provenance.module)
      ),
      'Expected the renamed consumer-facing alias and re-export module provenance'
    );
  });
});

test('same-snapshot assignability distinguishes string and number properties', async () => {
  await withSession(async (session, view) => {
    const stringCount = reference(view, 'DualElement', 'count');
    const numberCount = reference(view, 'FixtureCurrentLitElement', 'count');
    assert.equal(stringCount.snapshotId, numberCount.snapshotId);
    assert.equal(await session.isAssignable(stringCount, numberCount), false);
    assert.equal(await session.isAssignable(numberCount, numberCount), true);
    assert.equal(
      await session.isAssignableToMember(
        stringCount,
        component(view, 'FixtureCurrentLitElement'),
        'count'
      ),
      false
    );
  });
});

test('unsaved dependency overlay updates the successor view and retains the old', async () => {
  const session = await createRegistrySession({
    mode: 'consumer',
    configFileName,
  });
  try {
    const first = await session.collect();
    const record = component(first, 'JsOnlyElement');
    const fileName = record.declarationEvidence.fileName;
    const original = await readFile(fileName, 'utf8');
    const edited = original.replace('count = 0', "count = 'x'");
    assert.notEqual(edited, original);

    const second = await session.update([{fileName, text: edited}]);
    assert.ok(second.generation > first.generation);
    assert.equal(second.containsOverlays, true);
    assert.deepEqual(second.overlayFiles, [fileName]);
    assert.equal(
      findProperty(component(second, 'JsOnlyElement'), 'count')?.type?.text,
      'string'
    );
    assert.equal(
      findProperty(component(first, 'JsOnlyElement'), 'count')?.type?.text,
      'number'
    );
    assert.equal(
      component(second, 'JsOnlyElement').declarationEvidence.id,
      record.declarationEvidence.id
    );
  } finally {
    await session.dispose();
  }
});

test('lazy session reports not-collected until enrichment', async () => {
  const session = await createRegistrySession({
    mode: 'consumer',
    configFileName,
    eagerness: 'lazy',
  });
  try {
    const scoped = await session.collectScope([consumerFile]);
    const indexed = scoped.byTagName('md-dialog');
    assert.ok(indexed);
    assert.equal(
      capabilityStatus(indexed, AnalysisCapability.semantics),
      'not-collected'
    );
    const enriched = await session.enrich([indexed.declarationEvidence.id]);
    const dialog = enriched.byTagName('md-dialog');
    assert.ok(dialog);
    assert.equal(
      capabilityStatus(dialog, AnalysisCapability.semantics),
      'complete'
    );
    const query = await session.memberType(
      dialog.declarationEvidence.id,
      'noFocusTrap'
    );
    assert.equal(query?.text, 'boolean');

    const jsIndexed = scoped.byTagName('fixture-js-only');
    assert.ok(jsIndexed);
    const jsEnriched = await session.enrich([jsIndexed.declarationEvidence.id]);
    const jsOnly = jsEnriched.byTagName('fixture-js-only');
    assert.ok(jsOnly);
    assert.ok(
      jsOnly.consumerProvenance?.some(
        (provenance) =>
          provenance.exportName === 'PublicJsOnlyElement' &&
          provenance.package?.name === '@fixture/reexport'
      ),
      'Expected lazy enrichment to retain the renamed re-export provenance'
    );
  } finally {
    await session.dispose();
  }
});

test('disposed registry session rejects further operations', async () => {
  const session = await createRegistrySession({
    mode: 'consumer',
    configFileName,
  });
  await session.collect();
  await session.dispose();
  await assert.rejects(session.collect(), /disposed/i);
});
