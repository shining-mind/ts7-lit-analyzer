import type {LazyRegistrySession} from '@ts7-lit-analyzer/analyzer-core';

import type {
  ProjectRuntime,
  ProjectRuntimeExecutionContext,
} from './project-runtime.js';
import {RunAcceptance, type DocumentVersions} from './run-acceptance.js';

/** Orchestrates one analysis run without taking ownership of runtime state. */
export class ProjectRunExecutor {
  private readonly acceptance: RunAcceptance;

  constructor(acceptance: RunAcceptance) {
    this.acceptance = acceptance;
  }

  async execute(
    runtime: ProjectRuntime,
    context: ProjectRuntimeExecutionContext
  ): Promise<void> {
    if (context.isDisposed() || !runtime.resident) {
      runtime.pending = false;
      return;
    }
    const startedAt = context.collectTiming() ? performance.now() : undefined;
    const revision = runtime.revision;
    const versions = this.acceptance.captureVersions();
    const controller = new AbortController();
    runtime.controller = controller;
    runtime.pending = false;
    runtime.due = false;
    context.logger.debug('analysis.started', {
      projectKey: runtime.association.key,
      revision,
    });

    try {
      const session = await this.ensureSession(
        runtime,
        context,
        revision,
        versions,
        controller
      );
      if (!session) {
        return;
      }
      const {saved, currentFiles} = await runtime.reconcile(
        context,
        session,
        controller
      );
      const view = session.current();
      if (
        !this.acceptance.canAccept(
          runtime,
          view,
          revision,
          versions,
          controller
        )
      ) {
        return;
      }
      await runtime.acceptCurrentView(
        context,
        view,
        saved,
        currentFiles,
        revision,
        startedAt === undefined ? 0 : performance.now() - startedAt
      );
    } catch (error) {
      this.acceptance.handleFailure(
        runtime,
        error,
        revision,
        versions,
        controller
      );
    } finally {
      context.logger.debug('analysis.finished', {
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

  private async ensureSession(
    runtime: ProjectRuntime,
    context: ProjectRuntimeExecutionContext,
    revision: number,
    versions: DocumentVersions,
    controller: AbortController
  ): Promise<LazyRegistrySession | undefined> {
    if (runtime.session) {
      return runtime.session;
    }
    const created = await context.createSession(
      runtime.sessionOptions(context)
    );
    if (!this.acceptance.isCurrent(runtime, revision, versions, controller)) {
      await created.dispose();
      return undefined;
    }
    runtime.session = created;
    context.logger.debug('analysis.sessionCreated', {
      projectKey: runtime.association.key,
    });
    return created;
  }
}
