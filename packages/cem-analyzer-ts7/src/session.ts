import {randomUUID} from 'node:crypto';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

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

import type {
  DiscoveryResult,
  ProjectIdentity,
  SemanticReference,
  SourceOverlay,
  VirtualSourceFile,
} from './contracts.js';
import {createDiscoveryResult} from './discovery.js';
import {
  buildModuleGraph,
  getAffectedModuleFiles,
  type ModuleGraph,
  type ProjectSnapshot,
} from './module-graph.js';
import {createSemanticCollector, type SemanticCollector} from './semantics.js';

export interface VirtualSymlink {
  target: string;
}

interface DiscoveryOptionsBase {
  currentDirectory?: string;
  files?: readonly VirtualSourceFile[];
  overlays?: readonly SourceOverlay[];
  symlinks?: Readonly<Record<string, VirtualSymlink>>;
}

export interface StandaloneDiscoveryOptions extends DiscoveryOptionsBase {
  mode: 'standalone';
  rootFiles: readonly string[];
  compilerOptions?: Readonly<Record<string, unknown>>;
}

export interface ConsumerDiscoveryOptions extends DiscoveryOptionsBase {
  mode: 'consumer';
  configFileName: string;
}

export type DiscoveryOptions =
  StandaloneDiscoveryOptions | ConsumerDiscoveryOptions;

export interface DiscoverySession {
  collect(): Promise<DiscoveryResult>;
  update(overlays: readonly SourceOverlay[]): Promise<DiscoveryResult>;
  getTypeAtPosition(
    fileName: string,
    position: number
  ): Promise<SemanticReference | undefined>;
  isAssignable(
    source: SemanticReference,
    target: SemanticReference
  ): Promise<boolean>;
  dispose(): Promise<void>;
}

interface SessionState {
  snapshot: Snapshot;
  project: Project;
  graph: ModuleGraph;
  snapshotId: string;
  semantics: SemanticCollector;
  result?: DiscoveryResult;
}

export async function createDiscoverySession(
  options: DiscoveryOptions
): Promise<DiscoverySession> {
  const currentDirectory = resolve(options.currentDirectory ?? process.cwd());
  const api = new API({cwd: currentDirectory, runExternalCode: false});
  const session = new DiscoverySessionImpl(api, options, currentDirectory);
  try {
    await session.initialize();
    return session;
  } catch (error) {
    await session.dispose();
    throw error;
  }
}

class DiscoverySessionImpl implements DiscoverySession {
  private readonly api: API;
  private readonly options: DiscoveryOptions;
  private readonly currentDirectory: string;
  private readonly project: ProjectIdentity;
  private readonly files = new Map<string, string>();
  private readonly overlays = new Map<string, string>();
  private rootFiles: string[] = [];
  private compilerOptions: RawCompilerOptions = {};
  private state: SessionState | undefined;
  private readonly retainedSnapshots: Snapshot[] = [];
  private disposed = false;
  private disposePromise: Promise<void> | undefined;

  constructor(api: API, options: DiscoveryOptions, currentDirectory: string) {
    this.api = api;
    this.options = options;
    this.currentDirectory = currentDirectory;
    this.project = {
      id: randomUUID(),
      currentDirectory,
      ...(options.mode === 'consumer'
        ? {configFileName: this.absolutePath(options.configFileName)}
        : {}),
    };
    for (const file of options.files ?? []) {
      this.files.set(this.absolutePath(file.fileName), file.text);
    }
    for (const overlay of options.overlays ?? []) {
      this.overlays.set(this.absolutePath(overlay.fileName), overlay.text);
    }
  }

  async initialize(): Promise<void> {
    if (this.options.mode === 'standalone') {
      this.rootFiles = this.options.rootFiles.map((fileName) =>
        this.absolutePath(fileName)
      );
      this.compilerOptions = deriveCompilerOptions(
        this.options.compilerOptions as RawCompilerOptions | undefined
      );
    } else {
      await this.readConsumerConfiguration(this.options.configFileName);
    }
    this.state = await this.buildSnapshot();
  }

  async collect(): Promise<DiscoveryResult> {
    const state = this.ensureActive();
    state.result ??= await createDiscoveryResult(
      this.project,
      state.snapshotId,
      state.graph,
      [...this.overlays.keys()],
      state.semantics,
      state.project
    );
    return state.result;
  }

  async update(overlays: readonly SourceOverlay[]): Promise<DiscoveryResult> {
    const previous = this.ensureActive();
    const nextOverlays = new Map(this.overlays);
    const changedFiles: string[] = [];
    for (const overlay of overlays) {
      const fileName = this.absolutePath(overlay.fileName);
      nextOverlays.set(fileName, overlay.text);
      changedFiles.push(fileName);
    }

    const originalOverlays = new Map(this.overlays);
    this.overlays.clear();
    for (const [fileName, text] of nextOverlays) {
      this.overlays.set(fileName, text);
    }
    let next: SessionState | undefined;
    try {
      next = await this.buildSnapshot(previous, changedFiles);
      next.result = await createDiscoveryResult(
        this.project,
        next.snapshotId,
        next.graph,
        [...this.overlays.keys()],
        next.semantics,
        next.project,
        previous.result
          ? {
              result: previous.result,
              affectedFiles: getAffectedModuleFiles(
                previous.graph,
                changedFiles
              ),
              moduleFiles: new Set(
                previous.graph.modules.map((module) => module.fileName)
              ),
            }
          : undefined
      );
      this.retainedSnapshots.push(previous.snapshot);
      this.state = next;
      return next.result;
    } catch (error) {
      if (next) await next.snapshot.dispose();
      this.overlays.clear();
      for (const [fileName, text] of originalOverlays) {
        this.overlays.set(fileName, text);
      }
      throw error;
    }
  }

