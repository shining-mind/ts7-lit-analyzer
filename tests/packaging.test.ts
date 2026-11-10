import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {cp, mkdir, mkdtemp, readFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const packageNames = [
  'analyzer',
  'analyzer-ts7',
  'analyzer-cli',
  'vscode-extension',
];

test('packed artifacts install and run in a standalone fixture', async (t) => {
  const temporaryDirectory = await mkdtemp(join(tmpdir(), 'ts7-lit-pack-'));
  t.after(() => rm(temporaryDirectory, {recursive: true, force: true}));

  const archiveDirectory = join(temporaryDirectory, 'archives');
  const consumerDirectory = join(temporaryDirectory, 'consumer');
  await mkdir(archiveDirectory, {recursive: true});
  await cp(join(workspaceRoot, 'fixtures/standalone'), consumerDirectory, {
    recursive: true,
  });

  const archives = packageNames.map((packageName) => {
    const output = execFileSync(
      'pnpm',
      ['pack', '--pack-destination', archiveDirectory],
      {
        cwd: join(workspaceRoot, 'packages', packageName),
        encoding: 'utf8',
      }
    );
    return output.trim().split('\n').at(-1)!;
  });

  execFileSync(
    'npm',
    [
      'install',
      '--offline',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      ...archives,
    ],
    {cwd: consumerDirectory, stdio: 'pipe'}
  );

  const cliManifest = JSON.parse(
    await readFile(
      join(
        consumerDirectory,
        'node_modules/@ts7-lit-analyzer/analyzer-cli/package.json'
      ),
      'utf8'
    )
  );
  assert.equal(cliManifest.dependencies['@ts7-lit-analyzer/analyzer'], '0.0.0');

  for (const packageName of packageNames) {
    const installedName =
      packageName === 'vscode-extension'
        ? 'ts7-lit-extension'
        : `@ts7-lit-analyzer/${packageName}`;
    await readFile(
      join(consumerDirectory, 'node_modules', installedName, 'package.json'),
      'utf8'
    );
  }

  const output = execFileSync(
    process.execPath,
    [join(consumerDirectory, 'node_modules/.bin/ts7-lit-analyzer')],
    {encoding: 'utf8'}
  );
  assert.equal(output.trim(), 'ts7-lit-analyzer 0.0.0');

  const extensionBundle = await readFile(
    join(workspaceRoot, 'packages/vscode-extension/dist/index.js'),
    'utf8'
  );
  assert.doesNotMatch(extensionBundle, /@ts7-lit-analyzer\/analyzer/);

  execFileSync('pnpm', ['--filter', 'ts7-lit-extension', 'package:vsix'], {
    cwd: workspaceRoot,
    stdio: 'pipe',
  });
  const vsixPath = join(
    workspaceRoot,
    'packages/vscode-extension/dist/ts7-lit-extension-0.0.0.vsix'
  );
  const vsixContents = execFileSync('unzip', ['-l', vsixPath], {
    encoding: 'utf8',
  });
  assert.match(vsixContents, /extension\/package\.json/);
  assert.match(vsixContents, /extension\/LICENSE/);
  assert.doesNotMatch(vsixContents, /dist\/test\//);
});
