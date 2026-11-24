import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  AnalysisCapability,
  capabilityStatus,
  createRegistryView,
  findEvent,
  findMember,
  findProperty,
  findSlot,
  memberDeclaration,
  optionalMetadataCoverage,
  resolveAttribute,
  superclassReference,
  type DiscoveryResult,
  type WebComponentRecord,
} from '../dist/index.js';

const project = {id: 'registry-test', currentDirectory: '/virtual'};

function makeRecord(
  overrides: {
    name?: string;
    tagName?: string;
    declarationId?: string;
    fileName?: string;
    registrations?: WebComponentRecord['registrations'];
    members?: WebComponentRecord['members'];
    declaration?: Partial<WebComponentRecord['declaration']>;
    analysis?: Partial<WebComponentRecord['analysis']>;
  } = {}
): WebComponentRecord {
  const name = overrides.name ?? 'TestElement';
  const fileName = overrides.fileName ?? '/virtual/test-element.ts';
  return {
    declaration: {
      kind: 'class',
      name,
      customElement: true,
      ...(overrides.tagName ? {tagName: overrides.tagName} : {}),
      members: [],
      attributes: [],
      events: [],
      slots: [],
      ...overrides.declaration,
    },
    declarationEvidence: {
      id: overrides.declarationId ?? `${fileName}#${name}`,
      fileName,
      range: {start: 0, end: 10},
    },
    project,
    registrations: overrides.registrations ?? [],
    members: overrides.members ?? [],
    analysis: {
      complete: AnalysisCapability.all,
      incomplete: 0,
      issues: [],
      ...overrides.analysis,
    },
  };
}

function makeResult(
  components: WebComponentRecord[],
  overrides: Partial<DiscoveryResult> = {}
): DiscoveryResult {
  return {
    project,
    snapshotId: 'snapshot-1',
    generation: 1,
    components,
    issues: [],
    containsOverlays: false,
    overlayFiles: [],
    ...overrides,
  };
}

test('registry contracts adopt engine records and survive JSON round-trip', () => {
  const vanilla = makeRecord({name: 'VanillaElement', tagName: 'x-vanilla'});
  const lit = makeRecord({name: 'LitElement', tagName: 'x-lit'});
  const result = makeResult([vanilla, lit]);
  const revived = JSON.parse(JSON.stringify(result)) as DiscoveryResult;
  const view = createRegistryView(revived);
  assert.equal(view.byTagName('x-vanilla')?.declaration.name, 'VanillaElement');
  assert.equal(view.byTagName('x-lit')?.declaration.name, 'LitElement');
  assert.deepEqual(view.components(), revived.components);
});

test('view exposes snapshot identity and overlay provenance', () => {
  const view = createRegistryView(
    makeResult([makeRecord()], {
      snapshotId: 'snapshot-9',
      generation: 4,
      containsOverlays: true,
      overlayFiles: ['/virtual/edited.ts'],
      issues: [{code: 'unresolved-module', message: 'missing'}],
    })
  );
  assert.equal(view.project.id, project.id);
  assert.equal(view.snapshotId, 'snapshot-9');
  assert.equal(view.generation, 4);
  assert.equal(view.containsOverlays, true);
  assert.deepEqual(view.overlayFiles, ['/virtual/edited.ts']);
  assert.equal(view.issues.length, 1);
});

test('view forwards the optional module-resolution fallback count', () => {
  const instrumented = createRegistryView(
    makeResult([], {moduleResolutionFallbackCount: 3})
  );
  const uninstrumented = createRegistryView(makeResult([]));

  assert.equal(instrumented.moduleResolutionFallbackCount, 3);
  assert.equal('moduleResolutionFallbackCount' in uninstrumented, false);
});

test('resolves components by registered tag and declaration identity with explicit misses', () => {
  const record = makeRecord({
    name: 'RegisteredElement',
    registrations: [
      {
        tagName: 'x-registered',
        fileName: '/virtual/register.ts',
        range: {start: 0, end: 5},
        scope: 'global',
        strategy: 'vanilla',
      },
    ],
  });
  const view = createRegistryView(makeResult([record]));
  assert.equal(view.byTagName('x-registered'), record);
  assert.equal(view.byDeclarationId(record.declarationEvidence.id), record);
  assert.equal(view.byTagName('x-missing'), undefined);
  assert.equal(view.byDeclarationId('missing#Id'), undefined);
});

