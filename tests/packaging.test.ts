import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdir, mkdtemp, readFile, rm, writeFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {test} from 'node:test';

const workspaceRoot = fileURLToPath(new URL('../', import.meta.url));
const packageNames = [
  'analyzer',
  'cem-analyzer-ts7',
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
  await mkdir(consumerDirectory, {recursive: true});
  await writeFile(
    join(consumerDirectory, 'package.json'),
    JSON.stringify(
      {
        name: 'ts7-lit-analyzer-standalone-fixture',
        private: true,
        type: 'module',
      },
      null,
      2
    )
  );

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

  const discoveryRequire = createRequire(
    join(workspaceRoot, 'packages/cem-analyzer-ts7/package.json')
  );
  const productionDependencies = [
    'custom-elements-manifest',
    'typescript',
    `@typescript/typescript-${process.platform}-${process.arch}`,
  ];
  const typeScriptRequire = createRequire(
    discoveryRequire.resolve('typescript/package.json')
  );
  for (const dependencyName of productionDependencies) {
    const dependencyRequire = dependencyName.startsWith('@typescript/')
      ? typeScriptRequire
      : discoveryRequire;
    const dependencyManifest = dependencyRequire.resolve(
      `${dependencyName}/package.json`
    );
    const output = execFileSync(
      'pnpm',
      ['pack', '--pack-destination', archiveDirectory],
      {cwd: dirname(dependencyManifest), encoding: 'utf8'}
    );
    archives.push(output.trim().split('\n').at(-1)!);
  }

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

  const discoveryPackage = await import(
    pathToFileURL(
      join(
        consumerDirectory,
        'node_modules/@ts7-lit-analyzer/cem-analyzer-ts7/dist/index.js'
      )
    ).href
  );
  assert.equal(discoveryPackage.cemAnalyzerTs7PackageVersion, '0.0.0');
  const discoverySession = await discoveryPackage.createDiscoverySession({
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: ['/virtual/index.ts'],
    files: [
      {
        fileName: '/virtual/index.ts',
        text: `export class PackedElement extends HTMLElement { value: number = 0; }
customElements.define('packed-element', PackedElement);`,
      },
    ],
  });
  try {
    const discoveryResult = await discoverySession.collect();
    assert.equal(
      discoveryResult.components[0].declaration.members[0].type.text,
      'number'
    );
    assert.equal(
      discoveryResult.components[0].declaration.tagName,
      'packed-element'
    );
  } finally {
    await discoverySession.dispose();
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
