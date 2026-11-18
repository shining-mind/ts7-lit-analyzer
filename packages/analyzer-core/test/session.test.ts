import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  AnalysisCapability,
  capabilityStatus,
  createRegistrySession,
  findProperty,
  type LazyRegistrySession,
  type RegistryView,
  type SemanticReference,
} from '../dist/index.js';

const fileName = '/virtual/index.ts';
const source = [
  'export class CountElement extends HTMLElement {',
  '  count: number = 0;',
  "  label: string = '';",
  '}',
  "customElements.define('x-count', CountElement);",
].join('\n');

function options(eagerness?: 'lazy') {
  return {
    mode: 'standalone' as const,
    currentDirectory: '/virtual',
    rootFiles: [fileName],
    files: [{fileName, text: source}],
    ...(eagerness ? {eagerness} : {}),
  };
}

function memberReference(
  view: RegistryView,
  tag: string,
  memberName: string
): SemanticReference {
  const record = view.byTagName(tag);
  assert.ok(record);
  const reference = record.members.find(
    (member) => member.memberName === memberName
  )?.type;
  assert.ok(reference, `missing reference for ${memberName}`);
  return reference;
}

test('registry session collects a single-project view and tracks it', async () => {
  const session = await createRegistrySession(options());
  try {
    const view = await session.collect();
    assert.equal(view.byTagName('x-count')?.declaration.name, 'CountElement');
    assert.equal(view.project.currentDirectory, '/virtual');
    assert.equal(session.current(), view);
    assert.equal(
      findProperty(view.byTagName('x-count')!, 'count')?.type?.text,
      'number'
    );
  } finally {
    await session.dispose();
  }
});

test('overlay update produces a successor view while the old view is retained', async () => {
  const session = await createRegistrySession(options());
  try {
    const first = await session.collect();
    const updated = source.replace('count: number = 0', 'count: string = "x"');
    const second = await session.update([{fileName, text: updated}]);

    assert.ok(second.generation > first.generation);
    assert.notEqual(second.snapshotId, first.snapshotId);
    assert.equal(second.containsOverlays, true);
    assert.deepEqual(second.overlayFiles, [fileName]);
    assert.equal(
      findProperty(second.byTagName('x-count')!, 'count')?.type?.text,
      'string'
    );
    assert.equal(
      findProperty(first.byTagName('x-count')!, 'count')?.type?.text,
      'number'
    );
    assert.equal(session.current(), second);
  } finally {
    await session.dispose();
  }
});

test('assignability uses same-snapshot checker references', async () => {
  const session = await createRegistrySession(options());
  try {
    const view = await session.collect();
    const record = view.byTagName('x-count')!;
    const count = memberReference(view, 'x-count', 'count');
    const label = memberReference(view, 'x-count', 'label');

    assert.equal(await session.isAssignable(label, count), false);
    assert.equal(await session.isAssignable(count, count), true);
    assert.equal(
      await session.isAssignableToMember(label, record, 'count'),
      false
    );
    assert.equal(count.projectId, label.projectId);
    assert.equal(count.snapshotId, label.snapshotId);
  } finally {
    await session.dispose();
  }
});

test('eager member type queries return materialized text and reference', async () => {
  const session = await createRegistrySession(options());
  try {
    const view = await session.collect();
    const id = view.byTagName('x-count')!.declarationEvidence.id;
    const query = await session.memberType(id, 'count');
    assert.equal(query?.text, 'number');
    assert.ok(query?.reference);
  } finally {
    await session.dispose();
  }
});

test('disposed session rejects further operations', async () => {
  const session = await createRegistrySession(options());
  await session.collect();
  await session.dispose();
  await assert.rejects(session.collect(), /disposed/i);
  await assert.rejects(session.update([]), /disposed/i);
  await assert.rejects(session.memberType('id', 'count'), /disposed/i);
});

