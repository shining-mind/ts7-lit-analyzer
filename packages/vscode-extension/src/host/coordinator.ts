import {
  createRegistrySession,
  type DiscoveryOptions,
  type LazyRegistrySession,
  type RegistryView,
} from '@ts7-lit-analyzer/analyzer-core';
import {window, type Disposable} from 'vscode';

import {DocumentTracker, type TrackedDocument} from './documents.js';
import type {HostProjectAssociation, ProjectRouter} from './project-router.js';

export interface CoordinatorSettings {
  trigger: 'onType' | 'onSave';
  debounceMs: number;
  maxWaitMs: number;
  maxResidentProjects: number;
  collectTiming: boolean;
}

export interface CoordinatorLogger {
  normal(event: string, fields?: Readonly<Record<string, unknown>>): void;
  verbose(event: string, fields?: Readonly<Record<string, unknown>>): void;
  debug(event: string, fields?: Readonly<Record<string, unknown>>): void;
  error(event: string, fields?: Readonly<Record<string, unknown>>): void;
}

export interface RuntimeDiagnostic {
  key: string;
  kind: 'configured' | 'inferred';
  resident: boolean;
  pending: boolean;
  stale: boolean;
  revision: number;
  acceptedRevision: number;
  generation?: number;
  snapshotId?: string;
  componentCount?: number;
  retainedViewCount: number;
  overlayBytes: number;
  openFiles: readonly string[];
  error?: string;
}

export interface OrchestrationDiagnostic {
  documents: readonly {
    uri: string;
    version: number;
    isDirty: boolean;
    projectKey?: string;
  }[];
  runtimes: readonly RuntimeDiagnostic[];
  executing: boolean;
}

export interface CoordinatorOptions {
  router: ProjectRouter;
  settings: CoordinatorSettings;
  logger?: CoordinatorLogger;
  createSession?(
    options: DiscoveryOptions & {eagerness: 'lazy'}
  ): Promise<LazyRegistrySession>;
}

interface ProjectRuntime {
  association: HostProjectAssociation;
  openFiles: Set<string>;
  session: LazyRegistrySession | undefined;
  appliedOverlays: Map<string, string>;
  savedVersions: Map<string, number>;
  view: RegistryView | undefined;
  revision: number;
  acceptedRevision: number;
  resident: boolean;
  stale: boolean;
  pending: boolean;
  due: boolean;
  lastUsed: number;
  debounceTimer: ReturnType<typeof setTimeout> | undefined;
  maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  controller: AbortController | undefined;
  error: string | undefined;
}

const silentLogger: CoordinatorLogger = {
  normal() {},
  verbose() {},
  debug() {},
  error() {},
};

export class EditorAnalysisCoordinator implements Disposable {
  private readonly router: ProjectRouter;
  private readonly logger: CoordinatorLogger;
  private readonly createSession: (
    options: DiscoveryOptions & {eagerness: 'lazy'}
  ) => Promise<LazyRegistrySession>;
  private readonly tracker: DocumentTracker;
  private readonly activeSubscription: Disposable;
  private readonly runtimes = new Map<string, ProjectRuntime>();
  private readonly associations = new Map<string, string>();
  private readonly routing = new Map<string, Promise<void>>();
  private readonly savedDocuments = new Map<string, TrackedDocument>();
  private settings: CoordinatorSettings;
  private execution: Promise<void> = Promise.resolve();
  private activeProjectKey: string | undefined;
  private disposed = false;

  constructor(options: CoordinatorOptions) {
    this.router = options.router;
    this.settings = options.settings;
    this.logger = options.logger ?? silentLogger;
    this.createSession = options.createSession ?? createRegistrySession;
    this.tracker = new DocumentTracker({
      opened: (document) => this.opened(document),
      changed: (document) => this.changed(document),
      saved: (document) => this.saved(document),
      closed: (document) => this.closed(document),
    });
    this.activeSubscription = window.onDidChangeActiveTextEditor((editor) => {
      if (editor) {
        const document = this.tracker.get(editor.document.uri);
        if (document) {
          void this.activate(document);
        }
      }
    });
  }

  initialize(): void {
    this.tracker.initialize();
    const active = window.activeTextEditor;
    if (active) {
      const document = this.tracker.get(active.document.uri);
      if (document) {
        void this.activate(document);
      }
    }
  }

