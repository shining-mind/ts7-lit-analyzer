import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';
import type {ClassField} from 'custom-elements-manifest';

import {
  createDiscoverySession,
  type DiscoveryOptions,
  type DiscoveryResult,
  type DiscoverySession,
  type SemanticReference,
  type WebComponentRecord,
} from '../dist/index.js';

async function withOverlaySession(
  options: DiscoveryOptions,
  run: (session: DiscoverySession) => Promise<void>
): Promise<void> {
  const session = await createDiscoverySession(options);
  try {
    await run(session);
  } finally {
    await session.dispose();
  }
}

function overlayComponent(
  result: DiscoveryResult,
  name: string
): WebComponentRecord {
  const component = result.components.find(
    (candidate) => candidate.declaration.name === name
  );
  assert.ok(component, `missing component: ${name}`);
  return component;
}

function overlayMemberType(
  component: WebComponentRecord,
  memberName: string
): string | undefined {
  const member = component.declaration.members?.find(
    (candidate) => candidate.name === memberName
  ) as ClassField | undefined;
  return member?.type?.text;
}

function overlayMemberReference(
  component: WebComponentRecord,
  memberName: string
): SemanticReference {
  const reference = component.members.find(
    (member) => member.memberName === memberName
  )?.type;
  assert.ok(reference, `missing semantic reference: ${memberName}`);
  return reference;
}

async function overlayReferenceAt(
  session: DiscoverySession,
  fileName: string,
  source: string,
  needle: string,
  offset = 0
): Promise<SemanticReference> {
  const position = source.indexOf(needle);
  assert.notEqual(position, -1, `missing test position: ${needle}`);
  const reference = await session.getTypeAtPosition(
    fileName,
    position + offset
  );
  assert.ok(reference, `missing type at ${needle}`);
  return reference;
}

test('updates direct JavaScript while preserving old results and unaffected records', async () => {
  const consumerFileName = '/virtual/consumer.ts';
  const directFileName = '/virtual/direct.js';
  const stableFileName = '/virtual/stable.js';
  const consumerSource = dedent`import {StableElement} from './stable.js';
const element = new StableElement();
const candidate = 'bad';
element.count = candidate;
candidate;
`;
  const directSource = dedent`
    export class DirectElement extends HTMLElement {
      count = 0;
      flag = false;
    }
    customElements.define('x-direct', DirectElement);
  `;
  const stableSource = dedent`
    export class StableElement extends HTMLElement {
      count = 0;
    }
    customElements.define('x-stable', StableElement);
  `;

  await withOverlaySession(
    {
      mode: 'standalone',
      currentDirectory: '/virtual',
      rootFiles: [consumerFileName, directFileName, stableFileName],
      files: [
        {fileName: consumerFileName, text: consumerSource},
        {fileName: directFileName, text: directSource},
        {fileName: stableFileName, text: stableSource},
      ],
    },
    async (session) => {
      const oldResult = await session.collect();
      const oldContents = JSON.stringify(oldResult);
      const oldDirect = overlayComponent(oldResult, 'DirectElement');
      const oldStable = overlayComponent(oldResult, 'StableElement');
      const oldDirectReference = overlayMemberReference(oldDirect, 'flag');
      const stableReference = overlayMemberReference(oldStable, 'count');
      assert.equal(oldResult.containsOverlays, false);
      assert.deepEqual(oldResult.overlayFiles, []);

      const result = await session.update([
        {
          fileName: directFileName,
          text: directSource.replace('count = 0', "count = 'zero'"),
        },
      ]);

      assert.notEqual(result.snapshotId, oldResult.snapshotId);
      assert.equal(result.containsOverlays, true);
      assert.deepEqual(result.overlayFiles, [directFileName]);
      assert.equal(
        overlayMemberType(overlayComponent(result, 'DirectElement'), 'count'),
        'string'
      );
      assert.strictEqual(
        overlayComponent(result, 'StableElement'),
        oldStable,
        'unaffected semantic types must not be recomputed during update'
      );
      assert.equal(JSON.stringify(oldResult), oldContents);
      assert.equal(overlayMemberType(oldDirect, 'count'), 'number');
      assert.equal(stableReference.snapshotId, oldResult.snapshotId);

      await assert.rejects(
        session.isAssignable(oldDirectReference, oldDirectReference),
        /snapshot|reference/i
      );
      const currentCandidate = await overlayReferenceAt(
        session,
        consumerFileName,
        consumerSource,
        'candidate;',
        0
      );
      assert.equal(
        await session.isAssignable(currentCandidate, stableReference),
        false
      );
      assert.equal(JSON.stringify(oldResult), oldContents);
    }
  );
});

test('updates a component reached through a transitive package re-export', async () => {
  const consumerFileName = '/virtual/consumer.ts';
  const implementationFileName = '/virtual/node_modules/package-b/index.js';
  const implementation = dedent`
    export class TransitiveElement extends HTMLElement {
      count = 0;
    }
    customElements.define('x-transitive', TransitiveElement);
  `;

  await withOverlaySession(
    {
      mode: 'standalone',
      currentDirectory: '/virtual',
      rootFiles: [consumerFileName],
      files: [
        {
          fileName: consumerFileName,
          text: "export {TransitiveElement} from 'package-a';\n",
        },
        {
          fileName: '/virtual/node_modules/package-a/package.json',
          text: JSON.stringify({
            name: 'package-a',
            type: 'module',
            exports: './index.js',
          }),
        },
        {
          fileName: '/virtual/node_modules/package-a/index.js',
          text: "export {TransitiveElement} from 'package-b';\n",
        },
        {
          fileName: '/virtual/node_modules/package-b/package.json',
          text: JSON.stringify({
            name: 'package-b',
            type: 'module',
            exports: './index.js',
          }),
        },
        {fileName: implementationFileName, text: implementation},
      ],
    },
    async (session) => {
      const oldResult = await session.collect();
      const result = await session.update([
        {
          fileName: implementationFileName,
          text: implementation.replace('count = 0', "count = 'zero'"),
        },
      ]);

      assert.equal(
        overlayMemberType(
          overlayComponent(result, 'TransitiveElement'),
          'count'
        ),
        'string'
      );
      assert.equal(
        overlayMemberType(
          overlayComponent(oldResult, 'TransitiveElement'),
          'count'
        ),
        'number'
      );
      assert.deepEqual(result.overlayFiles, [implementationFileName]);
    }
  );
});

