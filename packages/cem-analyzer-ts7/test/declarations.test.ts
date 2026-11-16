import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';
import type {ClassField} from 'custom-elements-manifest';

import {AnalysisCapability} from '../dist/contracts.js';
import {createSemanticCollector} from '../dist/semantics.js';
import {withSemanticTestProgram} from './semantic-test-program.js';

const project = {id: 'declaration-test', currentDirectory: '/virtual'};

test('collects declaration-only package exports without implementation files', async () => {
  const consumer = '/virtual/index.ts';
  await withSemanticTestProgram(
    {
      '/virtual/node_modules/decl-only/package.json': JSON.stringify({
        name: 'decl-only',
        type: 'module',
        types: './index.d.ts',
      }),
      '/virtual/node_modules/decl-only/index.d.ts': dedent`
        export declare class DeclaredElement extends HTMLElement {
          value: number;
          run(input: string): void;
        }
      `,
      [consumer]: dedent`
        import {DeclaredElement} from 'decl-only';
        export {DeclaredElement as PublicElement};
      `,
    },
    async ({program, snapshotId}) => {
      const collector = createSemanticCollector({program, project, snapshotId});
      const [component] = await collector.collectSourceFile(consumer);

      assert.equal(component.declaration.name, 'DeclaredElement');
      assert.equal(component.declarationEvidence.exportName, 'PublicElement');
      assert.match(
        component.declarationEvidence.fileName,
        /decl-only\/index\.d\.ts$/
      );
      assert.equal(
        (component.declaration.members?.[0] as ClassField | undefined)?.type
          ?.text,
        'number'
      );
      assert.equal(
        component.analysis.complete & AnalysisCapability.semantics,
        AnalysisCapability.semantics
      );
      assert.deepEqual(component.analysis.issues, []);
    }
  );
});

test('uses declarations as sole authority for dual declaration and JavaScript packages', async () => {
  const consumer = '/virtual/index.ts';
  await withSemanticTestProgram(
    {
      '/virtual/node_modules/dual/package.json': JSON.stringify({
        name: 'dual',
        type: 'module',
        types: './index.d.ts',
        exports: './index.js',
      }),
      '/virtual/node_modules/dual/index.d.ts': dedent`
        export declare class DualElement extends HTMLElement {
          value: number;
          declarationOnly: boolean;
        }
      `,
      '/virtual/node_modules/dual/index.js': dedent`
        class DualElement extends HTMLElement {
          constructor() {
            super();
            this.value = 'implementation';
            this.implementationOnly = 'not public';
          }
        }
        export class ImplementationOnlyElement extends HTMLElement {}
      `,
      [consumer]: dedent`
        import {DualElement} from 'dual';
        export {DualElement as PublicElement};
      `,
    },
    async ({program, snapshotId}) => {
      const collector = createSemanticCollector({program, project, snapshotId});
      const components = await collector.collectSourceFile(consumer);

      assert.equal(components.length, 1);
      const [component] = components;
      assert.equal(component.declaration.name, 'DualElement');
      assert.match(
        component.declarationEvidence.fileName,
        /dual\/index\.d\.ts$/
      );
      assert.deepEqual(
        (component.declaration.members as ClassField[]).map(({name, type}) => ({
          name,
          type,
        })),
        [
          {name: 'value', type: {text: 'number'}},
          {name: 'declarationOnly', type: {text: 'boolean'}},
        ]
      );
      assert.equal(
        component.declaration.members?.some(
          ({name}) => name === 'implementationOnly'
        ),
        false
      );
      assert.equal(
        component.analysis.complete & AnalysisCapability.semantics,
        AnalysisCapability.semantics
      );
      assert.deepEqual(component.analysis.issues, []);
      assert.deepEqual(component.registrations, []);
    }
  );
});
