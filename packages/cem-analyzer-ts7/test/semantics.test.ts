import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';
import type {ClassField, ClassMethod} from 'custom-elements-manifest';

import {createSemanticCollector} from '../dist/semantics.js';
import {withSemanticTestProgram} from './semantic-test-program.js';

const project = {id: 'semantic-test', currentDirectory: '/virtual'};

test('collects aliased TypeScript class semantics and inherited origins', async () => {
  const fileName = '/virtual/index.ts';
  const source = dedent`
class BaseElement extends HTMLElement {
  /** Inherited label. */
  inherited = 'base';
}
/** A counter component. */
export class CounterElement extends BaseElement {
  /** Current count. */
  count: number = 0;
  get label(): string { return String(this.count); }
  set label(value: string) { this.count = Number(value); }
  /** Update the count. */
  update(value: number, prefix?: string): boolean { return Boolean(prefix) || value > 0; }
  private hidden = true;
}
export {CounterElement as PublicCounter};
const candidate = "bad";
`;
  await withSemanticTestProgram(
    {[fileName]: source},
    async ({program, snapshotId}) => {
      const collector = createSemanticCollector({program, project, snapshotId});
      const components = await collector.collectSourceFile(fileName);
      const component = components.find(
        ({declarationEvidence}) =>
          declarationEvidence.exportName === 'PublicCounter'
      );

      assert.ok(component);
      assert.equal(component.declaration.name, 'CounterElement');
      assert.equal(component.declaration.description, 'A counter component.');
      assert.deepEqual(component.declaration.superclass, {name: 'BaseElement'});
      assert.equal(component.declarationEvidence.fileName, fileName);
      assert.equal(component.declarationEvidence.exportName, 'PublicCounter');
      assert.deepEqual(component.registrations, []);
      assert.equal(component.analysis.registration, 'not-collected');
      assert.equal(component.analysis.semantics, 'complete');

      const count = component.declaration.members?.find(
        (member) => member.name === 'count'
      ) as ClassField | undefined;
      assert.equal(count?.kind, 'field');
      assert.equal(count?.type?.text, 'number');
      assert.equal(count?.description, 'Current count.');

      const inherited = component.declaration.members?.find(
        (member) => member.name === 'inherited'
      ) as ClassField | undefined;
      assert.equal(inherited?.type?.text, 'string');
      assert.deepEqual(inherited?.inheritedFrom, {name: 'BaseElement'});

      const label = component.declaration.members?.find(
        (member) => member.name === 'label'
      ) as ClassField | undefined;
      assert.equal(label?.kind, 'field');
      assert.equal(label?.type?.text, 'string');

      const update = component.declaration.members?.find(
        (member) => member.name === 'update'
      ) as ClassMethod | undefined;
      assert.equal(update?.kind, 'method');
      assert.equal(update?.description, 'Update the count.');
      assert.equal(update?.return?.type?.text, 'boolean');
      assert.deepEqual(
        update?.parameters?.map(({name, type, optional}) => ({
          name,
          type,
          optional,
        })),
        [
          {name: 'value', type: {text: 'number'}, optional: false},
          {name: 'prefix', type: {text: 'string | undefined'}, optional: true},
        ]
      );
      assert.equal(
        component.declaration.members?.some(
          (member) => member.name === 'hidden'
        ),
        false
      );

      const countSemantics = component.members.find(
        ({memberName}) => memberName === 'count'
      );
      const updateSemantics = component.members.find(
        ({memberName}) => memberName === 'update'
      );
      assert.ok(countSemantics?.type);
      assert.ok(updateSemantics?.signature);
      assert.equal(countSemantics.declaration.fileName, fileName);
      assert.ok(
        countSemantics.declaration.range.end >
          countSemantics.declaration.range.start
      );

      const candidateType = await collector.getTypeAtPosition(
        fileName,
        source.indexOf('"bad"') + 1
      );
      assert.ok(candidateType);
      assert.equal(
        await collector.isAssignable(candidateType, countSemantics.type),
        false
      );
      assert.equal(candidateType.projectId, project.id);
      assert.equal(candidateType.snapshotId, snapshotId);
      assert.equal(
        JSON.stringify(component).includes('getTypeOfSymbol'),
        false
      );
    }
  );
});

