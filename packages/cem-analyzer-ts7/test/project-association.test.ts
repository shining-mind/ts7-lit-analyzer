import assert from 'node:assert/strict';
import {test} from 'node:test';

import {createProjectAssociationSession} from '../dist/session/project-association.js';

const aConfig = '/virtual/a/tsconfig.json';
const bConfig = '/virtual/b/tsconfig.json';
const sharedFile = '/virtual/a/shared.ts';
const inferredFile = '/virtual/inferred.ts';

function config(include: readonly string[]): string {
  return JSON.stringify({
    compilerOptions: {strict: true},
    files: include,
  });
}

const files = [
  {fileName: aConfig, text: config(['./shared.ts'])},
  {fileName: bConfig, text: config(['../a/shared.ts'])},
  {fileName: sharedFile, text: 'export const shared = 1;\n'},
  {fileName: inferredFile, text: 'export const inferred = 1;\n'},
];

test('uses TS7 default-project routing and excludes synthetic programs', async () => {
  const session = await createProjectAssociationSession({
    currentDirectory: '/virtual',
    configFileNames: [aConfig, bConfig],
    files,
  });
  try {
    const association = await session.associate(sharedFile, files[2].text);
    assert.equal(association.kind, 'configured');
    assert.equal(association.configFileName, aConfig);
    assert.equal(association.id, aConfig);
  } finally {
    await session.dispose();
  }
});

test('routes a document without a configured project to inferred identity', async () => {
  const session = await createProjectAssociationSession({
    currentDirectory: '/virtual',
    files,
  });
  try {
    const association = await session.associate(inferredFile, files[3].text);
    assert.equal(association.kind, 'inferred');
    assert.equal(association.configFileName, undefined);
    assert.equal(association.currentDirectory, '/virtual');
  } finally {
    await session.dispose();
  }
});
