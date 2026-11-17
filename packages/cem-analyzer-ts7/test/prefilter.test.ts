import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';
import {ScriptTarget} from 'typescript/ast';
import {
  API,
  ModuleKind,
  ModuleResolutionKind,
  type RawCompilerOptions,
} from 'typescript/async';
import {createFileSystemLayer} from 'typescript/fs';

import type {DiscoveryResult, ProjectIdentity} from '../dist/contracts.js';
import {createDiscoveryResult} from '../dist/discovery/index.js';
import type {ModuleGraph} from '../dist/graph/index.js';
import {createSemanticCollector} from '../dist/semantics/index.js';

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
  experimentalDecorators: true,
};

const project: ProjectIdentity = {
  id: 'prefilter-test',
  currentDirectory: '/virtual',
};

const files: Record<string, string> = {
  '/virtual/node_modules/lit/package.json': JSON.stringify({
    name: 'lit',
    type: 'module',
    exports: {'.': './index.d.ts', './decorators': './decorators.d.ts'},
  }),
  '/virtual/node_modules/lit/index.d.ts':
    'export declare class LitElement extends HTMLElement {}',
  '/virtual/node_modules/lit/decorators.d.ts': dedent`
    export declare function customElement(tagName: string): any;
    export declare function property(options?: {attribute?: string | boolean; reflect?: boolean}): any;
    export declare function state(): any;
  `,
  '/virtual/index.ts': dedent`
    import {LitElement} from 'lit';
    import {customElement, property} from 'lit/decorators';
    export {VanillaElement as RenamedElement} from './vanilla.js';
    @customElement('x-lit')
    export class LitComponent extends LitElement {
      @property({type: Number}) count = 0;
    }
    export class PlainService {
      value = 1;
    }
    export class HelperUtil {
      compute(): number {
        return 2;
      }
    }
  `,
  '/virtual/vanilla.ts': dedent`
    export class VanillaElement extends HTMLElement {
      label = 'x';
    }
    customElements.define('x-vanilla', VanillaElement);
    export class NotAComponent {
      data = 'y';
    }
  `,
};

const rootFiles = ['/virtual/index.ts', '/virtual/vanilla.ts'];

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

test('pre-filtered and unfiltered collection discover identical components', async () => {
  const api = new API({cwd: '/virtual', runExternalCode: false});
  const snapshot = await api.createSnapshot({
    fileSystem: createFileSystemLayer(Object.entries(files), {}),
    createPrograms: [{rootFiles, compilerOptions}],
  });
  try {
    const analysisProject = snapshot.operation.createdPrograms![0].getProject();
    const graph: ModuleGraph = {
      rootFiles,
      modules: rootFiles.map((fileName) => ({
        fileName,
        provenance: [],
        dependencies: [],
      })),
      unresolvedModules: [],
    };
    const semantics = createSemanticCollector({
      program: analysisProject.program,
      project,
      snapshotId: 'snapshot-prefilter',
    });
    const filtered = await createDiscoveryResult(
      project,
      'snapshot-prefilter',
      1,
      graph,
      [],
      semantics,
      analysisProject
    );
    const unfiltered = await createDiscoveryResult(
      project,
      'snapshot-prefilter',
      1,
      graph,
      [],
      semantics,
      analysisProject,
      undefined,
      {filterCandidates: false}
    );

    assert.deepEqual(
      filtered.components.map((c) => c.declaration.name).sort(),
      ['LitComponent', 'VanillaElement']
    );
    assert.deepEqual(projectResult(filtered), projectResult(unfiltered));
  } finally {
    await snapshot.dispose();
    await api.close();
  }
});

test('candidate filtering skips non-component exported classes', async () => {
  const api = new API({cwd: '/virtual', runExternalCode: false});
  const snapshot = await api.createSnapshot({
    fileSystem: createFileSystemLayer(Object.entries(files), {}),
    createPrograms: [{rootFiles, compilerOptions}],
  });
  try {
    const analysisProject = snapshot.operation.createdPrograms![0].getProject();
    const semantics = createSemanticCollector({
      program: analysisProject.program,
      project,
      snapshotId: 'snapshot-prefilter',
    });
    const all = await semantics.collectSourceFile('/virtual/index.ts');
    assert.deepEqual(
      all.map((component) => component.declaration.name).sort(),
      ['HelperUtil', 'LitComponent', 'PlainService', 'VanillaElement']
    );

    const candidates = new Set(['/virtual/index.ts#LitComponent']);
    const filtered = await semantics.collectSourceFile('/virtual/index.ts', {
      candidates,
    });
    assert.deepEqual(
      filtered.map((component) => component.declaration.name),
      ['LitComponent']
    );
  } finally {
    await snapshot.dispose();
    await api.close();
  }
});
