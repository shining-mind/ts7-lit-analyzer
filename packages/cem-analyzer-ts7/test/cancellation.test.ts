import assert from 'node:assert/strict';
import {test} from 'node:test';

import type {ClassField} from 'custom-elements-manifest';
import dedent from 'ts-dedent';

import type {DiscoveryResult} from '../dist/contracts.js';
import {
  createDiscoverySession,
  type DiscoveryOptions,
  type LazyDiscoverySession,
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

function memberText(result: DiscoveryResult, name: string): string | undefined {
  const member = component(result, name).declaration.members?.find(
    (candidate) => candidate.name === 'count'
  ) as ClassField | undefined;
  return member?.type?.text;
}

async function expectAbort(
  operation: Promise<unknown>,
  reason: Error
): Promise<void> {
  await assert.rejects(operation, (error) => error === reason);
}

async function depId(session: LazyDiscoverySession): Promise<string> {
  const result = await session.collect();
  return component(result, 'DepElement').declarationEvidence.id;
}

test('pre-cancelled operations reject before doing work', async () => {
  const session = await createDiscoverySession(options());
  const controller = new AbortController();
  const reason = new Error('cancel before start');
  controller.abort(reason);
  const signal = controller.signal;
  try {
    await expectAbort(session.collect({signal}), reason);
    await expectAbort(session.update([], {signal}), reason);
    await expectAbort(session.getTypeAtPosition(appFile, 0, {signal}), reason);
    await expectAbort(
      session.isAssignable(
        {id: 'unused', projectId: 'unused', snapshotId: 'unused'},
        {id: 'unused', projectId: 'unused', snapshotId: 'unused'},
        {signal}
      ),
      reason
    );

    const result = await session.collect();
    assert.equal(memberText(result, 'DepElement'), 'number');
    assert.deepEqual(result.overlayFiles, []);
  } finally {
    await session.dispose();
  }
});

test('cancelled eager update restores overlays and the current result', async () => {
  const session = await createDiscoverySession(options());
  const controller = new AbortController();
  const reason = new Error('cancel after native completion');
  try {
    const initial = await session.collect();
    const pending = session.update(
      [
        {
          fileName: depFile,
          text: depSource.replace('count: number = 0', "count: string = 'x'"),
        },
      ],
      {signal: controller.signal}
    );
    controller.abort(reason);
    await expectAbort(pending, reason);

    const current = await session.collect();
    assert.strictEqual(current, initial);
    assert.equal(memberText(current, 'DepElement'), 'number');
    assert.deepEqual(current.overlayFiles, []);
  } finally {
    await session.dispose();
  }
});

test('cancelled lazy scope requests do not commit prospective scope', async () => {
  const session = await createDiscoverySession(options('lazy'));
  const first = new AbortController();
  const firstReason = new Error('cancel initial scope');
  try {
    const initial = session.collectScope([appFile], {signal: first.signal});
    first.abort(firstReason);
    await expectAbort(initial, firstReason);
    assert.deepEqual((await session.collect()).components, []);

    await session.collectScope([appFile]);
    const before = await session.collect();
    const second = new AbortController();
    const secondReason = new Error('cancel scope extension');
    const extension = session.collectScope([secondFile], {
      signal: second.signal,
    });
    second.abort(secondReason);
    await expectAbort(extension, secondReason);

    const current = await session.collect();
    assert.strictEqual(current, before);
    assert.equal(
      component(current, 'AppElement').declaration.name,
      'AppElement'
    );
  } finally {
    await session.dispose();
  }
});

test('cancelled lazy enrichment, queries, materialization, and update stay usable', async () => {
  const session = await createDiscoverySession(options('lazy'));
  try {
    const scoped = await session.collectScope([appFile]);
    const id = component(scoped, 'DepElement').declarationEvidence.id;
    const enrichment = new AbortController();
    const enrichmentReason = new Error('cancel enrichment');
    const enriching = session.enrich([id], {signal: enrichment.signal});
    enrichment.abort(enrichmentReason);
    await expectAbort(enriching, enrichmentReason);
    assert.equal(await session.getMemberType(id, 'count'), undefined);

    await session.enrich([id]);
    const query = new AbortController();
    const queryReason = new Error('cancel member query');
    const querying = session.getMemberType(id, 'count', {
      signal: query.signal,
    });
    query.abort(queryReason);
    await expectAbort(querying, queryReason);
    assert.equal((await session.getMemberType(id, 'count'))?.text, 'number');

    const materialization = new AbortController();
    const materializationReason = new Error('cancel materialization');
    const materializing = session.materializeTypes({
      signal: materialization.signal,
    });
    materialization.abort(materializationReason);
    await expectAbort(materializing, materializationReason);
    assert.equal(memberText(await session.collect(), 'DepElement'), undefined);
    assert.equal(
      memberText(await session.materializeTypes(), 'DepElement'),
      'number'
    );

    const update = new AbortController();
    const updateReason = new Error('cancel lazy update');
    const updating = session.update(
      [
        {
          fileName: depFile,
          text: depSource.replace('count: number = 0', "count: string = 'x'"),
        },
      ],
      {signal: update.signal}
    );
    update.abort(updateReason);
    await expectAbort(updating, updateReason);
    assert.equal((await session.getMemberType(id, 'count'))?.text, 'number');
    assert.equal(await depId(session), id);
  } finally {
    await session.dispose();
  }
});