  updateSettings(settings: CoordinatorSettings): void {
    const previous = this.settings;
    this.settings = settings;
    if (
      previous.trigger !== settings.trigger &&
      settings.trigger === 'onSave'
    ) {
      for (const runtime of this.runtimes.values()) {
        this.clearTimers(runtime);
        runtime.pending = false;
        runtime.stale = true;
      }
    }
    if (previous.collectTiming !== settings.collectTiming) {
      for (const runtime of this.runtimes.values()) {
        runtime.revision += 1;
        runtime.controller?.abort();
        const session = runtime.session;
        runtime.session = undefined;
        runtime.appliedOverlays.clear();
        runtime.savedVersions.clear();
        runtime.stale = true;
        if (session) {
          this.execution = this.execution.then(() => session.dispose());
        }
      }
      this.scheduleResidents(true);
    }
  }

  snapshot(): OrchestrationDiagnostic {
    return {
      documents: this.tracker.documents().map((document) => ({
        uri: document.uri,
        version: document.version,
        isDirty: document.isDirty,
        ...(this.associations.has(document.uri)
          ? {projectKey: this.associations.get(document.uri)!}
          : {}),
      })),
      runtimes: [...this.runtimes.values()].map((runtime) => ({
        key: runtime.association.key,
        kind: runtime.association.kind,
        resident: runtime.resident,
        pending: runtime.pending,
        stale: runtime.stale,
        revision: runtime.revision,
        acceptedRevision: runtime.acceptedRevision,
        ...(runtime.view
          ? {
              generation: runtime.view.generation,
              snapshotId: runtime.view.snapshotId,
              componentCount: runtime.view.components().length,
            }
          : {}),
        retainedViewCount: runtime.view ? 1 : 0,
        overlayBytes: [...runtime.appliedOverlays.values()].reduce(
          (total, text) => total + Buffer.byteLength(text),
          0
        ),
        openFiles: [...runtime.openFiles],
        ...(runtime.error ? {error: runtime.error} : {}),
      })),
      executing: [...this.runtimes.values()].some(
        (runtime) => runtime.controller !== undefined
      ),
    };
  }

