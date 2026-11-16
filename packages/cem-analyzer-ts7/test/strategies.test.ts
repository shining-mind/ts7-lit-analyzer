import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';
import type {Checker, Program} from 'typescript/async';
import type {SourceFile} from 'typescript/ast';
import {API} from 'typescript/async';
import {createFileSystemWithLib} from 'typescript/fs';

import {collectFrameworkMetadata} from '../dist/strategies/index.js';

interface TestProject {
  program: Program;
  checker: Checker;
  sourceFile: SourceFile;
}

const litPackage = [
  '/virtual/node_modules/lit/package.json',
  JSON.stringify({
    name: 'lit',
    type: 'module',
    exports: {'.': './index.d.ts', './decorators': './decorators.d.ts'},
  }),
] as const;

const litDeclarations = [
  '/virtual/node_modules/lit/index.d.ts',
  'export declare class LitElement extends HTMLElement {}',
] as const;

const decoratorDeclarations = [
  '/virtual/node_modules/lit/decorators.d.ts',
  `export declare function customElement(tagName: string): any;
export declare function property(options?: {attribute?: string | boolean; reflect?: boolean}): any;
export declare function state(): any;`,
] as const;

async function withProject(
  files: Readonly<Record<string, string>>,
  run: (project: TestProject) => Promise<void>
): Promise<void> {
  const api = new API();
  try {
    const entries = Object.entries({
      '/virtual/tsconfig.json': JSON.stringify({
        compilerOptions: {
          target: 'esnext',
          module: 'nodenext',
          moduleResolution: 'nodenext',
          experimentalDecorators: true,
          strict: true,
        },
        files: Object.keys(files).filter(
          (fileName) => !fileName.includes('node_modules')
        ),
      }),
      ...files,
    });
    const snapshot = await api.createSnapshot({
      fileSystem: createFileSystemWithLib(entries),
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

test('composes global, custom-registry, tag-map, and observed-attribute evidence', async () => {
  await withProject(
    {
      '/virtual/index.ts': dedent`export class VanillaElement extends HTMLElement {
  static get observedAttributes() { return ['count', 'label-text']; }
  get count(): number { return 1; }
  set count(value: number) {}
  get labelText(): string { return ''; }
  set labelText(value: string) {}
}
const registry = new CustomElementRegistry();
registry.define('x-custom', VanillaElement);
customElements.define('x-global', VanillaElement);
const alias = registry;
alias.define('x-not-direct', VanillaElement);
declare global {
  interface HTMLElementTagNameMap { 'x-mapped': VanillaElement; }
}`,
    },
    async ({program, checker, sourceFile}) => {
      const fragments = await collectFrameworkMetadata({
        program,
        checker,
        sourceFiles: [sourceFile],
      });
      const fragment = fragments.find((item) =>
        item.declaration.id.endsWith('#VanillaElement')
      );
      assert.ok(fragment);
      assert.deepEqual(
        fragment.registrations.map((registration) => [
          registration.tagName,
          registration.scope,
        ]),
        [
          ['x-custom', 'custom'],
          ['x-global', 'global'],
          ['x-mapped', 'global'],
        ]
      );
      assert.match(
        fragment.registrations[0].registryDeclarationId ?? '',
        /registry$/
      );
      assert.deepEqual(fragment.frameworks, ['vanilla']);
      assert.deepEqual(fragment.attributes, [
        {name: 'count', fieldName: 'count'},
        {name: 'label-text', fieldName: 'labelText'},
      ]);
      const registrationText = sourceFile.text.slice(
        fragment.registrations[0].range.start,
        fragment.registrations[0].range.end
      );
      assert.equal(
        registrationText,
        "registry.define('x-custom', VanillaElement)"
      );
    }
  );
});

test('recognizes current Lit decorators and static properties through resolved class identity', async () => {
  await withProject(
    {
      '/virtual/index.ts': dedent`import {LitElement} from 'lit';
import {customElement, property, state} from 'lit/decorators';
@customElement('x-lit')
export class CurrentLit extends LitElement {
  @property({attribute: 'user-name', reflect: true}) userName: string = '';
  @state() internal: boolean = false;
  static properties = {
    count: {attribute: 'count-alias'},
    hidden: {attribute: false},
  };
}
class NotLit {
  static properties = {other: {attribute: 'other-name'}};
}`,
      [litPackage[0]]: litPackage[1],
      [litDeclarations[0]]: litDeclarations[1],
      [decoratorDeclarations[0]]: decoratorDeclarations[1],
    },
    async ({program, checker, sourceFile}) => {
      const fragments = await collectFrameworkMetadata({
        program,
        checker,
        sourceFiles: [sourceFile],
      });
      const fragment = fragments.find((item) =>
        item.declaration.id.endsWith('#CurrentLit')
      );
      assert.ok(fragment);
      assert.deepEqual(fragment.frameworks, ['vanilla', 'lit']);
      assert.deepEqual(
        fragment.registrations.map((registration) => registration.tagName),
        ['x-lit']
      );
      assert.deepEqual(
        fragment.registrations.map((registration) => registration.strategy),
        ['lit']
      );
      assert.deepEqual(fragment.attributes, [
        {name: 'user-name', fieldName: 'userName'},
        {name: 'count-alias', fieldName: 'count'},
      ]);
      assert.deepEqual(fragment.members, [
        {
          kind: 'field',
          name: 'userName',
          attribute: 'user-name',
          reflects: true,
        },
        {kind: 'field', name: 'internal'},
        {kind: 'field', name: 'count', attribute: 'count-alias'},
        {kind: 'field', name: 'hidden'},
      ]);
      assert.equal(
        fragments.some((item) => item.declaration.id.endsWith('#NotLit')),
        false
      );
      const decoratorEvidence = fragment.evidence.find(
        (item) => item.kind === 'custom-element-decorator'
      );
      assert.ok(decoratorEvidence);
      assert.equal(
        sourceFile.text.slice(
          decoratorEvidence.range.start,
          decoratorEvidence.range.end
        ),
        "@customElement('x-lit')"
      );
    }
  );
});

test('supports static getter properties with super spread', async () => {
  await withProject(
    {
      '/virtual/index.ts': dedent`
        import {LitElement} from 'lit';
        export class GetterElement extends LitElement {
          static get properties() {
            return {
              ...super.properties,
              value: {attribute: 'value-alias', reflect: true},
              hidden: {attribute: false},
            };
          }
          value = '';
          hidden = true;
        }
      `,
      [litPackage[0]]: litPackage[1],
      [litDeclarations[0]]: litDeclarations[1],
    },
    async ({program, checker, sourceFile}) => {
      const fragments = await collectFrameworkMetadata({
        program,
        checker,
        sourceFiles: [sourceFile],
      });
      const fragment = fragments.find((item) =>
        item.declaration.id.endsWith('#GetterElement')
      );
      assert.ok(fragment);
      assert.deepEqual(fragment.attributes, [
        {name: 'value-alias', fieldName: 'value'},
      ]);
      assert.deepEqual(fragment.members, [
        {
          kind: 'field',
          name: 'value',
          attribute: 'value-alias',
          reflects: true,
        },
        {kind: 'field', name: 'hidden'},
      ]);
      assert.deepEqual(fragment.issues, []);
    }
  );
});

test('rejects a shadowed DOM base name and recognizes generic mixin metadata', async () => {
  await withProject(
    {
      '/virtual/index.ts': dedent`
        import {LitElement} from 'lit';
        import {property} from 'lit/decorators';
        class HTMLElement {}
        export class FakeElement extends HTMLElement {}
        customElements.define('x-fake', FakeElement);

        type Constructor<T> = new (...args: any[]) => T;
        function ReactiveMixin<T extends Constructor<globalThis.HTMLElement>>(Base: T) {
          return class extends Base {
            @property({attribute: 'disabled-state'}) disabled = false;
          };
        }
        export class MixedElement extends ReactiveMixin(LitElement) {}
        customElements.define('x-mixed', MixedElement);
      `,
      [litPackage[0]]: litPackage[1],
      [litDeclarations[0]]: litDeclarations[1],
      [decoratorDeclarations[0]]: decoratorDeclarations[1],
    },
    async ({program, checker, sourceFile}) => {
      const fragments = await collectFrameworkMetadata({
        program,
        checker,
        sourceFiles: [sourceFile],
      });
      assert.equal(
        fragments.some((item) => item.declaration.id.endsWith('#FakeElement')),
        false
      );
      const mixin = fragments.find(
        (item) =>
          item.declaration.id.endsWith('#default') &&
          item.members.some((member) => member.name === 'disabled')
      );
      assert.ok(mixin);
      assert.deepEqual(mixin.attributes, [
        {name: 'disabled-state', fieldName: 'disabled'},
      ]);
      const mixed = fragments.find((item) =>
        item.declaration.id.endsWith('#MixedElement')
      );
      assert.ok(mixed);
      assert.deepEqual(mixed.frameworks, ['vanilla', 'lit']);
    }
  );
});

test('supports legacy Lit and compiled decorator forms', async () => {
  await withProject(
    {
      '/virtual/index.ts': dedent`import {LitElement} from 'lit-element';
import {customElement, property} from 'lit-element/decorators.js';
declare function __decorate(...args: any[]): any;
export class LegacyLit extends LitElement { value = ''; }
__decorate([property({attribute: 'value-alias'})], LegacyLit.prototype, 'value', void 0);
__decorate([customElement('x-legacy')], LegacyLit);`,
      '/virtual/node_modules/lit-element/package.json': JSON.stringify({
        name: 'lit-element',
        type: 'module',
        exports: {'.': './index.d.ts', './decorators.js': './decorators.d.ts'},
      }),
      '/virtual/node_modules/lit-element/index.d.ts':
        'export declare class LitElement extends HTMLElement {}',
      '/virtual/node_modules/lit-element/decorators.d.ts': dedent`export declare function customElement(tagName: string): any;
export declare function property(options?: {attribute?: string | boolean; reflect?: boolean}): any;`,
    },
    async ({program, checker, sourceFile}) => {
      const fragments = await collectFrameworkMetadata({
        program,
        checker,
        sourceFiles: [sourceFile],
      });
      const fragment = fragments.find((item) =>
        item.declaration.id.endsWith('#LegacyLit')
      );
      assert.ok(fragment);
      assert.deepEqual(fragment.frameworks, ['vanilla', 'lit']);
      assert.deepEqual(
        fragment.registrations.map((registration) => registration.tagName),
        ['x-legacy']
      );
      assert.deepEqual(fragment.members, [
        {kind: 'field', name: 'value', attribute: 'value-alias'},
      ]);
      assert.deepEqual(fragment.attributes, [
        {name: 'value-alias', fieldName: 'value'},
      ]);
      assert.ok(
        fragment.evidence.some((item) => item.kind === 'compiled-decorator')
      );
    }
  );
});
