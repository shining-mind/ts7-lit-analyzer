import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';

import {AnalysisCapability} from '../dist/contracts.js';
import {
  createDiscoverySession,
  type DiscoveryOptions,
} from '../dist/session.js';

function standalone(
  rootFile: string,
  files: Record<string, string>
): DiscoveryOptions {
  return {
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: [rootFile],
    files: Object.entries(files).map(([fileName, text]) => ({fileName, text})),
  };
}

test('reports unresolved semantic modules without relying on diagnostics', async () => {
  const session = await createDiscoverySession(
    standalone('/virtual/index.ts', {
      '/virtual/index.ts': "export {MissingElement} from 'package-a';",
      '/virtual/node_modules/package-a/package.json': JSON.stringify({
        name: 'package-a',
        type: 'module',
        exports: './index.js',
      }),
      '/virtual/node_modules/package-a/index.js':
        "export {MissingElement} from './missing.js';",
    })
  );
  try {
    const result = await session.collect();
    assert.ok(
      result.issues.some(
        (issue) =>
          issue.code === 'unresolved-module' &&
          issue.message.includes('./missing.js')
      )
    );
  } finally {
    await session.dispose();
  }
});

test('rejects an explicitly missing semantic root', async () => {
  await assert.rejects(
    createDiscoverySession({
      mode: 'standalone',
      currentDirectory: '/virtual',
      rootFiles: ['/virtual/missing.ts'],
    }),
    /Semantic root was not included/
  );
});

test('marks unsupported reactive configuration as incomplete attributes', async () => {
  const fileName = '/virtual/index.ts';
  const session = await createDiscoverySession(
    standalone(fileName, {
      [fileName]: dedent`import {LitElement} from 'lit';
declare function createProperties(): unknown;
export class UnsupportedElement extends LitElement {
  static properties = createProperties();
  value: number = 1;
}
customElements.define('x-unsupported', UnsupportedElement);`,
      '/virtual/node_modules/lit/package.json': JSON.stringify({
        name: 'lit',
        type: 'module',
        exports: './index.d.ts',
      }),
      '/virtual/node_modules/lit/index.d.ts':
        'export declare class LitElement extends HTMLElement {}',
    })
  );
  try {
    const result = await session.collect();
    const component = result.components.find(
      (candidate) => candidate.declaration.name === 'UnsupportedElement'
    );
    assert.ok(component);
    assert.equal(
      component.analysis.complete & AnalysisCapability.semantics,
      AnalysisCapability.semantics
    );
    assert.equal(
      component.analysis.incomplete & AnalysisCapability.attributes,
      AnalysisCapability.attributes
    );
    assert.equal(
      component.analysis.complete & AnalysisCapability.attributes,
      0
    );
    assert.ok(
      component.analysis.issues.some(
        (issue) => issue.code === 'unsupported-syntax'
      )
    );
  } finally {
    await session.dispose();
  }
});

test('keeps explicit any complete through the public session', async () => {
  const fileName = '/virtual/index.ts';
  const session = await createDiscoverySession(
    standalone(fileName, {
      [fileName]: dedent`export class ExplicitAnyElement extends HTMLElement {
  value: any;
}
customElements.define('x-explicit-any', ExplicitAnyElement);`,
    })
  );
  try {
    const result = await session.collect();
    const component = result.components.find(
      (candidate) => candidate.declaration.name === 'ExplicitAnyElement'
    );
    assert.ok(component);
    assert.equal(
      component.analysis.complete & AnalysisCapability.semantics,
      AnalysisCapability.semantics
    );
    assert.deepEqual(component.analysis.issues, []);
  } finally {
    await session.dispose();
  }
});
