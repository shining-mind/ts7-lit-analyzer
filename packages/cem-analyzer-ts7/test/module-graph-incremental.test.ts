import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';
import {ScriptTarget} from 'typescript/ast';
import {createFileSystemLayer} from 'typescript/fs';
import {
  API,
  ModuleKind,
  ModuleResolutionKind,
  type Project,
  type RawCompilerOptions,
  type Snapshot,
} from 'typescript/async';

import {
  buildModuleGraph,
  type ModuleGraph,
  type ProjectSnapshot,
} from '../dist/module-graph.js';

type BuiltGraph = ProjectSnapshot & {graph: ModuleGraph};

const consumerFileName = '/virtual/consumer.ts';
const componentFileName = '/virtual/component.js';
const consumerSource = "import './component.js';\n";
const componentSource = dedent`
  export class AddedElement extends HTMLElement {
    count = 0;
  }
  customElements.define('x-added', AddedElement);
`;
const compilerOptions: RawCompilerOptions = {
  strict: true,
  target: ScriptTarget.ESNext,
  module: ModuleKind.NodeNext,
  moduleResolution: ModuleResolutionKind.NodeNext,
  types: [],
  skipLibCheck: true,
  allowJs: true,
  checkJs: false,
  maxNodeModuleJsDepth: 0,
};

test('reuses unchanged importer resolutions during a graph update', async () => {
  const api = new API({cwd: '/virtual', runExternalCode: false});
  const overlays = new Map<string, string>();
  const resolutionCalls: string[] = [];
  let initial: BuiltGraph | undefined;
  let successor: BuiltGraph | undefined;

  try {
    initial = await buildGraph(api, overlays, resolutionCalls);
    const consumer = initial.graph.modules.find(
      (module) => module.fileName === consumerFileName
    );
    assert.ok(consumer);
    assert.deepEqual(resolutionCalls, ['./component.js']);
    resolutionCalls.length = 0;
    overlays.set(
      componentFileName,
      componentSource.replace('count = 0', "count = 'zero'")
    );

    successor = await buildGraph(api, overlays, resolutionCalls, initial, [
      componentFileName,
    ]);
    const successorConsumer = successor.graph.modules.find(
      (module) => module.fileName === consumerFileName
    );
    assert.ok(successorConsumer);
    assert.deepEqual(resolutionCalls, []);
    assert.strictEqual(successorConsumer.dependencies, consumer.dependencies);
    assert.deepEqual(successorConsumer.provenance, consumer.provenance);
  } finally {
    await successor?.snapshot.dispose();
    await initial?.snapshot.dispose();
    await api.close();
  }
});

async function buildGraph(
  api: API,
  overlays: ReadonlyMap<string, string>,
  resolutionCalls: string[],
  previous?: BuiltGraph,
  changedFiles: readonly string[] = []
) {
  const initialProgramRoots = previous
    ? previous.graph.modules.map((module) => module.fileName)
    : [consumerFileName];
  const initial = await createProgramSnapshot(
    api,
    overlays,
    initialProgramRoots,
    previous
  );
  return buildModuleGraph({
    api,
    initial,
    rootFiles: [consumerFileName],
    initialProgramRoots,
    compilerOptions,
    fileExists: (fileName) =>
      [consumerFileName, componentFileName].includes(fileName),
    reload: (rootFiles, base) =>
      createProgramSnapshot(api, overlays, rootFiles, base),
    ...(previous ? {previous: {graph: previous.graph, changedFiles}} : {}),
    createResolver: async () => {
      const resolver = await api.createModuleResolver(compilerOptions);
      const resolveModuleName = resolver.resolveModuleName.bind(resolver);
      resolver.resolveModuleName = async (
        moduleName,
        containingDirectory,
        resolutionMode,
        options
      ) => {
        resolutionCalls.push(moduleName);
        return resolveModuleName(
          moduleName,
          containingDirectory,
          resolutionMode,
          options
        );
      };
      return resolver;
    },
  });
}

async function createProgramSnapshot(
  api: API,
  overlays: ReadonlyMap<string, string>,
  rootFiles: readonly string[],
  base?: ProjectSnapshot
): Promise<ProjectSnapshot> {
  const files = new Map([
    [consumerFileName, consumerSource],
    [componentFileName, componentSource],
  ]);
  for (const [fileName, text] of overlays) files.set(fileName, text);
  const params = {
    fileSystem: createFileSystemLayer([...files]),
    createPrograms: [{rootFiles, compilerOptions}],
  };
  const snapshot: Snapshot = base
    ? await base.snapshot.update(params)
    : await api.createSnapshot(params);
  const program = snapshot.operation.createdPrograms?.[0];
  assert.ok(program, 'TypeScript must create the test program');
  const project: Project = program.getProject();
  return {snapshot, project};
}
