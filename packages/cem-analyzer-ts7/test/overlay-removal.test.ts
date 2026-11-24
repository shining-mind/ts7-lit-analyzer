import assert from 'node:assert/strict';
import {test} from 'node:test';

import type {ClassField} from 'custom-elements-manifest';
import dedent from 'ts-dedent';

import type {DiscoveryResult} from '../dist/contracts.js';
import {
  createDiscoverySession,
  type DiscoveryOptions,
} from '../dist/session/index.js';

const appFile = '/virtual/app.ts';
const depFile = '/virtual/dep.ts';
const secondFile = '/virtual/second.ts';
const appSource = dedent`
  import {DepElement} from './dep.js';
  export class AppElement extends HTMLElement {
    label = 'x';
  }
  customElements.define('x-app', AppElement);
`;
const depSource = dedent`
  export class DepElement extends HTMLElement {
    count: number = 0;
  }
  customElements.define('x-dep', DepElement);
`;
const secondSource = dedent`
  export class SecondElement extends HTMLElement {
    value = 'second';
  }
  customElements.define('x-second', SecondElement);
`;

function options(eagerness: 'lazy'): DiscoveryOptions & {eagerness: 'lazy'};
function options(): DiscoveryOptions;
function options(eagerness?: 'lazy'): DiscoveryOptions {
  return {
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: [appFile, depFile, secondFile],
    ...(eagerness ? {eagerness} : {}),
    files: [
      {fileName: appFile, text: appSource},
      {fileName: depFile, text: depSource},
      {fileName: secondFile, text: secondSource},
    ],
  };
}

function component(result: DiscoveryResult, name: string) {
  const found = result.components.find(
    (candidate) => candidate.declaration.name === name
  );
  assert.ok(found, `Missing component ${name}`);
  return found;
}

function memberText(
  result: DiscoveryResult,
  name: string,
  memberName: string
): string | undefined {
  const member = component(result, name).declaration.members?.find(
    (candidate) => candidate.name === memberName
  ) as ClassField | undefined;
  return member?.type?.text;
}

const changedDep = depSource.replace(
  'count: number = 0',
  "count: string = 'x'"
);
const changedApp = appSource.replace("label = 'x'", 'label: boolean = true');

test('removes one or all eager overlays and restores configured content', async () => {
  const session = await createDiscoverySession(options());
  try {
    await session.collect();
    await session.update([
      {fileName: depFile, text: changedDep},
      {fileName: appFile, text: changedApp},
    ]);

    const partial = await session.removeOverlays([depFile]);
    assert.deepEqual(partial.overlayFiles, [appFile]);
    assert.equal(partial.containsOverlays, true);
    assert.equal(memberText(partial, 'DepElement', 'count'), 'number');
    assert.equal(memberText(partial, 'AppElement', 'label'), 'boolean');

    assert.strictEqual(await session.removeOverlays([depFile]), partial);
    const last = await session.removeOverlays([appFile]);
    assert.deepEqual(last.overlayFiles, []);
    assert.equal(last.containsOverlays, false);
    assert.equal(memberText(last, 'DepElement', 'count'), 'number');
    assert.equal(memberText(last, 'AppElement', 'label'), 'string');
  } finally {
    await session.dispose();
  }
});

test('lazy removal refreshes only affected in-scope records', async () => {
  const session = await createDiscoverySession(options('lazy'));
  try {
    const scoped = await session.collectScope([appFile]);
    const id = component(scoped, 'DepElement').declarationEvidence.id;
    await session.enrich([id]);
    await session.materializeTypes();
    await session.update([{fileName: depFile, text: changedDep}]);
    await session.enrich([id]);
    assert.equal(
      memberText(await session.materializeTypes(), 'DepElement', 'count'),
      'string'
    );

    const removed = await session.removeOverlays([depFile]);
    assert.deepEqual(removed.overlayFiles, []);
    assert.equal(memberText(removed, 'DepElement', 'count'), undefined);
    assert.deepEqual(
      component(removed, 'SecondElement').declaration.members,
      []
    );

    await session.enrich([id]);
    const restored = await session.materializeTypes();
    assert.equal(memberText(restored, 'DepElement', 'count'), 'number');
    assert.deepEqual(
      component(restored, 'SecondElement').declaration.members,
      []
    );
  } finally {
    await session.dispose();
  }
});

test('lazy removal restores configured content after successive overlays', async () => {
  const session = await createDiscoverySession(options('lazy'));
  try {
    const scoped = await session.collectScope([appFile]);
    const id = component(scoped, 'DepElement').declarationEvidence.id;
    await session.enrich([id]);
    await session.materializeTypes();

    await session.update([{fileName: depFile, text: changedDep}]);
    await session.enrich([id]);
    assert.equal(
      memberText(await session.materializeTypes(), 'DepElement', 'count'),
      'string'
    );

    const booleanDep = depSource.replace(
      'count: number = 0',
      'count: boolean = true'
    );
    await session.update([{fileName: depFile, text: booleanDep}]);
    await session.enrich([id]);
    assert.equal(
      memberText(await session.materializeTypes(), 'DepElement', 'count'),
      'boolean'
    );

    const removed = await session.removeOverlays([depFile]);
    assert.deepEqual(removed.overlayFiles, []);
    await session.enrich([id]);
    assert.equal(
      memberText(await session.materializeTypes(), 'DepElement', 'count'),
      'number'
    );
  } finally {
    await session.dispose();
  }
});

test('cancelled removal retains the previous overlay state', async () => {
  const session = await createDiscoverySession(options());
  const controller = new AbortController();
  const reason = new Error('cancel removal');
  try {
    await session.update([{fileName: depFile, text: changedDep}]);
    const before = await session.collect();
    const pending = session.removeOverlays([depFile], {
      signal: controller.signal,
    });
    controller.abort(reason);
    await assert.rejects(pending, (error) => error === reason);

    const current = await session.collect();
    assert.strictEqual(current, before);
    assert.deepEqual(current.overlayFiles, [depFile]);
    assert.equal(memberText(current, 'DepElement', 'count'), 'string');
  } finally {
    await session.dispose();
  }
});