  async getTypeAtPosition(
    fileName: string,
    position: number
  ): Promise<SemanticReference | undefined> {
    const state = this.ensureActive();
    const canonicalFileName = this.absolutePath(fileName);
    if (
      (await state.project.program.getSourceFile(canonicalFileName)) ===
      undefined
    ) {
      return undefined;
    }
    return state.semantics.getTypeAtPosition(canonicalFileName, position);
  }

  async isAssignable(
    source: SemanticReference,
    target: SemanticReference
  ): Promise<boolean> {
    const state = this.ensureActive();
    return state.semantics.isAssignable(source, target);
  }

  dispose(): Promise<void> {
    this.disposed = true;
    this.disposePromise ??= this.disposeWorker();
    return this.disposePromise;
  }

  private async disposeWorker(): Promise<void> {
    if (this.state !== undefined) {
      this.retainedSnapshots.push(this.state.snapshot);
      this.state = undefined;
    }
    for (const snapshot of this.retainedSnapshots.splice(0)) {
      await snapshot.dispose();
    }
    await this.api.close();
  }

  private async readConsumerConfiguration(
    configFileName: string
  ): Promise<void> {
    const canonicalConfig = this.absolutePath(configFileName);
    const snapshot = await this.api.createSnapshot({
      fileSystem: this.createFileSystem(),
      openProjects: [canonicalConfig],
    });
    try {
      const project = snapshot.getConfiguredProject(canonicalConfig);
      if (project === undefined) {
        throw new Error(`Cannot open TypeScript project: ${canonicalConfig}`);
      }
      this.rootFiles = project.parsedCommandLine.fileNames.map((fileName) =>
        this.absolutePath(fileName)
      );
      this.compilerOptions = deriveCompilerOptions(
        project.parsedCommandLine.options as RawCompilerOptions
      );
    } finally {
      await snapshot.dispose();
    }
  }

  private async buildSnapshot(
    previous?: SessionState,
    changedFiles: readonly string[] = []
  ): Promise<SessionState> {
    const initialProgramRoots = previous
      ? [
          ...new Set([
            ...this.rootFiles,
            ...previous.graph.modules.map((module) => module.fileName),
          ]),
        ]
      : this.rootFiles;
    const initial = await this.createProgramSnapshot(
      initialProgramRoots,
      previous
    );
    const built = await buildModuleGraph({
      api: this.api,
      initial,
      rootFiles: this.rootFiles,
      initialProgramRoots,
      compilerOptions: this.compilerOptions,
      fileExists: (fileName) => this.fileExists(fileName),
      reload: (rootFiles, base) => this.createProgramSnapshot(rootFiles, base),
      ...(previous ? {previous: {graph: previous.graph, changedFiles}} : {}),
    });
    const snapshotId = `snapshot-${built.snapshot.id}`;
    return {
      ...built,
      snapshotId,
      semantics: createSemanticCollector({
        program: built.project.program,
        project: this.project,
        snapshotId,
      }),
    };
  }

  private async createProgramSnapshot(
    rootFiles: readonly string[],
    base?: ProjectSnapshot
  ): Promise<ProjectSnapshot> {
    const params = {
      fileSystem: this.createFileSystem(),
      createPrograms: [{rootFiles, compilerOptions: this.compilerOptions}],
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

  private createFileSystem(): ReturnType<typeof createFileSystemLayer> {
    const files = new Map(this.files);
    for (const [fileName, text] of this.overlays) {
      files.set(fileName, text);
    }
    return createFileSystemLayer(
      [...files].map(([fileName, text]) => [fileName, text]),
      {symlinks: {...this.options.symlinks}}
    );
  }

  private ensureActive(): SessionState {
    if (this.disposed || this.state === undefined) {
      throw new Error('Discovery session is disposed.');
    }
    return this.state;
  }

  private fileExists(fileName: string): boolean {
    const absolute = this.absolutePath(fileName);
    return (
      this.files.has(absolute) ||
      this.overlays.has(absolute) ||
      existsSync(absolute)
    );
  }

  private absolutePath(fileName: string): string {
    return resolve(this.currentDirectory, fileName);
  }
}

function deriveCompilerOptions(
  options: RawCompilerOptions | undefined
): RawCompilerOptions {
  return {
    strict: true,
    target: ScriptTarget.ESNext,
    module: ModuleKind.NodeNext,
    moduleResolution: ModuleResolutionKind.NodeNext,
    types: [],
    skipLibCheck: true,
    ...options,
    allowJs: true,
    checkJs: false,
    maxNodeModuleJsDepth: 0,
  };
}
