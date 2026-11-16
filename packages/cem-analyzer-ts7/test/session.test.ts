import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';

import dedent from 'ts-dedent';

import {
  createDiscoverySession,
  type DiscoveryOptions,
} from '../dist/session.js';
import type {SemanticReference} from '../src/contracts.js';
import type {DiscoverySession} from '../src/session.js';

const fileName = '/virtual/index.ts';
const initialSource = dedent`const stringValue: string = 'bad';
const numberValue: number = 1;
const otherString: string = 'also bad';
stringValue;
numberValue;
otherString;
`;

async function referenceAt(
  session: DiscoverySession,
  fileName: string,
  source: string,
  needle: string,
  offset = 0
): Promise<SemanticReference> {
  const position = source.indexOf(needle);
  assert.notEqual(position, -1, `missing test position: ${needle}`);
  const reference = await session.getTypeAtPosition(
    fileName,
    position + offset
  );
  assert.ok(reference, `missing type at ${needle}`);
  return reference;
}

function options(text = initialSource): DiscoveryOptions {
  return {
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: [fileName],
    files: [{fileName, text}],
  };
}

test('uses real same-project and same-snapshot types for assignability', async () => {
  const session = await createDiscoverySession(options());
  try {
    const stringType = await referenceAt(
      session,
      fileName,
      initialSource,
      'stringValue;'
    );
    const numberType = await referenceAt(
      session,
      fileName,
      initialSource,
      'numberValue;'
    );
    const otherStringType = await referenceAt(
      session,
      fileName,
      initialSource,
      'otherString;'
    );

    assert.equal(await session.isAssignable(stringType, numberType), false);
    assert.equal(await session.isAssignable(stringType, otherStringType), true);
    assert.equal(stringType.projectId, numberType.projectId);
    assert.equal(stringType.snapshotId, numberType.snapshotId);
    assert.equal((await session.collect()).snapshotId, stringType.snapshotId);
  } finally {
    await session.dispose();
  }
});

test('rejects references from another project', async () => {
  const first = await createDiscoverySession(options());
  const second = await createDiscoverySession(options());
  try {
    const firstType = await referenceAt(
      first,
      fileName,
      initialSource,
      "'bad'",
      1
    );
    const secondType = await referenceAt(second, fileName, initialSource, '1');

    await assert.rejects(
      first.isAssignable(firstType, secondType),
      /project|snapshot/i
    );
    await assert.rejects(
      first.isAssignable({...firstType, id: 'forged'}, firstType),
      /reference|snapshot/i
    );
  } finally {
    await first.dispose();
    await second.dispose();
  }
});

test('rejects old references after an overlay creates a new snapshot', async () => {
  const session = await createDiscoverySession(options());
  try {
    const oldSource = await referenceAt(
      session,
      fileName,
      initialSource,
      "'bad'",
      1
    );
    const oldTarget = await referenceAt(session, fileName, initialSource, '1');
    const updatedSource = initialSource.replace(
      'numberValue: number = 1',
      'numberValue: number = 2'
    );
    const result = await session.update([{fileName, text: updatedSource}]);

    assert.notEqual(result.snapshotId, oldSource.snapshotId);
    assert.equal(result.containsOverlays, true);
    assert.deepEqual(result.overlayFiles, [fileName]);
    await assert.rejects(
      session.isAssignable(oldSource, oldTarget),
      /snapshot|reference/i
    );

    const newSource = await referenceAt(
      session,
      fileName,
      updatedSource,
      'stringValue;'
    );
    const newTarget = await referenceAt(
      session,
      fileName,
      updatedSource,
      'numberValue;'
    );
    assert.equal(await session.isAssignable(newSource, newTarget), false);
  } finally {
    await session.dispose();
  }
});

test('loads disk projects and dependencies with in-memory files and overlays', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cem-ts7-session-'));
  const configFileName = join(directory, 'tsconfig.json');
  const consumerFileName = join(directory, 'consumer.ts');
  const dependencyDirectory = join(
    directory,
    'node_modules',
    'disk-dependency'
  );
  const dependencyFileName = join(dependencyDirectory, 'index.js');
  const source = dedent`import {DiskElement} from 'disk-dependency';
const element = new DiskElement();
element.count = 'bad';
const stringValue = 'bad';
const numberValue = 1;
`;
  let session: DiscoverySession | undefined;

  try {
    await mkdir(dependencyDirectory, {recursive: true});
    await writeFile(
      configFileName,
      JSON.stringify({
        compilerOptions: {
          strict: true,
          target: 'esnext',
          module: 'nodenext',
          moduleResolution: 'nodenext',
          types: [],
        },
        files: ['./consumer.ts'],
      })
    );
    await writeFile(consumerFileName, source);
    await writeFile(
      join(dependencyDirectory, 'package.json'),
      JSON.stringify({
        name: 'disk-dependency',
        type: 'module',
        exports: './index.js',
      })
    );
    await writeFile(
      dependencyFileName,
      'export class DiskElement { count = 0; }\n'
    );

    session = await createDiscoverySession({
      mode: 'consumer',
      configFileName,
      files: [
        {
          fileName: dependencyFileName,
          text: "export class DiskElement { count = 'zero'; }\n",
        },
      ],
    });
    const numberType = await referenceAt(
      session,
      consumerFileName,
      source,
      '1'
    );
    const stringTarget = await referenceAt(
      session,
      consumerFileName,
      source,
      'element.count',
      'element.'.length
    );
    assert.equal(await session.isAssignable(numberType, stringTarget), false);

    await session.update([
      {
        fileName: dependencyFileName,
        text: 'export class DiskElement { count = true; }\n',
      },
    ]);
    const stringType = await referenceAt(
      session,
      consumerFileName,
      source,
      "'bad'",
      1
    );
    const booleanTarget = await referenceAt(
      session,
      consumerFileName,
      source,
      'element.count',
      'element.'.length
    );
    assert.equal(await session.isAssignable(stringType, booleanTarget), false);
  } finally {
    await session?.dispose();
    await rm(directory, {recursive: true, force: true});
  }
});

test('dispose is idempotent and rejects every semantic operation afterward', async () => {
  const session = await createDiscoverySession(options());
  const source = await referenceAt(
    session,
    fileName,
    initialSource,
    "'bad'",
    1
  );
  await session.dispose();
  await session.dispose();

  await assert.rejects(session.collect(), /disposed/i);
  await assert.rejects(session.update([]), /disposed/i);
  await assert.rejects(session.getTypeAtPosition(fileName, 0), /disposed/i);
  await assert.rejects(session.isAssignable(source, source), /disposed/i);
});
