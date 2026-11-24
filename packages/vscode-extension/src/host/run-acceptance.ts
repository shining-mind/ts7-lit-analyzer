import type {RegistryView} from '@ts7-lit-analyzer/analyzer-core';

import type {DocumentTracker} from './documents.js';
import type {CoordinatorLogger} from './logging.js';
import type {ProjectRuntime} from './project-runtime.js';

export type DocumentVersions = ReadonlyMap<
  string,
  {version: number; isDirty: boolean}
>;

export interface RunAcceptanceOptions {
  tracker: DocumentTracker;
  isDisposed(): boolean;
  logger: CoordinatorLogger;
}

/** Decides whether an analysis run and its candidate view remain current. */
export class RunAcceptance {
  private readonly tracker: DocumentTracker;
  private readonly isDisposed: () => boolean;
  private readonly logger: CoordinatorLogger;

  constructor(options: RunAcceptanceOptions) {
    this.tracker = options.tracker;
    this.isDisposed = options.isDisposed;
    this.logger = options.logger;
  }

  captureVersions(): DocumentVersions {
    return new Map(
      this.tracker
        .documents()
        .map((document) => [
          document.uri,
          {version: document.version, isDirty: document.isDirty},
        ])
    );
  }

  canAccept(
    runtime: ProjectRuntime,
    view: RegistryView | undefined,
    revision: number,
    versions: DocumentVersions,
    controller: AbortController
  ): view is RegistryView {
    if (!view || !this.isCurrent(runtime, revision, versions, controller)) {
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
      return false;
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
      return false;
    }
    return true;
  }

  isCurrent(
    runtime: ProjectRuntime,
    revision: number,
    versions: DocumentVersions,
    controller: AbortController
  ): boolean {
    return (
      !this.isDisposed() &&
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

  handleFailure(
    runtime: ProjectRuntime,
    error: unknown,
    revision: number,
    versions: DocumentVersions,
    controller: AbortController
  ): void {
    if (!this.isCurrent(runtime, revision, versions, controller)) {
      return;
    }
    if (controller.signal.aborted) {
      this.logger.debug('analysis.cancelled', {
        projectKey: runtime.association.key,
        revision,
      });
    } else {
      runtime.error = error instanceof Error ? error.message : String(error);
      this.logger.error('analysis.failed', {
        projectKey: runtime.association.key,
        error: runtime.error,
      });
    }
  }
}
