import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';

import {
  createDiscoverySession,
  type DiscoveryResult,
  type DiscoverySession,
} from '../dist/index.js';

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

test('dependency superclass carries canonical package name and module path', async () => {
  await withSession(
    {
      '/virtual/index.ts': dedent`
        import {BaseElement} from 'dep';
        export class ChildElement extends BaseElement {}
        customElements.define('x-child', ChildElement);
      `,
      '/virtual/node_modules/dep/package.json': JSON.stringify({
        name: 'dep',
        type: 'module',
        types: './index.d.ts',
      }),
      '/virtual/node_modules/dep/index.d.ts':
        'export declare class BaseElement extends HTMLElement {}',
    },
    async (_session, result) => {
      const superclass = component(result, 'ChildElement').declaration
        .superclass;
      assert.equal(superclass?.name, 'BaseElement');
      assert.equal(superclass?.package, 'dep');
      assert.match(superclass?.module ?? '', /dep\/index\.d\.ts$/);
    }
  );
});

test('dependency base reached through a relative import keeps package provenance', async () => {
  await withSession(
    {
      '/virtual/consumer.ts': "export {ChildElement} from 'dep';",
      '/virtual/node_modules/dep/package.json': JSON.stringify({
        name: 'dep',
        type: 'module',
        types: './index.d.ts',
      }),
      '/virtual/node_modules/dep/index.d.ts': dedent`
        import {Dialog} from './internal/dialog.js';
        /** @tag x-child */
        export declare class ChildElement extends Dialog {}
      `,
      '/virtual/node_modules/dep/internal/dialog.d.ts': dedent`
        /** @fires {Event} open - Opened. */
        export declare class Dialog extends HTMLElement {}
      `,
    },
    async (_session, result) => {
      const child = component(result, 'ChildElement');
      const superclass = child.declaration.superclass;
      assert.equal(superclass?.name, 'Dialog');
      assert.equal(superclass?.package, 'dep');
      assert.match(superclass?.module ?? '', /dep\/internal\/dialog\.d\.ts$/);
      assert.deepEqual(child.declaration.events, [
        {name: 'open', type: {text: 'Event'}, description: 'Opened.'},
      ]);
    },
    '/virtual/consumer.ts'
  );
});

test('local superclass in another project module carries module without package', async () => {
  await withSession(
    {
      '/virtual/base.ts': 'export class BaseElement extends HTMLElement {}',
      '/virtual/index.ts': dedent`
        import {BaseElement} from './base.js';
        export class ChildElement extends BaseElement {}
        customElements.define('x-child', ChildElement);
      `,
    },
    async (_session, result) => {
      const superclass = component(result, 'ChildElement').declaration
        .superclass;
      assert.equal(superclass?.name, 'BaseElement');
      assert.equal(superclass?.package, undefined);
      assert.equal(superclass?.module, '/virtual/base.ts');
    }
  );
});

test('same-module superclass carries the current module path without package', async () => {
  await withSession(
    {
      '/virtual/index.ts': dedent`
        class BaseElement extends HTMLElement {}
        export class ChildElement extends BaseElement {}
        customElements.define('x-child', ChildElement);
      `,
    },
    async (_session, result) => {
      const superclass = component(result, 'ChildElement').declaration
        .superclass;
      assert.equal(superclass?.name, 'BaseElement');
      assert.equal(superclass?.package, undefined);
      assert.equal(superclass?.module, '/virtual/index.ts');
    }
  );
});

test('built-in superclass carries only the class name', async () => {
  await withSession(
    {
      '/virtual/index.ts': dedent`
        export class ChildElement extends HTMLElement {}
        customElements.define('x-child', ChildElement);
      `,
    },
    async (_session, result) => {
      assert.deepEqual(
        component(result, 'ChildElement').declaration.superclass,
        {name: 'HTMLElement'}
      );
    }
  );
});
