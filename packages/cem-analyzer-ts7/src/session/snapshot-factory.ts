import type {API} from 'typescript/async';

import type {DiscoveryOperationOptions, ProjectIdentity} from '../contracts.js';
import {
  buildModuleGraph,
  type ModuleGraph,
  type ProjectSnapshot,
} from '../graph/module-graph.js';
import {
  createSemanticCollector,
  type SemanticCollector,
} from '../semantics/collector.js';
import type {SessionConfiguration} from './configuration.js';
import {checkCancelled} from './operations.js';

export interface DiscoverySnapshot extends ProjectSnapshot {
  graph: ModuleGraph;
  indexGraph?: ModuleGraph | undefined;
  snapshotId: string;
  semantics: SemanticCollector;
}

export interface SnapshotBuildOptions {
  graphRoots: readonly string[];
  indexGraphRoots?: readonly string[];
  overlays: ReadonlyMap<string, string>;
  retainProgramRoots?: readonly string[];
  operation?: DiscoveryOperationOptions;
  previous?: {
    snapshot: DiscoverySnapshot;
    changedFiles: readonly string[];
  };
}

/**
 * Constructs program snapshots and the derived module graph. The program can
 * stay project-wide while the graph is seeded from a narrower scope; snapshot
 * updates reuse the previous native snapshot as their base.
 */
export class SnapshotFactory {
  private readonly api: API;
  private readonly configuration: SessionConfiguration;
  private readonly project: ProjectIdentity;

  constructor(
    api: API,
    configuration: SessionConfiguration,
    project: ProjectIdentity
  ) {
    this.api = api;
    this.configuration = configuration;
    this.project = project;
  }

  async build(options: SnapshotBuildOptions): Promise<DiscoverySnapshot> {
    checkCancelled(options.operation);
    const initialProgramRoots = options.previous
      ? [
          ...new Set([
            ...this.configuration.roots,
            ...options.previous.snapshot.graph.modules.map(
              (module) => module.fileName
            ),
          ]),
        ]
      : this.configuration.roots;
    const initial = await this.createProgramSnapshot(
      initialProgramRoots,
      options.overlays,
      options.previous?.snapshot
    );
    let current: ProjectSnapshot = initial;
    try {
      checkCancelled(options.operation);
      const built = await buildModuleGraph({
        api: this.api,
        initial,
        rootFiles: options.graphRoots,
        initialProgramRoots,
        ...(options.retainProgramRoots
          ? {retainProgramRoots: options.retainProgramRoots}
          : {}),
        compilerOptions: this.configuration.compiler,
        fileExists: (fileName) =>
          this.configuration.fileExists(fileName, options.overlays),
        reload: (rootFiles, base) =>
          this.createProgramSnapshot(rootFiles, options.overlays, base),
        ...(options.previous
          ? {
              previous: {
                graph: options.previous.snapshot.graph,
                changedFiles: options.previous.changedFiles,
              },
            }
          : {}),
      });
      current = built;
      checkCancelled(options.operation);
      let final = built;
      let indexGraph: ModuleGraph | undefined;
      if (options.indexGraphRoots) {
        // The index needs the project-wide resolution closure, including
        // dependencies reached only from out-of-scope roots. This graph carries
        // edges and provenance only; member collection stays scoped.
        const indexPrevious = options.previous?.snapshot.indexGraph
          ? {
              graph: options.previous.snapshot.indexGraph,
              changedFiles: options.previous.changedFiles,
            }
          : {graph: built.graph, changedFiles: [] as readonly string[]};
        const projectBuilt = await buildModuleGraph({
          api: this.api,
          initial: {snapshot: built.snapshot, project: built.project},
          rootFiles: options.indexGraphRoots,
          initialProgramRoots: [
            ...new Set([
              ...options.indexGraphRoots,
              ...built.graph.modules.map((module) => module.fileName),
            ]),
          ],
          ...(options.retainProgramRoots
            ? {retainProgramRoots: options.retainProgramRoots}
            : {}),
          compilerOptions: this.configuration.compiler,
          fileExists: (fileName) =>
            this.configuration.fileExists(fileName, options.overlays),
          reload: (rootFiles, base) =>
            this.createProgramSnapshot(rootFiles, options.overlays, base),
          previous: indexPrevious,
        });
        current = projectBuilt;
        indexGraph = projectBuilt.graph;
        final = {
          ...built,
          snapshot: projectBuilt.snapshot,
          project: projectBuilt.project,
        };
      }
      checkCancelled(options.operation);
      const snapshotId = `snapshot-${final.snapshot.id}`;
      return {
        ...final,
        graph: built.graph,
        indexGraph,
        snapshotId,
        semantics: createSemanticCollector({
          program: final.project.program,
          project: this.project,
          snapshotId,
        }),
      };
    } catch (error) {
      await current.snapshot.dispose();
      throw error;
    }
  }

  private async createProgramSnapshot(
    rootFiles: readonly string[],
    overlays: ReadonlyMap<string, string>,
    base?: ProjectSnapshot
  ): Promise<ProjectSnapshot> {
    const params = {
      fileSystem: this.configuration.createFileSystem(overlays),
      createPrograms: [
        {
          rootFiles,
          compilerOptions: this.configuration.compiler,
          options: {projectReferences: this.configuration.references},
        },
      ],
    };
    const snapshot = base
      ? await base.snapshot.update(params)
      : await this.api.createSnapshot(params);
    const program = snapshot.operation.createdPrograms?.[0];
    if (program === undefined) {
      await snapshot.dispose();
      throw new Error('TypeScript did not create the discovery program.');
    }
    return {snapshot, project: program.getProject()};
  }
}
