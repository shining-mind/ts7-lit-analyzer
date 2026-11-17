import {randomUUID} from 'node:crypto';
import {resolve} from 'node:path';

import {API} from 'typescript/async';

import {ComponentRegistry} from '../registry/component-registry.js';
import type {
  DiscoveryOptions,
  DiscoveryResult,
  MemberTypeQuery,
  ProjectIdentity,
  SemanticReference,
  SourceOverlay,
} from '../contracts.js';
import {
  createDiscoveryResult,
  getPackageIdentity,
} from '../discovery/discovery.js';
import {LazyQueryTracker} from './lazy-queries.js';
import {
  createMetadataContext,
  mergeComponentMetadata,
} from '../discovery/metadata.js';
import {getAffectedModuleFiles} from '../graph/module-graph.js';
import {RegistrationIndex} from '../registry/registration-index.js';
import {SessionConfiguration} from './configuration.js';
import {SnapshotFactory, type DiscoverySnapshot} from './snapshot-factory.js';
import {SnapshotRetention} from './snapshot-retention.js';
import {
  collectFrameworkMetadata,
  type ComponentFrameworkFragment,
} from '../strategies/index.js';

export type {
  ConsumerDiscoveryOptions,
  DiscoveryOptions,
  StandaloneDiscoveryOptions,
  VirtualSymlink,
} from '../contracts.js';

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

export interface LazyDiscoverySession extends DiscoverySession {
  collectScope(files: readonly string[]): Promise<DiscoveryResult>;
  enrich(componentIds: readonly string[]): Promise<DiscoveryResult>;
  getMemberType(
    componentId: string,
    memberName: string
  ): Promise<MemberTypeQuery | undefined>;
  materializeTypes(): Promise<DiscoveryResult>;
}

interface SessionState extends DiscoverySnapshot {
  index?: RegistrationIndex | undefined;
  fullFragments?: ComponentFrameworkFragment[] | undefined;
  result?: DiscoveryResult;
}

