import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';
import type {Checker, Program} from 'typescript/async';
import {
  isClassDeclaration,
  isExpressionStatement,
  isGetAccessorDeclaration,
  isPropertyDeclaration,
  type ClassDeclaration,
  type ExpressionStatement,
  type GetAccessorDeclaration,
  type Node,
  type PropertyDeclaration,
  type SourceFile,
} from 'typescript/ast';
import {API} from 'typescript/async';
import {createFileSystemWithLib} from 'typescript/fs';

import {
  collectClassDocumentation,
  collectMemberDocumentation,
} from '../dist/discovery/jsdoc.js';

interface TestProject {
  program: Program;
  checker: Checker;
  sourceFile: SourceFile;
}

async function withProject(
  source: string,
  run: (project: TestProject) => Promise<void>
): Promise<void> {
  const api = new API();
  try {
    const snapshot = await api.createSnapshot({
      fileSystem: createFileSystemWithLib([
        [
          '/virtual/tsconfig.json',
          JSON.stringify({
            compilerOptions: {
              target: 'esnext',
              module: 'nodenext',
              moduleResolution: 'nodenext',
              strict: true,
            },
            files: ['index.ts'],
          }),
        ],
        ['/virtual/index.ts', source],
      ]),
      openProjects: ['/virtual/tsconfig.json'],
      ensurePrograms: true,
    });
    const project = snapshot.getConfiguredProject('/virtual/tsconfig.json');
    assert.ok(project);
    const sourceFile = await project.program.getSourceFile('/virtual/index.ts');
    assert.ok(sourceFile);
    await run({program: project.program, checker: project.checker, sourceFile});
  } finally {
    await api.close();
  }
}

function findNode<T extends Node>(
  sourceFile: SourceFile,
  predicate: (node: Node) => node is T,
  text?: string
): T {
  function visit(node: Node): T | undefined {
    if (
      predicate(node) &&
      (text === undefined || node.getText(sourceFile).includes(text))
    ) {
      return node;
    }
    return node.forEachChild(visit);
  }
  const result = visit(sourceFile);
  assert.ok(result);
  return result;
}

test('collects the complete component JSDoc metadata surface and aliases', async () => {
  await withProject(
    dedent`/**
 * A documented element.
 * @summary Compact summary.
 * @tag x-documented
 * @slot - Default content.
 * @slot header - Header content.
 * @part label - Label part.
 * @csspart icon - Icon part.
 * @cssprop [--text-color=red] - Text color.
 * @cssproperty {<length>} [--size=1px] - Size.
 * @cssState checked - Checked state.
 * @fires {CustomEvent<string>} change - Change event.
 * @event {Event} close - Close event.
 * @property {boolean} [active=false] - Active property.
 */
class DocumentedElement extends HTMLElement {}
`,
    async ({sourceFile}) => {
      const declaration = findNode(sourceFile, isClassDeclaration);
      const documentation = collectClassDocumentation(declaration);
      assert.equal(documentation.description, 'A documented element.');
      assert.equal(documentation.summary, 'Compact summary.');
      assert.equal(documentation.tagName, 'x-documented');
      assert.deepEqual(documentation.slots, [
        {name: '', description: 'Default content.'},
        {name: 'header', description: 'Header content.'},
      ]);
      assert.deepEqual(documentation.cssParts, [
        {name: 'label', description: 'Label part.'},
        {name: 'icon', description: 'Icon part.'},
      ]);
      assert.deepEqual(documentation.cssProperties, [
        {name: '--text-color', default: 'red', description: 'Text color.'},
        {
          name: '--size',
          syntax: '<length>',
          default: '1px',
          description: 'Size.',
        },
      ]);
      assert.deepEqual(documentation.cssStates, [
        {name: 'checked', description: 'Checked state.'},
      ]);
      assert.deepEqual(documentation.events, [
        {
          name: 'change',
          type: {text: 'CustomEvent<string>'},
          description: 'Change event.',
        },
        {name: 'close', type: {text: 'Event'}, description: 'Close event.'},
      ]);
      assert.deepEqual(documentation.members, [
        {
          kind: 'field',
          name: 'active',
          type: {text: 'boolean'},
          default: 'false',
          description: 'Active property.',
        },
      ]);
      assert.ok(
        documentation.evidence.every(
          (item) => item.range.end > item.range.start
        )
      );
    }
  );
});

