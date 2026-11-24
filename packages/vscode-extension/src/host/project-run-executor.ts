import type {LazyRegistrySession} from '@ts7-lit-analyzer/analyzer-core';

import type {
  ProjectRuntime,
  ProjectRuntimeExecutionContext,
} from './project-runtime.js';
import {RunAcceptance, type AnalysisRun} from './run-acceptance.js';

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
    const run: AnalysisRun = {
      runtime,
      revision: runtime.revision,
      versions: this.acceptance.captureVersions(),
      controller: new AbortController(),
      startedAt: context.collectTiming() ? performance.now() : undefined,
    };
    const {revision, controller} = run;
    runtime.controller = controller;
    runtime.pending = false;
    runtime.due = false;
    context.logger.debug('analysis.started', {
      projectKey: runtime.association.key,
      revision,
    });

    try {
      const session = await this.ensureSession(run, context);
      if (!session) {
        return;
      }
      const {saved, currentFiles} = await runtime.reconcile(
        context,
        session,
        controller
      );
      const view = session.current();
      if (!this.acceptance.canAccept(run, view)) {
        return;
      }
      await runtime.acceptCurrentView(context, run, {
        view,
        saved,
        currentFiles,
        durationMs:
          run.startedAt === undefined ? 0 : performance.now() - run.startedAt,
      });
    } catch (error) {
      this.acceptance.handleFailure(run, error);
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
    run: AnalysisRun,
    context: ProjectRuntimeExecutionContext
  ): Promise<LazyRegistrySession | undefined> {
    const {runtime, revision} = run;
    if (runtime.session) {
      return runtime.session;
    }
    const created = await context.createSession(
      runtime.sessionOptions(context)
    );
    if (!this.acceptance.isCurrent(run)) {
      await created.dispose();
      return undefined;
    }
    runtime.session = created;
    context.logger.debug('analysis.sessionCreated', {
      projectKey: runtime.association.key,
      revision,
    });
    return created;
  }
}
