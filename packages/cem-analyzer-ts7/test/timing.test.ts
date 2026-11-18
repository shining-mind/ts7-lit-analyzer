import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';

import {
  createDiscoverySession,
  type DiscoveryOptions,
} from '../dist/session/index.js';

const fileName = '/virtual/index.ts';
const source = dedent`
  export class TimedElement extends HTMLElement {
    count: number = 0;
  }
  customElements.define('x-timed', TimedElement);
`;

function options(collectTiming?: boolean): DiscoveryOptions {
  return {
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: [fileName],
    files: [{fileName, text: source}],
    ...(collectTiming !== undefined ? {collectTiming} : {}),
  };
}

test('timing is disabled and zeroed by default', async () => {
  const session = await createDiscoverySession(options());
  try {
    await session.collect();
    const timing = await session.getTimingInfo();
    assert.equal(timing.enabled, false);
    assert.deepEqual(timing.recentRequests, []);
    for (const value of Object.values(timing.totals)) {
      assert.equal(value, 0);
    }
  } finally {
    await session.dispose();
  }
});

test('instrumented collection exposes serializable timing and resets history', async () => {
  const session = await createDiscoverySession(options(true));
  try {
    await session.collect();
    const before = await session.getTimingInfo();
    assert.equal(before.enabled, true);
    assert.ok(before.totals.requestCount > 0);
    assert.ok(before.totals.roundTripMs > 0);
    assert.ok(before.totals.bytesSent > 0);
    assert.ok(before.totals.bytesReceived > 0);
    assert.ok(before.totals.serverTimeMs > 0);
    assert.ok(before.totals.transportOverheadMs >= 0);
    assert.ok(before.totals.nodesFetched > 0);

    const serialized = JSON.stringify(before);
    assert.ok(serialized.includes('requestCount'));
    assert.equal(serialized.includes(source), false);
    assert.equal(serialized.includes('canonicalProject'), false);
    assert.equal(serialized.includes('snapshotId'), false);

    await session.resetTimingInfo();
    const after = await session.getTimingInfo();
    assert.equal(after.enabled, true);
    assert.ok(after.totals.requestCount < before.totals.requestCount);
    assert.ok(after.recentRequests.length <= 1);
    assert.equal(after.totals.nodesFetched, 0);
    assert.equal(after.totals.nodesMaterialized, 0);
  } finally {
    await session.dispose();
  }
});
