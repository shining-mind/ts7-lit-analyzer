import assert from 'node:assert/strict';
import {test} from 'node:test';

import type {CustomElementDeclaration} from 'custom-elements-manifest';

import {
  AnalysisCapability,
  cemAnalyzerTs7PackageVersion,
  type DiscoveryResult,
  type WebComponentRecord,
} from '@ts7-lit-analyzer/cem-analyzer-ts7';

const declaration: CustomElementDeclaration = {
  kind: 'class',
  name: 'MyElement',
  customElement: true,
  tagName: 'my-element',
  members: [
    {
      kind: 'field',
      name: 'count',
      type: {text: 'number'},
    },
  ],
  attributes: [{name: 'count', fieldName: 'count'}],
  events: [{name: 'count-changed', type: {text: 'CustomEvent'}}],
  slots: [{name: ''}, {name: 'content'}],
  cssParts: [{name: 'label'}],
  cssProperties: [{name: '--text-color', syntax: '<color>', default: 'black'}],
  cssStates: [{name: 'checked'}],
};

const component: WebComponentRecord = {
  declaration,
  declarationEvidence: {
    id: '/virtual/my-element.ts#MyElement',
    fileName: '/virtual/my-element.ts',
    range: {start: 0, end: 100},
    exportName: 'MyElement',
  },
  project: {id: 'project-1', currentDirectory: '/virtual'},
  registrations: [
    {
      tagName: 'my-element',
      fileName: '/virtual/my-element.ts',
      range: {start: 101, end: 140},
      scope: 'global',
      strategy: 'vanilla',
    },
  ],
  members: [
    {
      memberName: 'count',
      declaration: {
        id: '/virtual/my-element.ts#MyElement.count',
        fileName: '/virtual/my-element.ts',
        range: {start: 20, end: 40},
      },
      type: {id: 'type-1', projectId: 'project-1', snapshotId: 'snapshot-1'},
    },
  ],
  analysis: {
    complete: AnalysisCapability.all,
    incomplete: 0,
    issues: [],
  },
};

test('exports CEM-composed records with separate semantic evidence', () => {
  const result: DiscoveryResult = {
    project: component.project,
    snapshotId: 'snapshot-1',
    generation: 1,
    components: [component],
    issues: [],
    containsOverlays: false,
    overlayFiles: [],
  };

  assert.equal(cemAnalyzerTs7PackageVersion, '0.0.0');
  assert.equal(result.components[0].declaration, declaration);
  assert.equal(result.components[0].declaration.members?.[0].name, 'count');
  assert.notEqual(
    result.components[0].members[0].type,
    result.components[0].declaration.members?.[0]
  );
  assert.deepEqual(result.components[0].declaration.cssProperties, [
    {name: '--text-color', syntax: '<color>', default: 'black'},
  ]);
});

test('encodes capability completeness as mutually exclusive bit masks', () => {
  const analysis: WebComponentRecord['analysis'] = {
    complete: AnalysisCapability.semantics,
    incomplete: AnalysisCapability.attributes,
    issues: [],
  };

  assert.equal(
    analysis.complete & AnalysisCapability.semantics,
    AnalysisCapability.semantics
  );
  assert.equal(
    analysis.incomplete & AnalysisCapability.attributes,
    AnalysisCapability.attributes
  );
  assert.equal(analysis.complete & AnalysisCapability.attributes, 0);
  assert.equal(analysis.complete & AnalysisCapability.registration, 0);
  assert.equal(analysis.incomplete & AnalysisCapability.registration, 0);
});

test('represents filesystem and overlay provenance without overlay content', () => {
  const filesystemResult: DiscoveryResult = {
    project: component.project,
    snapshotId: 'snapshot-1',
    generation: 1,
    components: [],
    issues: [],
    containsOverlays: false,
    overlayFiles: [],
  };
  const overlayResult: DiscoveryResult = {
    ...filesystemResult,
    snapshotId: 'snapshot-2',
    containsOverlays: true,
    overlayFiles: ['/virtual/my-element.ts'],
  };

  assert.equal(filesystemResult.containsOverlays, false);
  assert.equal(overlayResult.containsOverlays, true);
  assert.deepEqual(overlayResult.overlayFiles, ['/virtual/my-element.ts']);
  assert.equal(JSON.stringify(overlayResult).includes('count = 1'), false);
});
