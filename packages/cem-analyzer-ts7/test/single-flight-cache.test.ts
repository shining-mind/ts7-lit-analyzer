import assert from 'node:assert/strict';
import {test} from 'node:test';

import {SingleFlightCache} from '../dist/discovery/single-flight-cache.js';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return {promise, resolve, reject};
}

test('coalesces concurrent resolutions into one produce call', async () => {
  const cache = new SingleFlightCache<string>();
  const gate = deferred<string>();
  let calls = 0;
  const produce = () => {
    calls++;
    return gate.promise;
  };

  const a = cache.resolve('k', produce);
  const b = cache.resolve('k', produce);
  const c = cache.resolve('k', produce);
  assert.equal(calls, 1);

  gate.resolve('value');
  assert.deepEqual(await Promise.all([a, b, c]), ['value', 'value', 'value']);
  assert.equal(cache.get('k'), 'value');
});

test('returns a settled value without re-producing', async () => {
  const cache = new SingleFlightCache<number>();
  let calls = 0;
  await cache.resolve('k', async () => {
    calls++;
    return 1;
  });

  const again = await cache.resolve('k', async () => {
    calls++;
    return 2;
  });
  assert.equal(again, 1);
  assert.equal(calls, 1);
});

test('invalidation during flight discards the stale result', async () => {
  const cache = new SingleFlightCache<string>();
  const gate = deferred<string>();
  const pending = cache.resolve('k', () => gate.promise);

  cache.invalidate('k');
  gate.resolve('stale');

  assert.equal(await pending, 'stale');
  assert.equal(cache.get('k'), undefined);

  const fresh = await cache.resolve('k', async () => 'fresh');
  assert.equal(fresh, 'fresh');
  assert.equal(cache.get('k'), 'fresh');
});

test('invalidate during flight makes the next resolve start fresh', async () => {
  const cache = new SingleFlightCache<string>();
  const staleGate = deferred<string>();
  let freshCalls = 0;
  const stale = cache.resolve('k', () => staleGate.promise);

  cache.invalidate('k');
  const fresh = cache.resolve('k', async () => {
    freshCalls++;
    return 'fresh';
  });

  assert.equal(freshCalls, 1);
  assert.equal(await fresh, 'fresh');
  staleGate.resolve('stale');
  assert.equal(await stale, 'stale');
  assert.equal(cache.get('k'), 'fresh');
});

test('staleInFlight discards in-flight results but keeps settled values', async () => {
  const cache = new SingleFlightCache<string>();
  await cache.resolve('settled', async () => 'keep');
  const gate = deferred<string>();
  const pending = cache.resolve('pending', () => gate.promise);

  cache.staleInFlight();
  gate.resolve('stale');

  assert.equal(await pending, 'stale');
  assert.equal(cache.get('pending'), undefined);
  assert.equal(cache.get('settled'), 'keep');

  const fresh = await cache.resolve('pending', async () => 'fresh');
  assert.equal(fresh, 'fresh');
  assert.equal(cache.get('pending'), 'fresh');
});

test('a resolution captured against an old generation does not cache after a bump', async () => {
  const cache = new SingleFlightCache<string>();
  const gate = deferred<string>();
  const generation = cache.currentGeneration;
  const pending = cache.resolve('k', () => gate.promise, generation);

  cache.bumpGeneration();
  gate.resolve('stale');

  assert.equal(await pending, 'stale');
  assert.equal(cache.get('k'), undefined);

  const fresh = await cache.resolve('k', async () => 'fresh');
  assert.equal(fresh, 'fresh');
  assert.equal(cache.get('k'), 'fresh');
});

test('an old-generation resolution of a fresh key after a bump is not cached', async () => {
  const cache = new SingleFlightCache<string>();
  const oldGeneration = cache.currentGeneration;
  cache.bumpGeneration();

  const stale = await cache.resolve('k', async () => 'stale', oldGeneration);
  assert.equal(stale, 'stale');
  assert.equal(cache.get('k'), undefined);

  const fresh = await cache.resolve('k', async () => 'fresh');
  assert.equal(fresh, 'fresh');
  assert.equal(cache.get('k'), 'fresh');
});

test('a fresh resolve does not join a stale-generation in-flight promise', async () => {
  const cache = new SingleFlightCache<string>();
  const oldGeneration = cache.currentGeneration;
  cache.bumpGeneration();
  const staleGate = deferred<string>();
  let freshCalls = 0;

  const stale = cache.resolve('k', () => staleGate.promise, oldGeneration);
  const fresh = cache.resolve('k', async () => {
    freshCalls++;
    return 'fresh';
  });

  assert.equal(freshCalls, 1);
  assert.equal(await fresh, 'fresh');
  staleGate.resolve('stale');
  assert.equal(await stale, 'stale');
  assert.equal(cache.get('k'), 'fresh');
});

test('a failed resolution evicts its promise and a retry succeeds', async () => {
  const cache = new SingleFlightCache<string>();
  let calls = 0;
  const failing = cache.resolve('k', async () => {
    calls++;
    throw new Error('boom');
  });

  await assert.rejects(failing, /boom/);
  assert.equal(cache.get('k'), undefined);

  const retry = await cache.resolve('k', async () => {
    calls++;
    return 'ok';
  });
  assert.equal(retry, 'ok');
  assert.equal(calls, 2);
  assert.equal(cache.get('k'), 'ok');
});

test('concurrent callers share a failure and can retry after it settles', async () => {
  const cache = new SingleFlightCache<string>();
  const gate = deferred<string>();
  let calls = 0;
  const produce = () => {
    calls++;
    return gate.promise;
  };

  const a = cache.resolve('k', produce);
  const b = cache.resolve('k', produce);
  assert.equal(calls, 1);

  gate.reject(new Error('boom'));
  await assert.rejects(a, /boom/);
  await assert.rejects(b, /boom/);

  const retry = await cache.resolve('k', async () => 'ok');
  assert.equal(retry, 'ok');
});

test('invalidate evicts a settled value so the next resolve re-produces', async () => {
  const cache = new SingleFlightCache<number>();
  await cache.resolve('k', async () => 1);
  cache.invalidate('k');
  assert.equal(cache.get('k'), undefined);

  let calls = 0;
  const value = await cache.resolve('k', async () => {
    calls++;
    return 2;
  });
  assert.equal(value, 2);
  assert.equal(calls, 1);
});
