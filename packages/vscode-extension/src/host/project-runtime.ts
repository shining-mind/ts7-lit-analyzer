import {
  type DiscoveryOptions,
  type LazyRegistrySession,
  type RegistryView,
} from '@ts7-lit-analyzer/analyzer-core';

import type {DocumentTracker, TrackedDocument} from './documents.js';
import type {CoordinatorLogger} from './logging.js';
import type {HostProjectAssociation} from './project-router.js';

export interface ProjectRuntimeExecutionContext {
  tracker: DocumentTracker;
  savedDocuments: ReadonlyMap<string, TrackedDocument>;
  associations: ReadonlyMap<string, string>;
  collectTiming(): boolean;
  isDisposed(): boolean;
  logger: CoordinatorLogger;
  createSession(
    options: DiscoveryOptions & {eagerness: 'lazy'}
  ): Promise<LazyRegistrySession>;
}

export class ProjectRuntime {
  association: HostProjectAssociation;
  readonly openFiles = new Set<string>();
  session: LazyRegistrySession | undefined;
  appliedOverlays = new Map<string, string>();
  readonly savedVersions = new Map<string, number>();
  view: RegistryView | undefined;
  revision = 0;
  acceptedRevision = 0;
  resident = true;
  stale = true;
  pending = false;
  due = false;
  lastUsed = Date.now();
  debounceTimer: ReturnType<typeof setTimeout> | undefined;
  maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  controller: AbortController | undefined;
  error: string | undefined;

  constructor(association: HostProjectAssociation) {
    this.association = association;
  }

  async execute(context: ProjectRuntimeExecutionContext): Promise<void> {
    if (context.isDisposed() || !this.resident) {
      this.pending = false;
      return;
    }
    const startedAt = context.collectTiming() ? performance.now() : undefined;
    const revision = this.revision;
    const versions = new Map(
      context.tracker
        .documents()
        .map((document) => [
          document.uri,
          {version: document.version, isDirty: document.isDirty},
        ])
    );
    const controller = new AbortController();
    this.controller = controller;
    this.pending = false;
    this.due = false;
    context.logger.debug('analysis.started', {
      projectKey: this.association.key,
      revision,
    });

    try {
      const session = await this.ensureSession(
        context,
        revision,
        versions,
        controller
      );
      if (!session) {
        return;
      }
      const {saved, currentFiles} = await this.reconcile(
        context,
        session,
        controller
      );
      const view = session.current();
      if (!view || !this.isCurrent(context, revision, versions, controller)) {
        context.logger.debug('analysis.rejected', {
          projectKey: this.association.key,
          revision,
          runtimeRevision: this.revision,
          resident: this.resident,
          aborted: controller.signal.aborted,
          capturedVersions: Object.fromEntries(versions),
          currentVersions: context.tracker.documents().map((document) => ({
            uri: document.uri,
            version: document.version,
            isDirty: document.isDirty,
          })),
        });
        return;
      }
      if (
        this.view &&
        this.acceptedRevision === revision &&
        view.generation <= this.view.generation
      ) {
        context.logger.debug('analysis.generationRejected', {
          projectKey: this.association.key,
          revision,
          acceptedRevision: this.acceptedRevision,
          viewGeneration: view.generation,
          currentGeneration: this.view.generation,
        });
        return;
      }
      await this.accept(
        context,
        view,
        saved,
        currentFiles,
        revision,
        startedAt === undefined ? 0 : performance.now() - startedAt
      );
    } catch (error) {
      if (this.isCurrent(context, revision, versions, controller)) {
        if (controller.signal.aborted) {
          context.logger.debug('analysis.cancelled', {
            projectKey: this.association.key,
            revision,
          });
        } else {
          this.error = error instanceof Error ? error.message : String(error);
          context.logger.error('analysis.failed', {
            projectKey: this.association.key,
            error: this.error,
          });
        }
      }
    } finally {
      context.logger.debug('analysis.finished', {
        projectKey: this.association.key,
        revision,
        acceptedRevision: this.acceptedRevision,
        viewGeneration: this.view?.generation,
      });
      if (this.controller === controller) {
        this.controller = undefined;
      }
    }
  }

  private async ensureSession(
    context: ProjectRuntimeExecutionContext,
    revision: number,
    versions: ReadonlyMap<string, {version: number; isDirty: boolean}>,
    controller: AbortController
  ): Promise<LazyRegistrySession | undefined> {
    if (this.session) {
      return this.session;
    }
    const created = await context.createSession(this.sessionOptions(context));
    if (!this.isCurrent(context, revision, versions, controller)) {
      await created.dispose();
      return undefined;
    }
    this.session = created;
    context.logger.debug('analysis.sessionCreated', {
      projectKey: this.association.key,
    });
    return created;
  }

