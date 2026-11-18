import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';

import {
  createDiscoverySession,
  type DiscoveryResult,
  type DiscoverySession,
  type LazyDiscoverySession,
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

test('inherits dependency base class events with base-declaration evidence', async () => {
  await withSession(
    {
      '/virtual/consumer.ts': "export {ChildElement} from 'dep';",
      '/virtual/node_modules/dep/package.json': JSON.stringify({
        name: 'dep',
        type: 'module',
        exports: './index.js',
      }),
      '/virtual/node_modules/dep/base.js': dedent`
        /**
         * @fires {Event} open - Opened.
         * @fires {Event} close - Closed.
         */
        export class BaseElement extends HTMLElement {}
      `,
      '/virtual/node_modules/dep/index.js': dedent`
        import {BaseElement} from './base.js';
        export class ChildElement extends BaseElement {}
        customElements.define('x-child', ChildElement);
      `,
    },
    async (_session, result) => {
      assert.deepEqual(
        result.components.map((candidate) => candidate.declaration.name),
        ['ChildElement']
      );
      const child = component(result, 'ChildElement');
      assert.deepEqual(child.declaration.events, [
        {name: 'open', type: {text: 'Event'}, description: 'Opened.'},
        {name: 'close', type: {text: 'Event'}, description: 'Closed.'},
      ]);
      assert.ok(
        child.documentationEvidence?.some(
          (evidence) =>
            evidence.tagName === 'fires' &&
            /dep\/base\.js$/.test(evidence.fileName)
        ),
        'Expected inherited event evidence identifying the base declaration'
      );
    },
    '/virtual/consumer.ts'
  );
});

test('inherits local base class slots and CSS metadata', async () => {
  await withSession(
    {
      '/virtual/index.ts': dedent`
        /**
         * @slot - Default content.
         * @slot header - Header content.
         * @csspart label - Label part.
         * @cssprop [--text-color=red] - Text color.
         */
        class BaseElement extends HTMLElement {}
        export class ChildElement extends BaseElement {}
        customElements.define('x-child', ChildElement);
      `,
    },
    async (_session, result) => {
      assert.deepEqual(
        result.components.map((candidate) => candidate.declaration.name),
        ['ChildElement']
      );
      const declaration = component(result, 'ChildElement').declaration;
      assert.deepEqual(declaration.slots, [
        {name: '', description: 'Default content.'},
        {name: 'header', description: 'Header content.'},
      ]);
      assert.deepEqual(declaration.cssParts, [
        {name: 'label', description: 'Label part.'},
      ]);
      assert.deepEqual(declaration.cssProperties, [
        {name: '--text-color', default: 'red', description: 'Text color.'},
      ]);
    }
  );
});

test('subclass documentation takes precedence over inherited base facts', async () => {
  await withSession(
    {
      '/virtual/index.ts': dedent`
        /**
         * @fires {Event} change - Base change.
         * @slot header - Base header.
         */
        class BaseElement extends HTMLElement {}
        /**
         * @fires {CustomEvent<string>} change - Child change.
         * @slot header - Child header.
         */
        export class ChildElement extends BaseElement {}
        customElements.define('x-child', ChildElement);
      `,
    },
    async (_session, result) => {
      const declaration = component(result, 'ChildElement').declaration;
      assert.deepEqual(declaration.events, [
        {
          name: 'change',
          type: {text: 'CustomEvent<string>'},
          description: 'Child change.',
        },
      ]);
      assert.deepEqual(declaration.slots, [
        {name: 'header', description: 'Child header.'},
      ]);
    }
  );
});

test('inherited metadata follows declaration authority for a dual base package', async () => {
  await withSession(
    {
      '/virtual/index.ts': dedent`
        import {BaseElement} from 'dep';
        /** @fires {Event} child-event - Child event. */
        export class ChildElement extends BaseElement {}
        customElements.define('x-child', ChildElement);
      `,
      '/virtual/node_modules/dep/package.json': JSON.stringify({
        name: 'dep',
        type: 'module',
        types: './base.d.ts',
        exports: './base.js',
      }),
      '/virtual/node_modules/dep/base.d.ts': dedent`
        /** @fires {Event} declared-event - From declaration. */
        export declare class BaseElement extends HTMLElement {}
      `,
      '/virtual/node_modules/dep/base.js': dedent`
        /** @fires {Event} impl-event - From implementation. */
        export class BaseElement extends HTMLElement {}
      `,
    },
    async (_session, result) => {
      const events = component(result, 'ChildElement').declaration.events ?? [];
      assert.deepEqual(events.map((event) => event.name).sort(), [
        'child-event',
        'declared-event',
      ]);
      assert.equal(
        events.some((event) => event.name === 'impl-event'),
        false
      );
    }
  );
});

test('unregistered documented base classes do not become component records', async () => {
  await withSession(
    {
      '/virtual/index.ts': dedent`
        /**
         * @slot - Base default slot.
         * @fires {Event} base-event - Base event.
         */
        export class BaseElement extends HTMLElement {}
        export class ChildElement extends BaseElement {}
        customElements.define('x-child', ChildElement);
      `,
    },
    async (_session, result) => {
      assert.deepEqual(
        result.components.map((candidate) => candidate.declaration.name),
        ['ChildElement']
      );
      const child = component(result, 'ChildElement');
      assert.deepEqual(child.declaration.slots, [
        {name: '', description: 'Base default slot.'},
      ]);
      assert.deepEqual(child.declaration.events, [
        {name: 'base-event', type: {text: 'Event'}, description: 'Base event.'},
      ]);
    }
  );
});

test('lazy enrichment inherits base class documentation on demand', async () => {
  const indexFile = '/virtual/index.ts';
  const session = (await createDiscoverySession({
    mode: 'standalone',
    currentDirectory: '/virtual',
    eagerness: 'lazy',
    rootFiles: [indexFile],
    files: [
      {
        fileName: indexFile,
        text: dedent`
          /** @fires {Event} base-event - Base event. */
          class BaseElement extends HTMLElement {}
          export class ChildElement extends BaseElement {}
          customElements.define('x-child', ChildElement);
        `,
      },
    ],
  })) as LazyDiscoverySession;
  try {
    const scoped = await session.collectScope([indexFile]);
    const indexed = scoped.components.find(
      (candidate) => candidate.declaration.name === 'ChildElement'
    );
    assert.ok(indexed);
    assert.deepEqual(indexed.declaration.events ?? [], []);

    const enriched = await session.enrich([indexed.declarationEvidence.id]);
    const child = enriched.components.find(
      (candidate) => candidate.declaration.name === 'ChildElement'
    );
    assert.ok(child);
    assert.deepEqual(child.declaration.events, [
      {name: 'base-event', type: {text: 'Event'}, description: 'Base event.'},
    ]);
  } finally {
    await session.dispose();
  }
});
