import assert from 'node:assert/strict';

import {API} from 'typescript/async';
import {createFileSystemLayer} from 'typescript/fs';

const aConfig = '/virtual/a/tsconfig.json';
const bConfig = '/virtual/b/tsconfig.json';
const sharedFile = '/virtual/a/shared.ts';
const inferredFile = '/virtual/inferred.ts';

function config(include) {
  return JSON.stringify({compilerOptions: {strict: true}, files: include});
}

const files = [
  {fileName: aConfig, text: config(['./shared.ts'])},
  {fileName: bConfig, text: config(['../a/shared.ts'])},
  {fileName: sharedFile, text: 'export const shared = 1;\n'},
  {fileName: inferredFile, text: 'export const inferred = 1;\n'},
];

const api = new API({cwd: '/virtual', runExternalCode: false});
let snapshot;

function parameters(openFiles) {
  return {
    fileSystem: createFileSystemLayer(
      files.map((file) => [file.fileName, file.text])
    ),
    openProjects: [aConfig, bConfig],
    openFiles,
    ensurePrograms: true,
  };
}

try {
  snapshot = await api.createSnapshot(parameters([sharedFile]));
  const configured = await snapshot.getDefaultProjectForFile(sharedFile);
  assert.ok(configured);
  assert.equal(configured.configFileName, aConfig);
  assert.equal(configured.id, aConfig);

  const previous = snapshot;
  snapshot = await previous.update(parameters([inferredFile]));
  await previous.dispose();

  const inferred = await snapshot.getDefaultProjectForFile(inferredFile);
  assert.ok(inferred);
  assert.equal(inferred.configFileName, undefined);
  assert.equal(inferred.currentDirectory, '/virtual');

  console.log(
    JSON.stringify(
      {
        configured: {
          id: configured.id,
          configFileName: configured.configFileName,
        },
        inferred: {
          id: inferred.id,
          currentDirectory: inferred.currentDirectory,
        },
      },
      null,
      2
    )
  );
} finally {
  await snapshot?.dispose();
  await api.close();
}
