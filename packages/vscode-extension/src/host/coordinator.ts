import {
  createRegistrySession,
  type DiscoveryOptions,
  type LazyRegistrySession,
} from '@ts7-lit-analyzer/analyzer-core';
import {window, type Disposable} from 'vscode';

import {AnalysisScheduler} from './analysis-scheduler.js';
import {DocumentTracker, type TrackedDocument} from './documents.js';
import type {CoordinatorLogger} from './logging.js';
import type {ProjectRuntime} from './project-runtime.js';
import type {ProjectRuntimeExecutionContext} from './project-runtime.js';
import type {ProjectRouter} from './project-router.js';
import {RuntimeRegistry} from './runtime-registry.js';

export type {CoordinatorLogger} from './logging.js';

export interface CoordinatorSettings {
  trigger: 'onType' | 'onSave';
  debounceMs: number;
  maxWaitMs: number;
  maxResidentProjects: number;
  collectTiming: boolean;
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

const silentLogger: CoordinatorLogger = {
  normal() {},
  verbose() {},
  debug() {},
  error() {},
};

/**
 * Mediates document events, project routing, scheduling, and per-project
 * execution without implementing analyzer semantics.
 */
export class EditorAnalysisCoordinator implements Disposable {
  private readonly logger: CoordinatorLogger;
  private readonly createSession: (
    options: DiscoveryOptions & {eagerness: 'lazy'}
  ) => Promise<LazyRegistrySession>;
  private readonly tracker: DocumentTracker;
  private readonly activeSubscription: Disposable;
  private readonly registry: RuntimeRegistry;
  private readonly scheduler: AnalysisScheduler;
  private readonly savedDocuments = new Map<string, TrackedDocument>();
  private settings: CoordinatorSettings;
  private disposed = false;

  constructor(options: CoordinatorOptions) {
    this.settings = options.settings;
    this.logger = options.logger ?? silentLogger;
    this.createSession = options.createSession ?? createRegistrySession;
    this.tracker = new DocumentTracker({
      opened: this.opened.bind(this),
      changed: this.changed.bind(this),
      saved: this.saved.bind(this),
      closed: this.closed.bind(this),
    });
    this.scheduler = new AnalysisScheduler({
      settings: () => this.settings,
      isDisposed: () => this.disposed,
      execute: this.execute.bind(this),
      logger: this.logger,
    });
    this.registry = new RuntimeRegistry({
      router: options.router,
      logger: this.logger,
      isDisposed: () => this.disposed,
      maxResidentProjects: () => this.settings.maxResidentProjects,
      clearTimers: (runtime) => this.scheduler.clearTimers(runtime),
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

  private get associations(): Map<string, string> {
    return this.registry.associations;
  }

  private get runtimes(): Map<string, ProjectRuntime> {
    return this.registry.runtimes;
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
        this.scheduler.clearTimers(runtime);
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
          this.scheduler.disposeSession(session);
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
      runtimes: this.runtimes
        .values()
        .map((runtime) => ({
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
          overlayBytes: runtime.appliedOverlays
            .values()
            .reduce((total, text) => total + Buffer.byteLength(text), 0),
          openFiles: runtime.openFiles.values().toArray(),
          ...(runtime.error ? {error: runtime.error} : {}),
        }))
        .toArray(),
      executing: this.runtimes
        .values()
        .some((runtime) => runtime.controller !== undefined),
    };
  }

  async idle(): Promise<void> {
    await this.scheduler.idle(this.runtimes);
  }

  async dispose(): Promise<void> {
    if (this.disposed) {
      return;
    }
    this.disposed = true;
    this.activeSubscription.dispose();
    this.tracker.dispose();
    for (const runtime of this.runtimes.values()) {
      this.scheduler.clearTimers(runtime);
      runtime.controller?.abort();
      runtime.resident = false;
    }
    await this.scheduler.settled();
    for (const runtime of this.runtimes.values()) {
      await runtime.session?.dispose();
      runtime.session = undefined;
    }
    this.logger.normal('coordinator.disposed');
  }

  private opened(document: TrackedDocument): void {
    this.logger.verbose('document.opened', this.documentFields(document));
    void this.registry
      .route(document)
      .then(() => this.scheduleDocument(document, true));
  }

  private changed(document: TrackedDocument): void {
    this.logger.verbose('document.changed', this.documentFields(document));
    this.savedDocuments.delete(document.uri);
    void this.registry.route(document).then(() => {
      if (this.settings.trigger === 'onSave') {
        const runtime = this.registry.runtimeFor(document);
        if (runtime) {
          runtime.stale = true;
          runtime.revision += 1;
          runtime.controller?.abort();
        }
      } else {
        this.scheduleDocument(document, false);
      }
    });
  }

  private saved(document: TrackedDocument): void {
    this.logger.verbose('document.saved', this.documentFields(document));
    this.savedDocuments.set(document.uri, document);
    void this.registry.route(document).then(() => this.scheduleResidents(true));
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
    await this.registry.route(document);
    const key = this.associations.get(document.uri);
    if (key) {
      this.registry.activeProjectKey = key;
      const runtime = this.runtimes.get(key);
      if (runtime) {
        runtime.lastUsed = Date.now();
        runtime.resident = true;
        this.scheduler.schedule(runtime, true);
      }
    }
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
      this.scheduler.schedule(runtime, immediate);
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
        this.scheduler.schedule(runtime, immediate);
      }
    }
  }

  private scheduleResidents(immediate: boolean): void {
    for (const runtime of this.runtimes.values()) {
      if (runtime.resident) {
        this.scheduler.schedule(runtime, immediate);
      }
    }
  }

  private async execute(runtime: ProjectRuntime): Promise<void> {
    if (this.disposed || !runtime.resident || !runtime.due) {
      runtime.pending = false;
      return;
    }
    await this.registry.makeResident(runtime);
    await runtime.execute(this.executionContext());
  }

  private executionContext(): ProjectRuntimeExecutionContext {
    return {
      tracker: this.tracker,
      savedDocuments: this.savedDocuments,
      associations: this.associations,
      collectTiming: () => this.settings.collectTiming,
      isDisposed: () => this.disposed,
      logger: this.logger,
      createSession: this.createSession,
    };
  }

  private documentFields(
    document: TrackedDocument
  ): Readonly<Record<string, unknown>> {
    return {uri: document.uri, version: document.version};
  }
}
