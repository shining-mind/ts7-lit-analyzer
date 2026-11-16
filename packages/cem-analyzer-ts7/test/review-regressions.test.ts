import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';
import type {CustomElementField} from 'custom-elements-manifest';

import {
  createDiscoverySession,
  type DiscoveryResult,
  type DiscoverySession,
} from '../dist/index.js';

const litFiles = {
  '/virtual/node_modules/lit/package.json': JSON.stringify({
    name: 'lit',
    type: 'module',
    exports: {
      '.': './index.d.ts',
      './decorators.js': './decorators.d.ts',
    },
  }),
  '/virtual/node_modules/lit/index.d.ts':
    'export declare class LitElement extends HTMLElement {}',
  '/virtual/node_modules/lit/decorators.d.ts': dedent`
    export declare function property(options?: {
      attribute?: string | boolean;
      reflect?: boolean;
    }): any;
  `,
};

async function withSession(
  files: Readonly<Record<string, string>>,
  run: (session: DiscoverySession, result: DiscoveryResult) => Promise<void>,
  rootFile = '/virtual/index.ts'
): Promise<void> {
  const session = await createDiscoverySession({
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: [rootFile],
    files: Object.entries(files).map(([fileName, text]) => ({fileName, text})),
  });
  try {
    await run(session, await session.collect());
  } finally {
    await session.dispose();
  }
}

function component(result: DiscoveryResult, name: string) {
  const found = result.components.find(
    (candidate) => candidate.declaration.name === name
  );
  assert.ok(found, `Expected component ${name}`);
  return found;
}

function field(result: DiscoveryResult, componentName: string, name: string) {
  const member = component(result, componentName).declaration.members?.find(
    (candidate) => candidate.name === name && candidate.kind === 'field'
  ) as CustomElementField | undefined;
  assert.ok(member, `Expected field ${componentName}.${name}`);
  return member;
}

test('supports static getter properties and omits framework base classes', async () => {
  await withSession(
    {
      ...litFiles,
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
        customElements.define('x-getter', GetterElement);
      `,
    },
    async (_session, result) => {
      assert.deepEqual(
        result.components.map((candidate) => candidate.declaration.name),
        ['GetterElement']
      );
      assert.deepEqual(
        component(result, 'GetterElement').declaration.attributes,
        [{name: 'value-alias', fieldName: 'value'}]
      );
      assert.equal(field(result, 'GetterElement', 'value').reflects, true);
      assert.equal(
        field(result, 'GetterElement', 'hidden').attribute,
        undefined
      );
    }
  );
});

test('does not treat a user-defined HTMLElement shadow as the DOM base class', async () => {
  await withSession(
    {
      '/virtual/index.ts': dedent`
        class HTMLElement {}
        export class FakeElement extends HTMLElement {}
        customElements.define('x-fake', FakeElement);
      `,
    },
    async (_session, result) => {
      assert.deepEqual(result.components, []);
    }
  );
});

test('merges the documented CEM surface through the public session', async () => {
  await withSession(
    {
      '/virtual/index.ts': dedent`
        /**
         * A documented component.
         * @prop {boolean} documented - Documentation-only property.
         * @slot - Default content.
         * @slot header - Header content.
         * @csspart label - Label part.
         * @cssproperty [--text-color=red] - Text color.
         * @cssState checked - Checked state.
         * @fires {Event} close - Close event.
         * @summary Compact summary.
         */
        export class DocumentedElement extends HTMLElement {
          /**
           * @attr
           * @reflect
           * @default hello
           */
          value: string = 'hello';

          /** @internal */
          hidden = true;

          fire() {
            /** @type {CustomEvent<string>} detail-change - Detail changed. */
            this.dispatchEvent(new CustomEvent('runtime-name'));
          }
        }
        customElements.define('x-documented', DocumentedElement);
      `,
    },
    async (_session, result) => {
      const declaration = component(result, 'DocumentedElement').declaration;
      assert.equal(declaration.summary, 'Compact summary.');
      assert.deepEqual(declaration.slots, [
        {name: '', description: 'Default content.'},
        {name: 'header', description: 'Header content.'},
      ]);
      assert.deepEqual(declaration.cssParts, [
        {name: 'label', description: 'Label part.'},
      ]);
      assert.deepEqual(declaration.cssProperties, [
        {
          name: '--text-color',
          default: 'red',
          description: 'Text color.',
        },
      ]);
      assert.deepEqual(declaration.cssStates, [
        {name: 'checked', description: 'Checked state.'},
      ]);
      assert.deepEqual(declaration.events, [
        {name: 'close', type: {text: 'Event'}, description: 'Close event.'},
        {
          name: 'detail-change',
          type: {text: 'CustomEvent<string>'},
          description: 'Detail changed.',
        },
      ]);
      assert.equal(
        field(result, 'DocumentedElement', 'documented').type?.text,
        'boolean'
      );
      const value = field(result, 'DocumentedElement', 'value');
      assert.equal(value.type?.text, 'string');
      assert.equal(value.attribute, 'value');
      assert.equal(value.default, 'hello');
      assert.equal(value.reflects, true);
      assert.equal(
        declaration.members?.some((member) => member.name === 'hidden'),
        false
      );
    }
  );
});

test('collects inherited Lit metadata from a generic mixin', async () => {
  await withSession(
    {
      ...litFiles,
      '/virtual/index.ts': dedent`
        import {LitElement} from 'lit';
        import {property} from 'lit/decorators.js';

        type Constructor<T> = new (...args: any[]) => T;
        function ReactiveMixin<T extends Constructor<HTMLElement>>(Base: T) {
          return class extends Base {
            @property({attribute: 'disabled-state', reflect: true})
            disabled = false;
          };
        }

        export class MixedElement extends ReactiveMixin(LitElement) {
          value: number = 1;
        }
        customElements.define('x-mixed', MixedElement);
      `,
    },
    async (_session, result) => {
      const disabled = field(result, 'MixedElement', 'disabled');
      assert.equal(disabled.type?.text, 'boolean');
      assert.equal(disabled.attribute, 'disabled-state');
      assert.equal(disabled.reflects, true);
      assert.deepEqual(
        component(result, 'MixedElement').declaration.attributes,
        [{name: 'disabled-state', fieldName: 'disabled'}]
      );
      assert.equal(field(result, 'MixedElement', 'value').type?.text, 'number');
    }
  );
});

test('does not collect inline event documentation from dependency render methods', async () => {
  await withSession(
    {
      '/virtual/consumer.ts': "export {DependencyElement} from 'dependency';",
      '/virtual/node_modules/dependency/package.json': JSON.stringify({
        name: 'dependency',
        type: 'module',
        exports: './index.js',
      }),
      '/virtual/node_modules/dependency/index.js': dedent`
        export class DependencyElement extends HTMLElement {
          render() {
            /** @type {Event} render-event - Internal render event. */
            this.dispatchEvent(new Event('render-event'));
          }
        }
        customElements.define('x-dependency', DependencyElement);
      `,
    },
    async (_session, result) => {
      assert.deepEqual(
        component(result, 'DependencyElement').declaration.events,
        []
      );
    },
    '/virtual/consumer.ts'
  );
});