test('lazy session surfaces not-collected semantics until enrichment', async () => {
  const session = (await createRegistrySession(
    options('lazy')
  )) as LazyRegistrySession;
  try {
    assert.deepEqual((await session.collect()).components(), []);
    const scoped = await session.collectScope([fileName]);
    const indexed = scoped.byTagName('x-count')!;
    assert.equal(
      capabilityStatus(indexed, AnalysisCapability.semantics),
      'not-collected'
    );

    const enriched = await session.enrich([indexed.declarationEvidence.id]);
    const record = enriched.byTagName('x-count')!;
    assert.equal(
      capabilityStatus(record, AnalysisCapability.semantics),
      'complete'
    );
    const query = await session.memberType(
      record.declarationEvidence.id,
      'count'
    );
    assert.equal(query?.text, 'number');
  } finally {
    await session.dispose();
  }
});

test('cancelled collection and update preserve the current registry view', async () => {
  const first = await createRegistrySession(options());
  const controller = new AbortController();
  const reason = new Error('cancel registry collection');
  try {
    const pending = first.collect({signal: controller.signal});
    controller.abort(reason);
    await assert.rejects(pending, (error) => error === reason);
    assert.equal(first.current(), undefined);
    assert.ok(await first.collect());
  } finally {
    await first.dispose();
  }

  const second = await createRegistrySession(options());
  const update = new AbortController();
  const updateReason = new Error('cancel registry update');
  try {
    const before = await second.collect();
    const pending = second.update(
      [
        {
          fileName,
          text: source.replace('count: number = 0', 'count: string = "x"'),
        },
      ],
      {signal: update.signal}
    );
    update.abort(updateReason);
    await assert.rejects(pending, (error) => error === updateReason);
    assert.strictEqual(second.current(), before);
  } finally {
    await second.dispose();
  }
});

test('cancelled lazy semantic query does not replace the view', async () => {
  const session = (await createRegistrySession(
    options('lazy')
  )) as LazyRegistrySession;
  const controller = new AbortController();
  const reason = new Error('cancel registry query');
  try {
    const scoped = await session.collectScope([fileName]);
    const id = scoped.byTagName('x-count')!.declarationEvidence.id;
    const before = await session.enrich([id]);
    const pending = session.memberType(id, 'count', {
      signal: controller.signal,
    });
    controller.abort(reason);
    await assert.rejects(pending, (error) => error === reason);
    assert.strictEqual(session.current(), before);
    assert.equal((await session.memberType(id, 'count'))?.text, 'number');
  } finally {
    await session.dispose();
  }
});

test('overlay removal applies a successor with restored provenance', async () => {
  const session = await createRegistrySession(options());
  try {
    await session.update([
      {
        fileName,
        text: source.replace('count: number = 0', 'count: string = "x"'),
      },
    ]);
    const removed = await session.removeOverlays([fileName]);
    assert.equal(removed.containsOverlays, false);
    assert.deepEqual(removed.overlayFiles, []);
    assert.equal(
      findProperty(removed.byTagName('x-count')!, 'count')?.type?.text,
      'number'
    );
    assert.equal(session.current(), removed);
  } finally {
    await session.dispose();
  }
});

test('timing access is opt-in and forwards reset', async () => {
  const disabled = await createRegistrySession(options());
  try {
    await disabled.collect();
    const timing = await disabled.getTimingInfo();
    assert.equal(timing.enabled, false);
    assert.equal(timing.totals.requestCount, 0);
  } finally {
    await disabled.dispose();
  }

  const enabled = await createRegistrySession({
    ...options(),
    collectTiming: true,
  });
  try {
    await enabled.collect();
    const before = await enabled.getTimingInfo();
    assert.equal(before.enabled, true);
    assert.ok(before.totals.requestCount > 0);
    assert.ok(before.totals.bytesReceived > 0);
    await enabled.resetTimingInfo();
    const after = await enabled.getTimingInfo();
    assert.ok(after.totals.requestCount < before.totals.requestCount);
  } finally {
    await enabled.dispose();
  }
});
