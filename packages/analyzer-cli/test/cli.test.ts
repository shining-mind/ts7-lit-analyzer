import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {test} from 'node:test';
import {fileURLToPath} from 'node:url';

import * as cli from '@ts7-lit-analyzer/analyzer-cli';

const binPath = fileURLToPath(new URL('../dist/bin.js', import.meta.url));

test('has no runtime module exports', () => {
  assert.deepEqual(Object.keys(cli), []);
});

test('bin prints the package version and exits successfully', () => {
  const result = spawnSync(process.execPath, [binPath], {encoding: 'utf8'});
  assert.equal(result.status, 0);
  assert.equal(result.stderr, '');
  assert.equal(result.stdout, 'ts7-lit-analyzer 0.0.0\n');
});