test('resolves attribute aliases to their property', () => {
  const record = makeRecord({
    declaration: {
      members: [{kind: 'field', name: 'noFocusTrap', type: {text: 'boolean'}}],
      attributes: [{name: 'no-focus-trap', fieldName: 'noFocusTrap'}],
    },
  });
  const resolution = resolveAttribute(record, 'no-focus-trap');
  assert.equal(resolution?.attribute.name, 'no-focus-trap');
  assert.equal(resolution?.property?.name, 'noFocusTrap');
  assert.equal(findProperty(record, 'noFocusTrap')?.type?.text, 'boolean');
  assert.equal(findMember(record, 'noFocusTrap')?.kind, 'field');
  assert.equal(resolveAttribute(record, 'missing'), undefined);
});

test('exposes documented events and slots and inheritance references', () => {
  const record = makeRecord({
    declaration: {
      events: [{name: 'open', type: {text: 'Event'}}],
      slots: [{name: 'header', description: 'Header.'}],
      superclass: {name: 'Dialog', package: 'dep', module: '/dep/dialog.d.ts'},
    },
    members: [
      {
        memberName: 'inherited',
        declaration: {
          id: '/dep/dialog.d.ts#Dialog.inherited',
          fileName: '/dep/dialog.d.ts',
          range: {start: 1, end: 2},
        },
      },
    ],
  });
  assert.equal(findEvent(record, 'open')?.name, 'open');
  assert.equal(findEvent(record, 'missing'), undefined);
  assert.equal(findSlot(record, 'header')?.description, 'Header.');
  assert.deepEqual(superclassReference(record), {
    name: 'Dialog',
    package: 'dep',
    module: '/dep/dialog.d.ts',
  });
  assert.equal(
    memberDeclaration(record, 'inherited')?.fileName,
    '/dep/dialog.d.ts'
  );
});

test('surfaces per-capability completeness including not-collected', () => {
  const complete = makeRecord();
  const incomplete = makeRecord({
    analysis: {
      complete: 0,
      incomplete: AnalysisCapability.semantics,
      issues: [{code: 'semantic-error-type', message: 'unresolved'}],
    },
  });
  const notCollected = makeRecord({analysis: {complete: 0, incomplete: 0}});
  assert.equal(
    capabilityStatus(complete, AnalysisCapability.semantics),
    'complete'
  );
  assert.equal(
    capabilityStatus(incomplete, AnalysisCapability.semantics),
    'incomplete'
  );
  assert.equal(
    capabilityStatus(notCollected, AnalysisCapability.semantics),
    'not-collected'
  );
});

test('empty optional metadata is undocumented, never confirmed absence', () => {
  const undocumented = makeRecord();
  const documented = makeRecord({
    declaration: {slots: [{name: '', description: 'Default.'}]},
  });
  const notCollected = makeRecord({analysis: {complete: 0, incomplete: 0}});
  assert.equal(
    optionalMetadataCoverage(undocumented, AnalysisCapability.slots),
    'undocumented'
  );
  assert.equal(
    optionalMetadataCoverage(documented, AnalysisCapability.slots),
    'documented'
  );
  assert.equal(
    optionalMetadataCoverage(notCollected, AnalysisCapability.slots),
    'not-collected'
  );
});

test('successor view replaces data while unaffected records are structurally reused', () => {
  const unaffected = makeRecord({name: 'Unaffected', tagName: 'x-unaffected'});
  const affected = makeRecord({name: 'Affected', tagName: 'x-affected'});
  const first = createRegistryView(makeResult([unaffected, affected]));

  const updatedAffected = makeRecord({
    name: 'Affected',
    tagName: 'x-affected',
    declaration: {
      members: [{kind: 'field', name: 'count', type: {text: 'string'}}],
    },
  });
  const successor = createRegistryView(
    makeResult([unaffected, updatedAffected], {
      snapshotId: 'snapshot-2',
      generation: 2,
    })
  );

  assert.equal(successor.snapshotId, 'snapshot-2');
  assert.equal(successor.byTagName('x-unaffected'), unaffected);
  assert.equal(first.byTagName('x-unaffected'), unaffected);
  assert.equal(
    findProperty(successor.byTagName('x-affected')!, 'count')?.type?.text,
    'string'
  );
  assert.equal(first.byTagName('x-affected'), affected);
});
