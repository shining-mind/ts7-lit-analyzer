import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';

import {
  createDiscoverySession,
  type DiscoveryResult,
  type DiscoverySession,
  type VirtualSourceFile,
} from '../dist/index.js';

const consumerFileName = '/virtual/consumer.ts';
const componentFileName = '/virtual/component.js';
const componentSource = dedent`
  export class AddedElement extends HTMLElement {
    count = 0;
  }
  customElements.define('x-added', AddedElement);
`;

async function withUpdatedSession(
  initialConsumer: string,
  files: readonly VirtualSourceFile[],
  updatedConsumer: string,
  run: (
    session: DiscoverySession,
    result: DiscoveryResult,
    initial: DiscoveryResult
  ) => Promise<void>
): Promise<void> {
  const session = await createDiscoverySession({
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: [consumerFileName],
    files: [{fileName: consumerFileName, text: initialConsumer}, ...files],
  });
  try {
    const initial = await session.collect();
    const result = await session.update([
      {fileName: consumerFileName, text: updatedConsumer},
    ]);
    await run(session, result, initial);
  } finally {
    await session.dispose();
  }
}

function assertAddedComponent(result: DiscoveryResult): void {
  const component = result.components.find(
    (candidate) => candidate.declaration.name === 'AddedElement'
  );
  assert.ok(component, 'newly reachable component must be collected');
  assert.equal(component.declaration.tagName, 'x-added');
}

test('collects a component added through a side-effect import', async () => {
  await withUpdatedSession(
    'export const value = 1;\n',
    [{fileName: componentFileName, text: componentSource}],
    "import './component.js';\n",
    async (_session, result) => {
      assertAddedComponent(result);
    }
  );
});

test('collects a component added through a re-export', async () => {
  await withUpdatedSession(
    'export const value = 1;\n',
    [{fileName: componentFileName, text: componentSource}],
    "export {AddedElement} from './component.js';\n",
    async (_session, result) => {
      assertAddedComponent(result);
    }
  );
});

test('adds and removes a registration from a separate file', async () => {
  const registrationFileName = '/virtual/register.js';
  const classFileName = '/virtual/y.js';
  const consumerSource = "import './y.js';\nimport './register.js';\n";
  const classSource = dedent`
    export class YElement extends HTMLElement {
      count = 0;
    }
  `;
  const registeredSource = dedent`
    import {YElement} from './y.js';
    customElements.define('x-y', YElement);
  `;
  const session = await createDiscoverySession({
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: [consumerFileName],
    files: [
      {fileName: consumerFileName, text: consumerSource},
      {fileName: classFileName, text: classSource},
      {fileName: registrationFileName, text: 'export const noop = 1;\n'},
    ],
  });
  try {
    const initial = await session.collect();
    assert.equal(initial.components.length, 0);

    const registered = await session.update([
      {fileName: registrationFileName, text: registeredSource},
    ]);
    const component = registered.components.find(
      (candidate) => candidate.declaration.name === 'YElement'
    );
    assert.ok(component, 'new cross-file registration must collect the class');
    assert.equal(component.declaration.tagName, 'x-y');
    assert.equal(initial.components.length, 0);

    const removed = await session.update([
      {fileName: registrationFileName, text: 'export const noop = 1;\n'},
    ]);
    assert.equal(removed.components.length, 0);
    assert.ok(registered.components[0]);
  } finally {
    await session.dispose();
  }
});

test('adds and removes a tag-map registration from a separate file', async () => {
  const tagMapFileName = '/virtual/tag-map.ts';
  const classFileName = '/virtual/y.js';
  const consumerSource = "import './y.js';\nimport './tag-map.ts';\n";
  const tagMapSource = dedent`
    import {YElement} from './y.js';
    declare global {
      interface HTMLElementTagNameMap {
        'x-y': YElement;
      }
    }
  `;
  const session = await createDiscoverySession({
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: [consumerFileName],
    files: [
      {fileName: consumerFileName, text: consumerSource},
      {
        fileName: classFileName,
        text: 'export class YElement extends HTMLElement { count = 0; }\n',
      },
      {fileName: tagMapFileName, text: 'export const noop = 1;\n'},
    ],
  });
  try {
    assert.equal((await session.collect()).components.length, 0);

    const registered = await session.update([
      {fileName: tagMapFileName, text: tagMapSource},
    ]);
    const component = registered.components.find(
      (candidate) => candidate.declaration.name === 'YElement'
    );
    assert.ok(component, 'new tag-map evidence must collect the class');
    assert.equal(component.declaration.tagName, 'x-y');

    const removed = await session.update([
      {fileName: tagMapFileName, text: 'export const noop = 1;\n'},
    ]);
    assert.equal(removed.components.length, 0);
    assert.ok(registered.components[0]);
  } finally {
    await session.dispose();
  }
});

test('prunes a component and semantic module after its last import is removed', async () => {
  await withUpdatedSession(
    "import './component.js';\n",
    [{fileName: componentFileName, text: componentSource}],
    'export const value = 1;\n',
    async (session, result, initial) => {
      assertAddedComponent(initial);
      assert.equal(result.components.length, 0);
      assert.equal(
        await session.getTypeAtPosition(
          componentFileName,
          componentSource.indexOf('count')
        ),
        undefined
      );
    }
  );
});

test('heals an unresolved import when an overlay creates its target', async () => {
  const laterFileName = '/virtual/later.js';
  const session = await createDiscoverySession({
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: [consumerFileName],
    files: [{fileName: consumerFileName, text: "import './later.js';\n"}],
  });
  try {
    const initial = await session.collect();
    assert.deepEqual(
      initial.issues.map((issue) => issue.code),
      ['unresolved-module']
    );

    const result = await session.update([
      {
        fileName: laterFileName,
        text: dedent`
          export class LaterElement extends HTMLElement {}
          customElements.define('x-later', LaterElement);
        `,
      },
    ]);
    const component = result.components.find(
      (candidate) => candidate.declaration.name === 'LaterElement'
    );
    assert.ok(component, 'a new file must heal the unresolved cached edge');
    assert.equal(component.declaration.tagName, 'x-later');
    assert.deepEqual(result.issues, []);
  } finally {
    await session.dispose();
  }
});

test('re-resolves package imports when a package manifest changes', async () => {
  const manifestFileName = '/virtual/node_modules/pkg/package.json';
  const session = await createDiscoverySession({
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: [consumerFileName],
    files: [
      {
        fileName: consumerFileName,
        text: "export {OldElement} from 'pkg';\n",
      },
      {
        fileName: manifestFileName,
        text: JSON.stringify({
          name: 'pkg',
          type: 'module',
          exports: './old.js',
        }),
      },
      {
        fileName: '/virtual/node_modules/pkg/old.js',
        text: dedent`
          export class OldElement extends HTMLElement {}
          customElements.define('x-old', OldElement);
        `,
      },
      {
        fileName: '/virtual/node_modules/pkg/new.js',
        text: dedent`
          export class NewElement extends HTMLElement {}
          customElements.define('x-new', NewElement);
        `,
      },
    ],
  });
  try {
    const initial = await session.collect();
    assert.ok(
      initial.components.some(
        (component) => component.declaration.name === 'OldElement'
      )
    );

    const result = await session.update([
      {
        fileName: manifestFileName,
        text: JSON.stringify({
          name: 'pkg',
          type: 'module',
          exports: './new.js',
        }),
      },
    ]);
    assert.deepEqual(
      result.components.map((component) => component.declaration.name),
      ['NewElement']
    );
    assert.equal(result.components[0]?.declaration.tagName, 'x-new');
  } finally {
    await session.dispose();
  }
});
