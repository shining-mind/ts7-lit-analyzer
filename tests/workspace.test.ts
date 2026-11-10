import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {test} from 'node:test';

for (const name of [
  'analyzer',
  'analyzer-ts7',
  'analyzer-cli',
  'vscode-extension',
]) {
  test(`${name} exposes its built entry point`, async () => {
    const manifest = JSON.parse(
      await readFile(
        new URL(`../packages/${name}/package.json`, import.meta.url),
        'utf8'
      )
    );
    const entry = manifest.exports['.'];
    await import(
      new URL(`../packages/${name}/${entry.import}`, import.meta.url).href
    );
    assert.ok(
      (
        await readFile(
          new URL(`../packages/${name}/${entry.types}`, import.meta.url)
        )
      ).length > 0
    );
  });
}