  async idle(): Promise<void> {
    while (
      [...this.runtimes.values()].some(
        (runtime) => runtime.pending || runtime.controller
      )
    ) {
      for (const runtime of this.runtimes.values()) {
        if (runtime.pending && runtime.resident) {
          this.clearTimers(runtime);
          this.enqueue(runtime);
        }
      }
      await this.execution;
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.activeSubscription.dispose();
    this.tracker.dispose();
    for (const runtime of this.runtimes.values()) {
      this.clearTimers(runtime);
      runtime.controller?.abort();
      runtime.resident = false;
    }
    await this.execution;
    for (const runtime of this.runtimes.values()) {
      await runtime.session?.dispose();
      runtime.session = undefined;
    }
    this.logger.normal('coordinator.disposed');
  }

  private opened(document: TrackedDocument): void {
    this.logger.verbose('document.opened', this.documentFields(document));
    void this.route(document).then(() => this.scheduleDocument(document, true));
  }

  private changed(document: TrackedDocument): void {
    this.logger.verbose('document.changed', this.documentFields(document));
    this.savedDocuments.delete(document.uri);
    void this.route(document).then(() => {
      if (this.settings.trigger === 'onSave') {
        const runtime = this.runtimeFor(document);
        if (runtime) {
          runtime.stale = true;
          runtime.revision += 1;
          runtime.controller?.abort();
        }
        return;
      }
      this.scheduleDocument(document, false);
    });
  }

  private saved(document: TrackedDocument): void {
    this.logger.verbose('document.saved', this.documentFields(document));
    this.savedDocuments.set(document.uri, document);
    void this.route(document).then(() => this.scheduleResidents(true));
  }

  private closed(document: TrackedDocument): void {
    this.logger.verbose('document.closed', this.documentFields(document));
    this.savedDocuments.delete(document.uri);
    const key = this.associations.get(document.uri);
    this.associations.delete(document.uri);
    if (key) {
      const runtime = this.runtimes.get(key);
      runtime?.openFiles.delete(document.uri);
      if (runtime) {
        runtime.stale = true;
      }
    }
    this.scheduleResidents(true);
  }

  private async activate(document: TrackedDocument): Promise<void> {
    await this.route(document);
    const key = this.associations.get(document.uri);
    if (key) {
      this.activeProjectKey = key;
      const runtime = this.runtimes.get(key);
      if (runtime) {
        runtime.lastUsed = Date.now();
        runtime.resident = true;
        this.schedule(runtime, true);
      }
    }
  }

  private async route(document: TrackedDocument): Promise<void> {
    if (this.disposed || this.associations.has(document.uri)) {
      return;
    }
    let pending = this.routing.get(document.uri);
    if (!pending) {
      pending = this.router.associate(document).then((association) => {
        if (this.disposed) {
          return;
        }
        this.associations.set(document.uri, association.key);
        let runtime = this.runtimes.get(association.key);
        if (!runtime) {
          runtime = {
            association,
            openFiles: new Set(),
            session: undefined,
            appliedOverlays: new Map(),
            savedVersions: new Map(),
            view: undefined,
            revision: 0,
            acceptedRevision: 0,
            resident: true,
            stale: true,
            pending: false,
            due: false,
            lastUsed: Date.now(),
            debounceTimer: undefined,
            maxWaitTimer: undefined,
            controller: undefined,
            error: undefined,
          };
          this.runtimes.set(association.key, runtime);
        } else {
          runtime.association = association;
          runtime.resident = true;
        }
        runtime.openFiles.add(document.uri);
        this.routing.delete(document.uri);
        this.logger.verbose('project.associated', {
          uri: document.uri,
          projectKey: association.key,
        });
      });
      this.routing.set(document.uri, pending);
    }
    await pending;
  }

  private scheduleDocument(
    document: TrackedDocument,
    immediate: boolean
  ): void {
    const key = this.associations.get(document.uri);
    if (!key) {
      return;
    }
    const runtime = this.runtimes.get(key);
    if (runtime) {
      runtime.openFiles.add(document.uri);
      this.schedule(runtime, immediate);
      this.scheduleOthers(key, immediate);
    }
  }

  private scheduleOthers(excludedKey: string, immediate: boolean): void {
    for (const runtime of this.runtimes.values()) {
      if (
        runtime.association.key !== excludedKey &&
        runtime.resident &&
        runtime.openFiles.size > 0
      ) {
        this.schedule(runtime, immediate);
      }
    }
  }

  private scheduleResidents(immediate: boolean): void {
    for (const runtime of this.runtimes.values()) {
      if (runtime.resident) {
        this.schedule(runtime, immediate);
      }
    }
  }

  private schedule(runtime: ProjectRuntime, immediate: boolean): void {
    if (this.disposed || !runtime.resident) {
      return;
    }
    runtime.revision += 1;
    this.logger.debug('analysis.scheduled', {
      projectKey: runtime.association.key,
      revision: runtime.revision,
      immediate,
    });
    runtime.controller?.abort();
    runtime.stale = true;
    runtime.pending = true;
    runtime.due = immediate;
    if (immediate || this.settings.trigger === 'onSave') {
      this.clearTimers(runtime);
      this.enqueue(runtime);
      return;
    }
    if (!runtime.maxWaitTimer) {
      runtime.maxWaitTimer = setTimeout(() => {
        runtime.maxWaitTimer = undefined;
        runtime.due = true;
        this.enqueue(runtime);
      }, this.settings.maxWaitMs);
    }
    if (runtime.debounceTimer) {
      clearTimeout(runtime.debounceTimer);
    }
    runtime.debounceTimer = setTimeout(() => {
      runtime.debounceTimer = undefined;
      runtime.due = true;
      this.enqueue(runtime);
    }, this.settings.debounceMs);
  }

  private enqueue(runtime: ProjectRuntime): void {
    if (this.disposed || !runtime.resident) {
      return;
    }
    this.clearTimers(runtime);
    this.execution = this.execution.then(() => this.execute(runtime));
  }

  private async execute(runtime: ProjectRuntime): Promise<void> {
    if (this.disposed || !runtime.resident || !runtime.due) {
      runtime.pending = false;
      return;
    }
    await this.makeResident(runtime);
    if (this.disposed || !runtime.resident) {
      runtime.pending = false;
      return;
    }
    const startedAt = this.settings.collectTiming
      ? performance.now()
      : undefined;
    const revision = runtime.revision;
    const versions = new Map(
      this.tracker
        .documents()
        .map((document) => [
          document.uri,
          {version: document.version, isDirty: document.isDirty},
        ])
    );
    const controller = new AbortController();
    runtime.controller = controller;
    runtime.pending = false;
    runtime.due = false;
    this.logger.debug('analysis.started', {
      projectKey: runtime.association.key,
      revision,
    });
    try {
      let session = runtime.session;
      if (!session) {
        const created = await this.createSession(
          this.sessionOptions(runtime.association)
        );
        if (!this.isCurrent(runtime, revision, controller, versions)) {
          await created.dispose();
          return;
        }
        session = created;
        runtime.session = created;
        this.logger.debug('analysis.sessionCreated', {
          projectKey: runtime.association.key,
        });
      }
      const dirty = this.tracker.dirtyDocuments();
      const currentFiles = new Map(
        dirty.map((document) => [document.fileName, document.text])
      );
      const removed = [...runtime.appliedOverlays.keys()].filter(
        (fileName) => !currentFiles.has(fileName)
      );
      const overlays = dirty.map((document) => ({
        fileName: document.fileName,
        text: document.text,
        version: document.version,
      }));
      if (removed.length > 0) {
        await session.removeOverlays(removed, {signal: controller.signal});
      }
      if (overlays.length > 0) {
        await session.update(overlays, {signal: controller.signal});
      } else if (removed.length === 0) {
        await session.update([], {signal: controller.signal});
      }
      const saved = [...this.savedDocuments.values()].filter(
        (document) =>
          runtime.savedVersions.get(document.uri) !== document.version
      );
      if (saved.length > 0) {
        await session.update(
          saved.map((document) => ({
            fileName: document.fileName,
            text: document.text,
            version: document.version,
          })),
          {signal: controller.signal}
        );
        await session.removeOverlays(
          saved.map((document) => document.fileName),
          {signal: controller.signal}
        );
      }
      await session.collectScope(
        [...runtime.openFiles].map((uri) => {
          const document = this.tracker
            .documents()
            .find((item) => item.uri === uri);
          return document?.fileName ?? uri;
        }),
        {signal: controller.signal}
      );
      this.logger.debug('analysis.scopeCollected', {
        projectKey: runtime.association.key,
      });
      const current = session.current();
      const ids =
        current
          ?.components()
          .map((component) => component.declarationEvidence.id) ?? [];
      if (ids.length > 0) {
        await session.enrich(ids, {signal: controller.signal});
        await session.materializeTypes({signal: controller.signal});
      }
      this.logger.debug('analysis.materialized', {
        projectKey: runtime.association.key,
      });
      const view = session.current();
      if (!view || !this.isCurrent(runtime, revision, controller, versions)) {
        this.logger.debug('analysis.rejected', {
          projectKey: runtime.association.key,
          revision,
          runtimeRevision: runtime.revision,
          resident: runtime.resident,
          aborted: controller.signal.aborted,
          capturedVersions: Object.fromEntries(versions),
          currentVersions: this.tracker.documents().map((document) => ({
            uri: document.uri,
            version: document.version,
            isDirty: document.isDirty,
          })),
        });
        return;
      }
      if (
        runtime.view &&
        runtime.acceptedRevision === revision &&
        view.generation <= runtime.view.generation
      ) {
        this.logger.debug('analysis.generationRejected', {
          projectKey: runtime.association.key,
          revision,
          acceptedRevision: runtime.acceptedRevision,
          viewGeneration: view.generation,
          currentGeneration: runtime.view.generation,
        });
        return;
      }
      for (const document of saved) {
        const currentDocument = this.tracker
          .documents()
          .find((candidate) => candidate.uri === document.uri);
        if (currentDocument && !currentDocument.isDirty) {
          runtime.savedVersions.set(document.uri, document.version);
        }
      }
      runtime.appliedOverlays = new Map(currentFiles);
      runtime.view = view;
      runtime.acceptedRevision = revision;
      runtime.stale = false;
      runtime.error = undefined;
      runtime.lastUsed = Date.now();
      this.logger.verbose('analysis.accepted', {
        projectKey: runtime.association.key,
        revision,
        generation: view.generation,
        components: view.components().length,
        ...(view.moduleResolutionFallbackCount !== undefined
          ? {moduleResolutionFallbackCount: view.moduleResolutionFallbackCount}
          : {}),
      });
      await this.logResources(
        runtime,
        view,
        startedAt === undefined ? 0 : performance.now() - startedAt
      );
    } catch (error) {
      if (this.isCurrent(runtime, revision, controller, versions)) {
        if (controller.signal.aborted) {
          this.logger.debug('analysis.cancelled', {
            projectKey: runtime.association.key,
            revision,
          });
        } else {
          runtime.error =
            error instanceof Error ? error.message : String(error);
          this.logger.error('analysis.failed', {
            projectKey: runtime.association.key,
            error: runtime.error,
          });
        }
      }
    } finally {
      this.logger.debug('analysis.finished', {
        projectKey: runtime.association.key,
        revision,
        acceptedRevision: runtime.acceptedRevision,
        viewGeneration: runtime.view?.generation,
      });
      if (runtime.controller === controller) {
        runtime.controller = undefined;
      }
    }
  }

  private async makeResident(runtime: ProjectRuntime): Promise<void> {
    const residents = [...this.runtimes.values()].filter(
      (candidate) => candidate.resident
    );
    if (residents.length <= this.settings.maxResidentProjects) {
      runtime.resident = true;
      return;
    }
    const candidate = residents
      .filter(
        (item) =>
          item !== runtime && item.association.key !== this.activeProjectKey
      )
      .sort((first, second) => first.lastUsed - second.lastUsed)[0];
    if (!candidate) {
      runtime.resident = true;
      return;
    }
    candidate.controller?.abort();
    candidate.resident = false;
    candidate.stale = true;
    candidate.pending = false;
    this.clearTimers(candidate);
    await candidate.session?.dispose();
    candidate.session = undefined;
    candidate.appliedOverlays.clear();
    candidate.savedVersions.clear();
    this.logger.verbose('project.evicted', {
      projectKey: candidate.association.key,
      reason: runtime.association.key,
    });
  }

  private sessionOptions(
    association: HostProjectAssociation
  ): DiscoveryOptions & {eagerness: 'lazy'} {
    const base = {
      currentDirectory: association.currentDirectory,
      eagerness: 'lazy' as const,
      retentionBound: 1,
      collectTiming: this.settings.collectTiming,
    };
    if (association.kind === 'configured') {
      return {
        ...base,
        mode: 'consumer',
        configFileName: association.configFileName!,
      };
    }
    return {
      ...base,
      mode: 'standalone',
      rootFiles: this.tracker
        .documents()
        .filter(
          (document) => this.associations.get(document.uri) === association.key
        )
        .map((document) => document.fileName),
    };
  }

  private isCurrent(
    runtime: ProjectRuntime,
    revision: number,
    controller: AbortController,
    versions: ReadonlyMap<string, {version: number; isDirty: boolean}>
  ): boolean {
    return (
      !this.disposed &&
      runtime.resident &&
      runtime.revision === revision &&
      !controller.signal.aborted &&
      this.tracker.documents().every((document) => {
        const captured = versions.get(document.uri);
        if (!captured || captured.isDirty !== document.isDirty) {
          return false;
        }
        return !document.isDirty || captured.version === document.version;
      })
    );
  }

  private async logResources(
    runtime: ProjectRuntime,
    view: RegistryView,
    durationMs: number
  ): Promise<void> {
    if (!this.settings.collectTiming || !runtime.session) {
      return;
    }
    const timing = await runtime.session.getTimingInfo();
    const memory = process.memoryUsage();
    this.logger.verbose('analysis.resources', {
      projectKey: runtime.association.key,
      durationMs,
      components: view.components().length,
      retainedViews: 1,
      overlayBytes: [...runtime.appliedOverlays.values()].reduce(
        (total, text) => total + Buffer.byteLength(text),
        0
      ),
      requestCount: timing.totals.requestCount,
      bytesSent: timing.totals.bytesSent,
      bytesReceived: timing.totals.bytesReceived,
      roundTripMs: timing.totals.roundTripMs,
      serverTimeMs: timing.totals.serverTimeMs,
      transportOverheadMs: timing.totals.transportOverheadMs,
      sharedExtensionHostHeapUsed: memory.heapUsed,
      sharedExtensionHostRss: memory.rss,
    });
    this.logger.debug('analysis.timing', {
      projectKey: runtime.association.key,
      recentRequests: timing.recentRequests,
    });
  }

  private runtimeFor(document: TrackedDocument): ProjectRuntime | undefined {
    const key = this.associations.get(document.uri);
    return key ? this.runtimes.get(key) : undefined;
  }

  private clearTimers(runtime: ProjectRuntime): void {
    if (runtime.debounceTimer) {
      clearTimeout(runtime.debounceTimer);
      runtime.debounceTimer = undefined;
    }
    if (runtime.maxWaitTimer) {
      clearTimeout(runtime.maxWaitTimer);
      runtime.maxWaitTimer = undefined;
    }
  }

  private documentFields(
    document: TrackedDocument
  ): Readonly<Record<string, unknown>> {
    return {uri: document.uri, version: document.version};
  }
}