test('applies declaration and implementation overlays with declaration authority', async () => {
  const consumerFileName = '/virtual/consumer.ts';
  const declarationFileName = '/virtual/node_modules/dual/index.d.ts';
  const implementationFileName = '/virtual/node_modules/dual/index.js';
  const declaration = dedent`export declare class DualElement extends HTMLElement {
  value: number;
}
`;
  const implementation = dedent`class DualElement extends HTMLElement {}
customElements.define('dual-old', DualElement);
`;

  await withOverlaySession(
    {
      mode: 'standalone',
      currentDirectory: '/virtual',
      rootFiles: [consumerFileName],
      files: [
        {
          fileName: consumerFileName,
          text: "export {DualElement} from 'dual';\n",
        },
        {
          fileName: '/virtual/node_modules/dual/package.json',
          text: JSON.stringify({
            name: 'dual',
            type: 'module',
            types: './index.d.ts',
            exports: './index.js',
          }),
        },
        {fileName: declarationFileName, text: declaration},
        {fileName: implementationFileName, text: implementation},
      ],
    },
    async (session) => {
      const initial = await session.collect();
      const declarationResult = await session.update([
        {
          fileName: declarationFileName,
          text: declaration.replace('value: number', 'value: string'),
        },
      ]);
      const declarationComponent = overlayComponent(
        declarationResult,
        'DualElement'
      );
      assert.equal(overlayMemberType(declarationComponent, 'value'), 'string');
      assert.equal(declarationComponent.declaration.tagName, 'dual-old');
      assert.equal(
        overlayMemberType(overlayComponent(initial, 'DualElement'), 'value'),
        'number'
      );

      const implementationResult = await session.update([
        {
          fileName: implementationFileName,
          text: implementation.replace('dual-old', 'dual-new'),
        },
      ]);
      const implementationComponent = overlayComponent(
        implementationResult,
        'DualElement'
      );
      assert.equal(implementationComponent.declaration.tagName, 'dual-new');
      assert.equal(
        overlayMemberType(implementationComponent, 'value'),
        'string'
      );
      assert.equal(declarationComponent.declaration.tagName, 'dual-old');
      assert.deepEqual(implementationResult.overlayFiles, [
        declarationFileName,
        implementationFileName,
      ]);
    }
  );
});

test('invalidates subclasses but reuses unrelated components after a base edit', async () => {
  const baseFileName = '/virtual/base.js';
  const childFileName = '/virtual/child.js';
  const stableFileName = '/virtual/stable.js';
  const baseSource = dedent`
    export class BaseElement extends HTMLElement {
      count = 0;
    }
  `;

  await withOverlaySession(
    {
      mode: 'standalone',
      currentDirectory: '/virtual',
      rootFiles: [childFileName, stableFileName],
      files: [
        {fileName: baseFileName, text: baseSource},
        {
          fileName: childFileName,
          text: dedent`
            import {BaseElement} from './base.js';
            export class ChildElement extends BaseElement {}
            customElements.define('x-child', ChildElement);
          `,
        },
        {
          fileName: stableFileName,
          text: dedent`
            export class StableElement extends HTMLElement {
              value = 0;
            }
            customElements.define('x-stable', StableElement);
          `,
        },
      ],
    },
    async (session) => {
      const oldResult = await session.collect();
      const oldStable = overlayComponent(oldResult, 'StableElement');
      const result = await session.update([
        {
          fileName: baseFileName,
          text: baseSource.replace('count = 0', "count = 'zero'"),
        },
      ]);

      assert.equal(
        overlayMemberType(overlayComponent(result, 'ChildElement'), 'count'),
        'string'
      );
      assert.equal(
        overlayMemberType(overlayComponent(oldResult, 'ChildElement'), 'count'),
        'number'
      );
      assert.strictEqual(overlayComponent(result, 'StableElement'), oldStable);
    }
  );
});

test('reports initial one-shot overlay provenance without exposing text', async () => {
  const fileName = '/virtual/one-shot.js';
  const overlayText = dedent`
    export class OneShotElement extends HTMLElement {
      count = 'zero';
    }
    customElements.define('x-one-shot', OneShotElement);
  `;
  await withOverlaySession(
    {
      mode: 'standalone',
      currentDirectory: '/virtual',
      rootFiles: [fileName],
      files: [
        {
          fileName,
          text: dedent`
            export class OneShotElement extends HTMLElement {
              count = 0;
            }
            customElements.define('x-one-shot', OneShotElement);
          `,
        },
      ],
      overlays: [{fileName, text: overlayText}],
    },
    async (session) => {
      const result = await session.collect();
      assert.equal(result.containsOverlays, true);
      assert.deepEqual(result.overlayFiles, [fileName]);
      assert.equal(
        overlayMemberType(overlayComponent(result, 'OneShotElement'), 'count'),
        'string'
      );
      assert.equal(JSON.stringify(result).includes(overlayText), false);
    }
  );
});