export async function createDiscoverySession(
  options: DiscoveryOptions & {eagerness: 'lazy'}
): Promise<LazyDiscoverySession>;
export async function createDiscoverySession(
  options: DiscoveryOptions
): Promise<DiscoverySession>;
export async function createDiscoverySession(
  options: DiscoveryOptions
): Promise<DiscoverySession> {
  if (
    options.retentionBound !== undefined &&
    (!Number.isInteger(options.retentionBound) || options.retentionBound < 0)
  ) {
    throw new Error('retentionBound must be a non-negative integer.');
  }
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

/**
 * The single session facade and lifecycle owner. Configuration reading,
 * snapshot construction, retention, and lazy query tracking live in dedicated
 * collaborators; eager mode keeps the verified one-shot pipeline, while lazy
 * mode defers construction to the first scoped request.
 */
class DiscoverySessionImpl implements LazyDiscoverySession {
  private readonly api: API;
  private readonly project: ProjectIdentity;
  private readonly lazy: boolean;
  private readonly configuration: SessionConfiguration;
  private readonly snapshots: SnapshotFactory;
  private readonly registry: ComponentRegistry;
  private readonly retention: SnapshotRetention;
  private readonly lazyQueries = new LazyQueryTracker();
  private readonly overlays = new Map<string, string>();
  private state: SessionState | undefined;
  private generation = 1;
  private disposed = false;
  private disposePromise: Promise<void> | undefined;

  constructor(api: API, options: DiscoveryOptions, currentDirectory: string) {
    this.api = api;
    this.lazy = options.eagerness === 'lazy';
    this.project = {
      id: randomUUID(),
      currentDirectory,
      ...(options.mode === 'consumer'
        ? {configFileName: resolve(currentDirectory, options.configFileName)}
        : {}),
    };
    this.configuration = new SessionConfiguration(options, currentDirectory);
    this.snapshots = new SnapshotFactory(api, this.configuration, this.project);
    this.registry = new ComponentRegistry(this.project);
    this.retention = new SnapshotRetention(options.retentionBound);
    for (const overlay of options.overlays ?? []) {
      this.overlays.set(
        this.configuration.absolutePath(overlay.fileName),
        overlay.text
      );
    }
  }

  async initialize(): Promise<void> {
    await this.configuration.read(this.api);
    if (!this.lazy) {
      this.state = await this.buildSnapshot();
    }
  }

  async collect(): Promise<DiscoveryResult> {
    if (this.lazy) {
      this.ensureNotDisposed();
      if (this.state === undefined) {
        return this.emptyResult();
      }
      this.state.result ??= this.assembleLazyResult(this.state);
      return this.state.result;
    }
    const state = this.ensureActive();
    state.result ??= await createDiscoveryResult(
      this.project,
      state.snapshotId,
      this.generation,
      state.graph,
      [...this.overlays.keys()],
      state.semantics,
      state.project
    );
    return state.result;
  }

  async collectScope(files: readonly string[]): Promise<DiscoveryResult> {
    this.ensureLazy();
    this.registry.extendScope(
      files.map((fileName) => this.configuration.absolutePath(fileName))
    );
    if (this.registry.activeScope.size === 0) {
      return this.emptyResult();
    }
    if (this.state === undefined) {
      const state = await this.buildSnapshot();
      try {
        state.index = new RegistrationIndex();
        await this.refreshIndex(state);
      } catch (error) {
        await state.snapshot.dispose();
        throw error;
      }
      this.state = state;
      return this.assembleLazyResult(state);
    }
    const previous = this.state;
    const next = await this.buildSnapshot(previous, []);
    try {
      const previousFiles = new Set(
        (previous.indexGraph ?? previous.graph).modules.map(
          (module) => module.fileName
        )
      );
      const hasNewModules = (next.indexGraph ?? next.graph).modules.some(
        (module) => !previousFiles.has(module.fileName)
      );
      if (hasNewModules) {
        next.index = new RegistrationIndex();
        await this.refreshIndex(next);
        this.registry.retainIndexed(next.index.ids());
      } else {
        next.index = previous.index;
      }
    } catch (error) {
      await next.snapshot.dispose();
      throw error;
    }
    await this.retention.retain(previous.snapshot);
    this.state = next;
    return this.assembleLazyResult(next);
  }

  async enrich(componentIds: readonly string[]): Promise<DiscoveryResult> {
    this.ensureLazy();
    const state = this.ensureActive();
    const context = await createMetadataContext(
      state.project.program,
      this.configuration.roots,
      state.indexGraph ?? state.graph
    );
    state.fullFragments ??= await collectFrameworkMetadata(context);
    for (const id of componentIds) {
      if (this.registry.getEnriched(id)) {
        continue;
      }
      const entry = state.index?.get(id);
      if (!entry) {
        throw new Error(`Component is not indexed: ${id}`);
      }
      const record = await state.semantics.collectClassSemantics(
        entry.declaration,
        false
      );
      if (!record) {
        throw new Error(`Cannot collect semantics for component: ${id}`);
      }
      const module = (state.indexGraph ?? state.graph).modules.find(
        (candidate) =>
          candidate.fileName === record.declarationEvidence.fileName
      );
      const packageIdentity = module ? getPackageIdentity(module) : undefined;
      if (packageIdentity) {
        record.declarationEvidence.package = packageIdentity;
      }
      const [merged] = await mergeComponentMetadata(
        [record],
        context,
        state.fullFragments
      );
      if (merged) {
        this.registry.setEnriched(merged);
      }
    }
    return this.assembleLazyResult(state);
  }

  async getMemberType(
    componentId: string,
    memberName: string
  ): Promise<MemberTypeQuery | undefined> {
    this.ensureLazy();
    const state = this.ensureActive();
    const record = this.registry.getEnriched(componentId);
    if (!record) {
      return undefined;
    }
    const query = await state.semantics.getMemberTypeQuery(
      record.declarationEvidence,
      memberName
    );
    if (query) {
      this.lazyQueries.track(
        query.reference,
        record.declarationEvidence,
        memberName
      );
    }
    return query;
  }

  async materializeTypes(): Promise<DiscoveryResult> {
    this.ensureLazy();
    const state = this.ensureActive();
    for (const record of this.registry.enrichedRecords()) {
      const stored = await state.semantics.materializeRecordTypes(record);
      for (const {memberName, reference} of stored) {
        this.lazyQueries.track(
          reference,
          record.declarationEvidence,
          memberName
        );
      }
    }
    return this.assembleLazyResult(state);
  }

  async update(overlays: readonly SourceOverlay[]): Promise<DiscoveryResult> {
    if (this.lazy) {
      return this.updateLazy(overlays);
    }
    const previous = this.ensureActive();
    const {changedFiles, originalOverlays} = this.applyOverlays(overlays);
    let next: SessionState | undefined;
    try {
      next = await this.buildSnapshot(previous, changedFiles);
      next.result = await createDiscoveryResult(
        this.project,
        next.snapshotId,
        this.generation + 1,
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
      await this.retention.retain(previous.snapshot);
      this.state = next;
      this.generation += 1;
      return next.result;
    } catch (error) {
      if (next) await next.snapshot.dispose();
      this.restoreOverlays(originalOverlays);
      throw error;
    }
  }

  async getTypeAtPosition(
    fileName: string,
    position: number
  ): Promise<SemanticReference | undefined> {
    const state = this.ensureActive();
    const canonicalFileName = this.configuration.absolutePath(fileName);
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

  private async updateLazy(
    overlays: readonly SourceOverlay[]
  ): Promise<DiscoveryResult> {
    this.ensureNotDisposed();
    const {changedFiles, originalOverlays} = this.applyOverlays(overlays);
    if (this.state === undefined) {
      this.generation += 1;
      return this.emptyResult();
    }
    const previous = this.state;
    let next: SessionState | undefined;
    try {
      next = await this.buildSnapshot(previous, changedFiles);
      next.index = new RegistrationIndex();
      await this.refreshIndex(next);
      const affectedFiles = getAffectedModuleFiles(
        previous.indexGraph ?? previous.graph,
        changedFiles
      );
      this.registry.invalidateAffected(affectedFiles);
      this.registry.retainIndexed(next.index.ids());
      this.lazyQueries.registerSuccessors(
        next.semantics,
        this.registry.enrichedIds()
      );
      await this.retention.retain(previous.snapshot);
      this.state = next;
      return this.assembleLazyResult(next);
    } catch (error) {
      if (next) await next.snapshot.dispose();
      this.restoreOverlays(originalOverlays);
      throw error;
    }
  }

  private applyOverlays(overlays: readonly SourceOverlay[]): {
    changedFiles: string[];
    originalOverlays: Map<string, string>;
  } {
    const nextOverlays = new Map(this.overlays);
    const changedFiles: string[] = [];
    for (const overlay of overlays) {
      const fileName = this.configuration.absolutePath(overlay.fileName);
      nextOverlays.set(fileName, overlay.text);
      changedFiles.push(fileName);
    }

    const originalOverlays = new Map(this.overlays);
    this.overlays.clear();
    for (const [fileName, text] of nextOverlays) {
      this.overlays.set(fileName, text);
    }
    return {changedFiles, originalOverlays};
  }

  private restoreOverlays(originalOverlays: ReadonlyMap<string, string>): void {
    this.overlays.clear();
    for (const [fileName, text] of originalOverlays) {
      this.overlays.set(fileName, text);
    }
  }

  private assembleLazyResult(state: SessionState): DiscoveryResult {
    this.generation += 1;
    const result = this.registry.assemble({
      index: state.index!,
      graph: state.indexGraph ?? state.graph,
      snapshotId: state.snapshotId,
      generation: this.generation,
      overlayFiles: [...this.overlays.keys()],
      issues: state.graph.unresolvedModules.map((module) => ({
        code: 'unresolved-module',
        message: `Cannot resolve '${module.moduleSpecifier}' from '${module.fileName}'.`,
        fileName: module.fileName,
      })),
    });
    state.result = result;
    return result;
  }

  private emptyResult(): DiscoveryResult {
    const overlayFiles = [...this.overlays.keys()].sort();
    return {
      project: this.project,
      snapshotId: '',
      generation: this.generation,
      components: [],
      issues: [],
      containsOverlays: overlayFiles.length > 0,
      overlayFiles,
    };
  }

  private async refreshIndex(state: SessionState): Promise<void> {
    const context = await createMetadataContext(
      state.project.program,
      this.configuration.roots,
      state.indexGraph ?? state.graph
    );
    await state.index!.refresh(context);
  }

  private buildSnapshot(
    previous?: SessionState,
    changedFiles: readonly string[] = []
  ): Promise<SessionState> {
    return this.snapshots.build({
      graphRoots: this.lazy
        ? [...this.registry.activeScope]
        : this.configuration.roots,
      overlays: this.overlays,
      ...(this.lazy
        ? {
            indexGraphRoots: this.configuration.roots,
            retainProgramRoots: this.configuration.roots,
          }
        : {}),
      ...(previous ? {previous: {snapshot: previous, changedFiles}} : {}),
    });
  }

  private async disposeWorker(): Promise<void> {
    if (this.state !== undefined) {
      await this.retention.retain(this.state.snapshot);
      this.state = undefined;
    }
    await this.retention.disposeAll();
    await this.api.close();
  }

  private ensureNotDisposed(): void {
    if (this.disposed) {
      throw new Error('Discovery session is disposed.');
    }
  }

  private ensureActive(): SessionState {
    this.ensureNotDisposed();
    if (this.state === undefined) {
      throw new Error(
        this.lazy
          ? 'Discovery session has no active scope.'
          : 'Discovery session is disposed.'
      );
    }
    return this.state;
  }

  private ensureLazy(): void {
    this.ensureNotDisposed();
    if (!this.lazy) {
      throw new Error('Discovery session is not in lazy mode.');
    }
  }
}