  private async reconcile(
    context: ProjectRuntimeExecutionContext,
    session: LazyRegistrySession,
    controller: AbortController
  ): Promise<{
    saved: readonly TrackedDocument[];
    currentFiles: Map<string, string>;
  }> {
    const dirty = context.tracker.dirtyDocuments();
    const currentFiles = new Map(
      dirty.map((document) => [document.fileName, document.text])
    );
    const removed = this.appliedOverlays
      .keys()
      .filter((fileName) => !currentFiles.has(fileName))
      .toArray();
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
    const saved = context.savedDocuments
      .values()
      .filter(
        (document) => this.savedVersions.get(document.uri) !== document.version
      )
      .toArray();
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
      this.openFiles
        .values()
        .map((uri) => {
          const document = context.tracker
            .documents()
            .find((item) => item.uri === uri);
          return document?.fileName ?? uri;
        })
        .toArray(),
      {signal: controller.signal}
    );
    context.logger.debug('analysis.scopeCollected', {
      projectKey: this.association.key,
    });
    const ids =
      session
        .current()
        ?.components()
        .map((component) => component.declarationEvidence.id) ?? [];
    if (ids.length > 0) {
      await session.enrich(ids, {signal: controller.signal});
      await session.materializeTypes({signal: controller.signal});
    }
    context.logger.debug('analysis.materialized', {
      projectKey: this.association.key,
    });
    return {saved, currentFiles};
  }

  private async accept(
    context: ProjectRuntimeExecutionContext,
    view: RegistryView,
    saved: readonly TrackedDocument[],
    currentFiles: ReadonlyMap<string, string>,
    revision: number,
    durationMs: number
  ): Promise<void> {
    for (const document of saved) {
      const currentDocument = context.tracker
        .documents()
        .find((candidate) => candidate.uri === document.uri);
      if (currentDocument && !currentDocument.isDirty) {
        this.savedVersions.set(document.uri, document.version);
      }
    }
    this.appliedOverlays = new Map(currentFiles);
    this.view = view;
    this.acceptedRevision = revision;
    this.stale = false;
    this.error = undefined;
    this.lastUsed = Date.now();
    context.logger.verbose('analysis.accepted', {
      projectKey: this.association.key,
      revision,
      generation: view.generation,
      components: view.components().length,
      ...(view.moduleResolutionFallbackCount !== undefined
        ? {moduleResolutionFallbackCount: view.moduleResolutionFallbackCount}
        : {}),
    });
    await this.logResources(context, view, durationMs);
  }

  private isCurrent(
    context: ProjectRuntimeExecutionContext,
    revision: number,
    versions: ReadonlyMap<string, {version: number; isDirty: boolean}>,
    controller: AbortController
  ): boolean {
    return (
      !context.isDisposed() &&
      this.resident &&
      this.revision === revision &&
      !controller.signal.aborted &&
      context.tracker.documents().every((document) => {
        const captured = versions.get(document.uri);
        if (!captured || captured.isDirty !== document.isDirty) {
          return false;
        }
        return !document.isDirty || captured.version === document.version;
      })
    );
  }

  private sessionOptions(
    context: ProjectRuntimeExecutionContext
  ): DiscoveryOptions & {eagerness: 'lazy'} {
    const base = {
      currentDirectory: this.association.currentDirectory,
      eagerness: 'lazy' as const,
      retentionBound: 1,
      collectTiming: context.collectTiming(),
    };
    if (this.association.kind === 'configured') {
      return {
        ...base,
        mode: 'consumer',
        configFileName: this.association.configFileName!,
      };
    }
    return {
      ...base,
      mode: 'standalone',
      rootFiles: context.tracker
        .documents()
        .filter(
          (document) =>
            context.associations.get(document.uri) === this.association.key
        )
        .map((document) => document.fileName),
    };
  }

  private async logResources(
    context: ProjectRuntimeExecutionContext,
    view: RegistryView,
    durationMs: number
  ): Promise<void> {
    if (!context.collectTiming() || !this.session) {
      return;
    }
    const timing = await this.session.getTimingInfo();
    const memory = process.memoryUsage();
    context.logger.verbose('analysis.resources', {
      projectKey: this.association.key,
      durationMs,
      components: view.components().length,
      retainedViews: 1,
      overlayBytes: this.appliedOverlays
        .values()
        .reduce((total, text) => total + Buffer.byteLength(text), 0),
      requestCount: timing.totals.requestCount,
      bytesSent: timing.totals.bytesSent,
      bytesReceived: timing.totals.bytesReceived,
      roundTripMs: timing.totals.roundTripMs,
      serverTimeMs: timing.totals.serverTimeMs,
      transportOverheadMs: timing.totals.transportOverheadMs,
      sharedExtensionHostHeapUsed: memory.heapUsed,
      sharedExtensionHostRss: memory.rss,
    });
    context.logger.debug('analysis.timing', {
      projectKey: this.association.key,
      recentRequests: timing.recentRequests,
    });
  }
}
