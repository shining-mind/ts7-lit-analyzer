import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const fixtureDirectory = fileURLToPath(
  new URL('fixtures/legacy/', import.meta.url)
);

test('legacy baseline reports an incompatible property binding', () => {
  const result = spawnSync(
    join(fixtureDirectory, 'node_modules/.bin/lit-analyzer'),
    [
      'src/incompatible-type-binding.ts',
      '--strict',
      '--format',
      'list',
      '--noColor',
    ],
    {cwd: fixtureDirectory, encoding: 'utf8'}
  );

  assert.equal(result.status, 1);
  const output = `${result.stdout}${result.stderr}`;
  assert.match(
    output,
    /6:3\s+error\s+Type '"bad"' is not assignable to 'number'/
  );
  assert.match(output, /1 error, 0 warnings/);
  assert.doesNotMatch(output, /4:46/);
});
