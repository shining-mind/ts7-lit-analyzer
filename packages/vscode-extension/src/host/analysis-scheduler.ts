import type {LazyRegistrySession} from '@ts7-lit-analyzer/analyzer-core';

import type {CoordinatorLogger} from './logging.js';
import type {ProjectRuntime} from './project-runtime.js';

export interface AnalysisSchedulerSettings {
  trigger: 'onType' | 'onSave';
  debounceMs: number;
  maxWaitMs: number;
}

export interface AnalysisSchedulerOptions {
  settings(): AnalysisSchedulerSettings;
  isDisposed(): boolean;
  execute(runtime: ProjectRuntime): Promise<void>;
  logger: CoordinatorLogger;
}

export class AnalysisScheduler {
  /** Serializes session mutations and disposal across all resident projects. */
  private mutationQueue: Promise<void> = Promise.resolve();

  private readonly settings: () => AnalysisSchedulerSettings;
  private readonly isDisposed: () => boolean;
  private readonly execute: (runtime: ProjectRuntime) => Promise<void>;
  private readonly logger: CoordinatorLogger;

  constructor(options: AnalysisSchedulerOptions) {
    this.settings = options.settings;
    this.isDisposed = options.isDisposed;
    this.execute = options.execute;
    this.logger = options.logger;
  }

  schedule(runtime: ProjectRuntime, immediate: boolean): void {
    if (this.isDisposed() || !runtime.resident) {
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
    if (immediate || this.settings().trigger === 'onSave') {
      this.clearTimers(runtime);
      this.enqueue(runtime);
      return;
    }
    if (!runtime.maxWaitTimer) {
      runtime.maxWaitTimer = setTimeout(() => {
        runtime.maxWaitTimer = undefined;
        runtime.due = true;
        this.enqueue(runtime);
      }, this.settings().maxWaitMs);
    }
    if (runtime.debounceTimer) {
      clearTimeout(runtime.debounceTimer);
    }
    runtime.debounceTimer = setTimeout(() => {
      runtime.debounceTimer = undefined;
      runtime.due = true;
      this.enqueue(runtime);
    }, this.settings().debounceMs);
  }

  enqueue(runtime: ProjectRuntime): void {
    if (this.isDisposed() || !runtime.resident) {
      return;
    }
    this.clearTimers(runtime);
    this.mutationQueue = this.mutationQueue.then(() => this.execute(runtime));
  }

  disposeSession(session: LazyRegistrySession): void {
    this.mutationQueue = this.mutationQueue.then(() => session.dispose());
  }

  async settled(): Promise<void> {
    await this.mutationQueue;
  }

  async idle(runtimes: ReadonlyMap<string, ProjectRuntime>): Promise<void> {
    while (
      runtimes.values().some((runtime) => runtime.pending || runtime.controller)
    ) {
      for (const runtime of runtimes.values()) {
        if (runtime.pending && runtime.resident) {
          this.clearTimers(runtime);
          this.enqueue(runtime);
        }
      }
      await this.settled();
    }
  }

  clearTimers(runtime: ProjectRuntime): void {
    if (runtime.debounceTimer) {
      clearTimeout(runtime.debounceTimer);
      runtime.debounceTimer = undefined;
    }
    if (runtime.maxWaitTimer) {
      clearTimeout(runtime.maxWaitTimer);
      runtime.maxWaitTimer = undefined;
    }
  }
}