test('collects member aliases, defaults, reflection, visibility, and constructor assignments', async () => {
  await withProject(
    dedent`class MemberElement extends HTMLElement {
  /**
   * @attribute {string} label-text - Label attribute.
   * @property {string} labelText - Label property.
   * @default hello
   * @reflect
   */
  get labelText(): string { return ''; }
  set labelText(value: string) {}

  constructor() {
    super();
    /**
     * @attr {number} count - Count attribute.
     * @prop {number} count - Count property.
     * @default 1
     */
    this.count = 0;
  }

  /** @attribute */
  disabled = false;
  /** @default 42 */
  answer = 42;

  /** @ignore */
  hidden = true;
  /** @internal */
  internal = true;
}
`,
    async ({sourceFile}) => {
      const accessor = findNode<GetAccessorDeclaration>(
        sourceFile,
        isGetAccessorDeclaration,
        'labelText'
      );
      const accessorDocs = collectMemberDocumentation(accessor);
      assert.deepEqual(accessorDocs.attributes, [
        {
          name: 'label-text',
          fieldName: 'labelText',
          type: {text: 'string'},
          default: 'hello',
          description: 'Label attribute.',
        },
      ]);
      assert.deepEqual(accessorDocs.member, {
        kind: 'field',
        name: 'labelText',
        type: {text: 'string'},
        default: 'hello',
        reflects: true,
        attribute: 'label-text',
        description: 'Label property.',
      });

      const assignment = findNode<ExpressionStatement>(
        sourceFile,
        isExpressionStatement,
        'this.count'
      );
      const assignmentDocs = collectMemberDocumentation(assignment);
      assert.equal(assignmentDocs.memberName, 'count');
      assert.equal(assignmentDocs.member?.type?.text, 'number');
      assert.equal(assignmentDocs.member?.default, '1');
      assert.equal(assignmentDocs.attributes[0].name, 'count');

      const bareAttribute = findNode<PropertyDeclaration>(
        sourceFile,
        isPropertyDeclaration,
        'disabled'
      );
      const bareAttributeDocs = collectMemberDocumentation(bareAttribute);
      assert.deepEqual(bareAttributeDocs.attributes, [
        {name: 'disabled', fieldName: 'disabled'},
      ]);
      assert.equal(bareAttributeDocs.member?.attribute, 'disabled');

      const defaultOnly = findNode<PropertyDeclaration>(
        sourceFile,
        isPropertyDeclaration,
        'answer'
      );
      assert.deepEqual(collectMemberDocumentation(defaultOnly).member, {
        kind: 'field',
        name: 'answer',
        default: '42',
      });

      for (const name of ['hidden', 'internal']) {
        const property = findNode<PropertyDeclaration>(
          sourceFile,
          isPropertyDeclaration,
          name
        );
        const documentation = collectMemberDocumentation(property);
        assert.equal(documentation.ignored, true);
        assert.equal(documentation.member, undefined);
      }
    }
  );
});

test('supports legacy Lit member placement and adjacent inline event type documentation', async () => {
  await withProject(
    dedent`import {LitElement} from 'lit-element';
/** @tagname x-legacy */
export class LegacyElement extends LitElement {
  /** @attr {boolean} active - Active attribute. */
  get active(): boolean { return true; }

  fire() {
    /** @type {FooEvent} foo-event - Foo happened. */
    this.dispatchEvent(new CustomEvent('foo-event'));
  }

  render() { return '<slot name="not-extracted"></slot>'; }
}
export const notAComponent = 1;
`,
    async ({sourceFile}) => {
      const declaration = findNode<ClassDeclaration>(
        sourceFile,
        isClassDeclaration,
        'LegacyElement'
      );
      const documentation = collectClassDocumentation(declaration);
      assert.equal(documentation.tagName, 'x-legacy');
      assert.deepEqual(documentation.events, [
        {
          name: 'foo-event',
          type: {text: 'FooEvent'},
          description: 'Foo happened.',
        },
      ]);
      assert.deepEqual(documentation.slots, []);
      assert.equal(documentation.evidence.at(-1)?.kind, 'inline-event');
    }
  );
});
