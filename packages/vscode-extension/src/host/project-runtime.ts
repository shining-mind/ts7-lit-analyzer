import {
  type DiscoveryOptions,
  type LazyRegistrySession,
  type RegistryView,
} from '@ts7-lit-analyzer/analyzer-core';

import type {DocumentTracker, TrackedDocument} from './documents.js';
import type {CoordinatorLogger} from './logging.js';
import type {HostProjectAssociation} from './project-router.js';
import type {AnalysisRun} from './run-acceptance.js';

export interface AcceptedRunResult {
  view: RegistryView;
  saved: readonly TrackedDocument[];
  currentFiles: ReadonlyMap<string, string>;
  durationMs: number;
}

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

/**
 * Owns project-local session and overlay state. Reconciles document inputs and
 * applies views accepted by `ProjectRunExecutor`; global freshness is decided
 * by `RunAcceptance`.
 */
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

  async reconcile(
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

    const current = session.current();
    const ids = current
      ? current
          .components()
          .map((component) => component.declarationEvidence.id)
      : [];

    if (ids.length > 0) {
      await session.enrich(ids, {signal: controller.signal});
      await session.materializeTypes({signal: controller.signal});
    }
    context.logger.debug('analysis.materialized', {
      projectKey: this.association.key,
    });

    return {saved, currentFiles};
  }

  /** Applies a view that `RunAcceptance` has already approved. */
  async acceptCurrentView(
    context: ProjectRuntimeExecutionContext,
    run: AnalysisRun,
    result: AcceptedRunResult
  ): Promise<void> {
    const {view, saved, currentFiles, durationMs} = result;
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
    this.acceptedRevision = run.revision;
    this.stale = false;
    this.error = undefined;
    this.lastUsed = Date.now();
    context.logger.verbose('analysis.accepted', {
      projectKey: this.association.key,
      revision: run.revision,
      generation: view.generation,
      components: view.components().length,
      ...(view.moduleResolutionFallbackCount !== undefined
        ? {moduleResolutionFallbackCount: view.moduleResolutionFallbackCount}
        : {}),
    });
    await this.logResources(context, view, durationMs);
  }

  sessionOptions(
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
