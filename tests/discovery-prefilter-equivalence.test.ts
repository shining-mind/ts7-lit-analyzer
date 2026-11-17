import assert from 'node:assert/strict';
import {existsSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';

import {ScriptTarget} from 'typescript/ast';
import {
  API,
  ModuleKind,
  ModuleResolutionKind,
  type RawCompilerOptions,
} from 'typescript/async';
import {createFileSystemLayer} from 'typescript/fs';

import type {
  DiscoveryResult,
  ProjectIdentity,
} from '../packages/cem-analyzer-ts7/dist/contracts.js';
import {createDiscoveryResult} from '../packages/cem-analyzer-ts7/dist/discovery/index.js';
import {
  buildModuleGraph,
  type ProjectSnapshot,
} from '../packages/cem-analyzer-ts7/dist/graph/index.js';
import {createSemanticCollector} from '../packages/cem-analyzer-ts7/dist/semantics/index.js';

const fixtureDirectory = fileURLToPath(
  new URL('fixtures/webcomponents/', import.meta.url)
);

function projectResult(result: DiscoveryResult) {
  return {
    issues: result.issues,
    components: result.components
      .map((component) => ({
        declaration: component.declaration,
        declarationEvidence: component.declarationEvidence,
        registrations: component.registrations,
        members: component.members.map((member) => ({
          memberName: member.memberName,
          declaration: member.declaration,
        })),
        analysis: component.analysis,
      }))
      .sort((a, b) =>
        a.declarationEvidence.id.localeCompare(b.declarationEvidence.id)
      ),
  };
}

test('fixture pre-filtered and unfiltered component records are equivalent', async () => {
  const configFileName = join(fixtureDirectory, 'tsconfig.json');
  const identity: ProjectIdentity = {
    id: 'prefilter-equivalence',
    currentDirectory: fixtureDirectory,
    configFileName,
  };
  const api = new API({cwd: fixtureDirectory, runExternalCode: false});
  const fileSystem = () => createFileSystemLayer([], {});
  const configSnapshot = await api.createSnapshot({
    fileSystem: fileSystem(),
    openProjects: [configFileName],
  });
  let rootFiles: string[];
  let compilerOptions: RawCompilerOptions;
  try {
    const configured = configSnapshot.getConfiguredProject(configFileName);
    assert.ok(configured);
    rootFiles = configured.parsedCommandLine.fileNames;
    compilerOptions = {
      strict: true,
      target: ScriptTarget.ESNext,
      module: ModuleKind.NodeNext,
      moduleResolution: ModuleResolutionKind.NodeNext,
      types: [],
      skipLibCheck: true,
      ...(configured.parsedCommandLine.options as RawCompilerOptions),
      allowJs: true,
      checkJs: false,
      maxNodeModuleJsDepth: 0,
    };
  } finally {
    await configSnapshot.dispose();
  }

  const createProgramSnapshot = async (
    roots: readonly string[],
    base?: ProjectSnapshot
  ): Promise<ProjectSnapshot> => {
    const params = {
      fileSystem: fileSystem(),
      createPrograms: [{rootFiles: roots, compilerOptions}],
    };
    const snapshot = base
      ? await base.snapshot.update(params)
      : await api.createSnapshot(params);
    const program = snapshot.operation.createdPrograms?.[0];
    assert.ok(program);
    return {snapshot, project: program.getProject()};
  };

  const initial = await createProgramSnapshot(rootFiles);
  const built = await buildModuleGraph({
    api,
    initial,
    rootFiles,
    compilerOptions,
    fileExists: (fileName) => existsSync(fileName),
    reload: (roots, base) => createProgramSnapshot(roots, base),
  });
  try {
    const semantics = createSemanticCollector({
      program: built.project.program,
      project: identity,
      snapshotId: `snapshot-${built.snapshot.id}`,
    });
    const filtered = await createDiscoveryResult(
      identity,
      `snapshot-${built.snapshot.id}`,
      1,
      built.graph,
      [],
      semantics,
      built.project
    );
    const unfiltered = await createDiscoveryResult(
      identity,
      `snapshot-${built.snapshot.id}`,
      1,
      built.graph,
      [],
      semantics,
      built.project,
      undefined,
      {filterCandidates: false}
    );

    assert.ok(filtered.components.length >= 8);
    assert.deepEqual(projectResult(filtered), projectResult(unfiltered));
  } finally {
    await built.snapshot.dispose();
    await api.close();
  }
});
