import assert from 'node:assert/strict';
import {mkdtemp, mkdir, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {test} from 'node:test';

import type {ClassField} from 'custom-elements-manifest';
import dedent from 'ts-dedent';
import {
  isClassDeclaration,
  isIdentifier,
  isPropertyDeclaration,
  type PropertyDeclaration,
  type SourceFile,
} from 'typescript/ast';
import {API, type Snapshot} from 'typescript/async';
import {createFileSystemLayer} from 'typescript/fs';

import type {DiscoveryResult} from '../dist/contracts.js';
import {SessionConfiguration} from '../dist/session/configuration.js';
import {
  createDiscoverySession,
  type DiscoveryOptions,
} from '../dist/session/index.js';

const appConfig = '/virtual/app/tsconfig.json';
const libConfig = '/virtual/lib/tsconfig.json';
const appFile = '/virtual/app/index.ts';
const counterFile = '/virtual/lib/src/counter.ts';
const counterSource = dedent`
  export class CounterElement extends HTMLElement {
    count: number = 0;
  }
  customElements.define('x-counter', CounterElement);
`;

function options(eagerness: 'lazy'): DiscoveryOptions & {eagerness: 'lazy'};
function options(): DiscoveryOptions;
function options(eagerness?: 'lazy'): DiscoveryOptions {
  return {
    mode: 'consumer',
    currentDirectory: '/virtual/app',
    configFileName: appConfig,
    ...(eagerness ? {eagerness} : {}),
    files: [
      {
        fileName: appConfig,
        text: JSON.stringify({
          compilerOptions: {
            strict: true,
            target: 'esnext',
            module: 'nodenext',
            moduleResolution: 'nodenext',
          },
          files: ['./index.ts'],
          references: [{path: '../lib'}],
        }),
      },
      {
        fileName: libConfig,
        text: JSON.stringify({
          compilerOptions: {
            composite: true,
            declaration: true,
            rootDir: './src',
            outDir: './dist',
            strict: true,
            target: 'esnext',
            module: 'nodenext',
            moduleResolution: 'nodenext',
          },
          files: ['./src/counter.ts'],
        }),
      },
      {
        fileName: appFile,
        text: "export {CounterElement} from '../lib/dist/counter.js';\n",
      },
      {fileName: counterFile, text: counterSource},
    ],
  };
}

function component(result: DiscoveryResult) {
  const found = result.components.find(
    (candidate) => candidate.declaration.name === 'CounterElement'
  );
  assert.ok(
    found,
    `CounterElement was not discovered: ${JSON.stringify(result.issues)}`
  );
  return found;
}

function countText(result: DiscoveryResult): string | undefined {
  const member = component(result).declaration.members?.find(
    (candidate) => candidate.name === 'count'
  ) as ClassField | undefined;
  return member?.type?.text;
}

test('redirects referenced output imports to source in eager mode', async () => {
  const session = await createDiscoverySession(options());
  try {
    const initial = await session.collect();
    assert.equal(component(initial).declarationEvidence.fileName, counterFile);
    assert.equal(countText(initial), 'number');

    const updated = await session.update([
      {
        fileName: counterFile,
        text: counterSource.replace(
          'count: number = 0',
          "count: string = 'zero'"
        ),
      },
    ]);

    assert.equal(countText(updated), 'string');
    assert.notEqual(updated.snapshotId, initial.snapshotId);
    assert.equal(countText(initial), 'number');
  } finally {
    await session.dispose();
  }
});

test('counts checker module fallbacks only when instrumentation is enabled', async () => {
  const plain = await createDiscoverySession(options());
  try {
    const result = await plain.collect();
    assert.equal('moduleResolutionFallbackCount' in result, false);
  } finally {
    await plain.dispose();
  }

  const eager = await createDiscoverySession({
    ...options(),
    collectTiming: true,
  });
  try {
    const initial = await eager.collect();
    assert.ok(
      initial.moduleResolutionFallbackCount !== undefined &&
        initial.moduleResolutionFallbackCount > 0
    );

    const reused = await eager.update([]);
    assert.equal(reused.moduleResolutionFallbackCount, 0);
  } finally {
    await eager.dispose();
  }

  const lazy = await createDiscoverySession({
    ...options('lazy'),
    collectTiming: true,
  });
  try {
    const initial = await lazy.collectScope([appFile]);
    assert.ok(
      initial.moduleResolutionFallbackCount !== undefined &&
        initial.moduleResolutionFallbackCount > 0
    );

    const reused = await lazy.update([]);
    assert.equal(reused.moduleResolutionFallbackCount, 0);
  } finally {
    await lazy.dispose();
  }
});

test('enriches referenced output imports and overlays in lazy mode', async () => {
  const session = await createDiscoverySession(options('lazy'));
  try {
    const scoped = await session.collectScope([appFile]);
    const counter = component(scoped);
    assert.equal(counter.declarationEvidence.fileName, counterFile);

    const enriched = await session.enrich([counter.declarationEvidence.id]);
    assert.equal(
      component(enriched).declarationEvidence.id,
      counter.declarationEvidence.id
    );
    assert.deepEqual(
      component(enriched).declaration.members?.map((member) => member.name),
      ['count']
    );
    const materialized = await session.materializeTypes();
    assert.equal(countText(materialized), 'number');
    const initialType = await session.getMemberType(
      counter.declarationEvidence.id,
      'count'
    );
    assert.equal(initialType?.text, 'number');

    const updated = await session.update([
      {
        fileName: counterFile,
        text: counterSource.replace(
          'count: number = 0',
          "count: string = 'zero'"
        ),
      },
    ]);
    await session.enrich([counter.declarationEvidence.id]);
    const updatedType = await session.getMemberType(
      counter.declarationEvidence.id,
      'count'
    );

    assert.equal(updatedType?.text, 'string');
    assert.notEqual(updated.snapshotId, scoped.snapshotId);
    assert.equal(countText(materialized), 'number');
    assert.notEqual(
      updatedType?.reference.snapshotId,
      initialType?.reference.snapshotId
    );
  } finally {
    await session.dispose();
  }
});

test('restores referenced source after successive overlays and scope refreshes', async () => {
  const session = await createDiscoverySession(options('lazy'));
  try {
    const run = async () => {
      const scoped = await session.collectScope([appFile]);
      const id = component(scoped).declarationEvidence.id;
      await session.enrich([id]);
      return session.materializeTypes();
    };

    assert.equal(countText(await run()), 'number');
    await session.update([
      {
        fileName: counterFile,
        text: counterSource.replace(
          'count: number = 0',
          "count: string = 'zero'"
        ),
      },
    ]);
    assert.equal(countText(await run()), 'string');
    await session.update([
      {
        fileName: counterFile,
        text: counterSource.replace(
          'count: number = 0',
          'count: boolean = true'
        ),
      },
    ]);
    assert.equal(countText(await run()), 'boolean');

    await session.removeOverlays([counterFile]);
    assert.equal(countText(await run()), 'number');
  } finally {
    await session.dispose();
  }
});

test('restores disk-backed referenced source after overlay removal', async () => {
  const root = await mkdtemp(join(tmpdir(), 'ts7-lit-references-'));
  for (const file of options().files ?? []) {
    const fileName = file.fileName.replace('/virtual', root);
    await mkdir(dirname(fileName), {recursive: true});
    await writeFile(fileName, file.text);
  }
  const appDirectory = join(root, 'app');
  const diskCounterFile = join(root, 'lib/src/counter.ts');
  const session = await createDiscoverySession({
    mode: 'consumer',
    currentDirectory: appDirectory,
    configFileName: join(appDirectory, 'tsconfig.json'),
    eagerness: 'lazy',
    retentionBound: 1,
  });
  try {
    const run = async () => {
      const scoped = await session.collectScope([
        join(appDirectory, 'index.ts'),
      ]);
      const id = component(scoped).declarationEvidence.id;
      await session.enrich([id]);
      return session.materializeTypes();
    };

    assert.equal(countText(await run()), 'number');
    await session.update([
      {
        fileName: diskCounterFile,
        text: counterSource.replace(
          'count: number = 0',
          "count: string = 'zero'"
        ),
      },
    ]);
    assert.equal(countText(await run()), 'string');
    await session.update([
      {
        fileName: diskCounterFile,
        text: counterSource.replace(
          'count: number = 0',
          'count: boolean = true'
        ),
      },
    ]);
    assert.equal(countText(await run()), 'boolean');

    await session.removeOverlays([diskCounterFile]);
    assert.equal(countText(await run()), 'number');
  } finally {
    await session.dispose();
    await rm(root, {recursive: true, force: true});
  }
});

function referencedCountDeclaration(
  sourceFile: SourceFile
): PropertyDeclaration {
  for (const statement of sourceFile.statements) {
    if (!isClassDeclaration(statement)) {
      continue;
    }
    for (const member of statement.members) {
      if (
        isPropertyDeclaration(member) &&
        isIdentifier(member.name) &&
        member.name.text === 'count'
      ) {
        return member;
      }
    }
  }
  throw new Error('Referenced count declaration was not found.');
}

test('retains the declared-type anomaly and location-based alternatives', async () => {
  const api = new API({cwd: '/virtual/app'});
  const configuration = new SessionConfiguration(options(), '/virtual/app');
  let snapshot: Snapshot | undefined;
  let updatedSnapshot: Snapshot | undefined;
  try {
    await configuration.read(api);
    const files = options().files ?? [];
    const createSnapshot = (counterText: string) => ({
      fileSystem: createFileSystemLayer(
        files.map((file) => [
          file.fileName,
          file.fileName === counterFile ? counterText : file.text,
        ])
      ),
      createPrograms: [
        {
          rootFiles: configuration.roots,
          compilerOptions: configuration.compiler,
          options: {projectReferences: configuration.references},
        },
      ],
    });
    const propertyTypes = async (currentSnapshot: Snapshot) => {
      const project =
        currentSnapshot.operation.createdPrograms?.[0]?.getProject();
      assert.ok(project);
      const sourceFile = await project.program.getSourceFile(counterFile);
      assert.ok(sourceFile);
      const declaration = referencedCountDeclaration(sourceFile);
      const symbol = await project.checker.getSymbolOfDeclaration(declaration);
      const declared = await project.checker.getDeclaredTypeOfSymbol(symbol);
      const location = await project.checker.getTypeOfSymbolAtLocation(
        symbol,
        declaration
      );
      return {
        declared: await project.checker.typeToString(declared, declaration),
        location: await project.checker.typeToString(location, declaration),
      };
    };

    snapshot = await api.createSnapshot(createSnapshot(counterSource));
    assert.deepEqual(await propertyTypes(snapshot), {
      declared: 'any',
      location: 'number',
    });

    updatedSnapshot = await snapshot.update(
      createSnapshot(
        counterSource.replace('count: number = 0', "count: string = 'zero'")
      )
    );
    assert.deepEqual(await propertyTypes(updatedSnapshot), {
      declared: 'any',
      location: 'string',
    });
    assert.deepEqual(await propertyTypes(snapshot), {
      declared: 'any',
      location: 'number',
    });
  } finally {
    await updatedSnapshot?.dispose();
    await snapshot?.dispose();
    await api.close();
  }
});