test('distinguishes implicit any, explicit any, and error types', async () => {
  const fileName = '/virtual/completeness.js';
  await withSemanticTestProgram(
    {
      [fileName]: dedent`
export class CompletenessElement extends HTMLElement {
  implicit;
  /** @type {any} */
  explicit;
  /** @type {MissingType} */
  broken;
  run(value) {}
}
`,
    },
    async ({program, snapshotId}) => {
      const collector = createSemanticCollector({program, project, snapshotId});
      const [component] = await collector.collectSourceFile(fileName);

      assert.equal(component.analysis.semantics, 'incomplete');
      assert.ok(
        component.analysis.issues.some(
          (issue) =>
            issue.code === 'implicit-any-type' &&
            issue.message.includes('implicit')
        )
      );
      assert.ok(
        component.analysis.issues.some(
          (issue) =>
            issue.code === 'implicit-any-type' &&
            issue.message.includes('value')
        )
      );
      assert.ok(
        component.analysis.issues.some(
          (issue) =>
            issue.code === 'semantic-error-type' &&
            issue.message.includes('broken')
        )
      );
      assert.equal(
        component.analysis.issues.some((issue) =>
          issue.message.includes('explicit')
        ),
        false
      );
    }
  );
});

test('accepts an explicit any declaration as complete', async () => {
  const fileName = '/virtual/explicit-any.ts';
  await withSemanticTestProgram(
    {
      [fileName]: dedent`export class ExplicitAnyElement extends HTMLElement {
        value: any;
      }`,
    },
    async ({program, snapshotId}) => {
      const collector = createSemanticCollector({program, project, snapshotId});
      const [component] = await collector.collectSourceFile(fileName);
      assert.equal(component.analysis.semantics, 'complete');
      assert.deepEqual(component.analysis.issues, []);
    }
  );
});

test('collects a direct vanilla HTMLElement subclass', async () => {
  const fileName = '/virtual/vanilla.ts';
  await withSemanticTestProgram(
    {
      [fileName]: dedent`export class VanillaElement extends HTMLElement {
        disabled: boolean = false;
      }`,
    },
    async ({program, snapshotId}) => {
      const collector = createSemanticCollector({program, project, snapshotId});
      const [component] = await collector.collectSourceFile(fileName);

      assert.equal(component.declaration.name, 'VanillaElement');
      assert.deepEqual(component.declaration.superclass, {name: 'HTMLElement'});
      assert.equal(component.declaration.members?.[0].name, 'disabled');
      assert.equal(
        (component.declaration.members?.[0] as ClassField | undefined)?.type
          ?.text,
        'boolean'
      );
    }
  );
});

test('uses raw JavaScript inheritance and JSDoc types when declarations are absent', async () => {
  const fileName = '/virtual/raw.js';
  await withSemanticTestProgram(
    {
      [fileName]: dedent`
class RawBase extends HTMLElement {
  /** @type {string} */
  inherited = 'base';
}
/** Raw component. */
class RawElement extends RawBase {
  /** @type {number} */
  count = 0;
  /**
   * Set the value.
   * @param {string} value
   * @returns {boolean}
   */
  setValue(value) { return value.length > 0; }
}
export {RawElement as PublicRaw};
`,
    },
    async ({program, snapshotId}) => {
      const collector = createSemanticCollector({program, project, snapshotId});
      const [component] = await collector.collectSourceFile(fileName);

      assert.equal(component.declaration.name, 'RawElement');
      assert.equal(component.declarationEvidence.fileName, fileName);
      assert.deepEqual(component.declaration.superclass, {name: 'RawBase'});
      const count = component.declaration.members?.find(
        (member) => member.name === 'count'
      ) as ClassField | undefined;
      const inherited = component.declaration.members?.find(
        (member) => member.name === 'inherited'
      ) as ClassField | undefined;
      const setValue = component.declaration.members?.find(
        (member) => member.name === 'setValue'
      ) as ClassMethod | undefined;
      assert.equal(count?.type?.text, 'number');
      assert.equal(inherited?.type?.text, 'string');
      assert.deepEqual(inherited?.inheritedFrom, {name: 'RawBase'});
      assert.equal(setValue?.parameters?.[0].type?.text, 'string');
      assert.equal(setValue?.return?.type?.text, 'boolean');
      assert.equal(component.analysis.semantics, 'complete');
    }
  );
});
