import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {registerHooks} from 'node:module';
import {test} from 'node:test';

for (const name of [
  'analyzer-core',
  'cem-analyzer-ts7',
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
    const entryUrl = new URL(
      `../packages/${name}/${entry.import}`,
      import.meta.url
    ).href;
    if (name === 'vscode-extension') {
      const hooks = registerHooks({
        resolve(specifier, context, nextResolve) {
          if (specifier === 'vscode') {
            return {url: 'mock:vscode', shortCircuit: true};
          }
          return nextResolve(specifier, context);
        },
        load(url, context, nextLoad) {
          if (url === 'mock:vscode') {
            return {
              format: 'module',
              source: [
                'export const workspace = {};',
                'export const window = {};',
                'export class Uri {}',
                'export class TabInputText {}',
              ].join('\n'),
              shortCircuit: true,
            };
          }
          return nextLoad(url, context);
        },
      });
      try {
        const extension = await import(entryUrl);
        assert.equal(typeof extension.activate, 'function');
        assert.equal(typeof extension.deactivate, 'function');
      } finally {
        hooks.deregister();
      }
    } else {
      await import(entryUrl);
    }
    assert.ok(
      (
        await readFile(
          new URL(`../packages/${name}/${entry.types}`, import.meta.url)
        )
      ).length > 0
    );
  });
}
