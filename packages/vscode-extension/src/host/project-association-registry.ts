import type {TrackedDocument} from './documents.js';
import type {CoordinatorLogger} from './logging.js';
import {ProjectRuntime} from './project-runtime.js';
import type {HostProjectAssociation, ProjectRouter} from './project-router.js';

export interface ProjectAssociationRegistryOptions {
  router: ProjectRouter;
  logger: CoordinatorLogger;
  isDisposed(): boolean;
  maxResidentProjects(): number;
  clearTimers(runtime: ProjectRuntime): void;
  isDocumentOpen(document: TrackedDocument): boolean;
}

/**
 * Owns document-to-project associations and their runtimes. Deduplicates
 * asynchronous routing and enforces bounded LRU residency without implementing
 * analysis or scheduling policies.
 */
export class ProjectAssociationRegistry {
  readonly associations = new Map<string, string>();
  readonly runtimes = new Map<string, ProjectRuntime>();
  activeProjectKey: string | undefined;

  private readonly routing = new Map<string, Promise<void>>();
  private readonly router: ProjectRouter;
  private readonly logger: CoordinatorLogger;
  private readonly isDisposed: () => boolean;
  private readonly maxResidentProjects: () => number;
  private readonly clearTimers: (runtime: ProjectRuntime) => void;
  private readonly isDocumentOpen: (document: TrackedDocument) => boolean;

  constructor(options: ProjectAssociationRegistryOptions) {
    this.router = options.router;
    this.logger = options.logger;
    this.isDisposed = options.isDisposed;
    this.maxResidentProjects = options.maxResidentProjects;
    this.clearTimers = options.clearTimers;
    this.isDocumentOpen = options.isDocumentOpen;
  }

  /** Associates a document with its project runtime, deduplicating concurrent requests. */
  async associate(document: TrackedDocument): Promise<void> {
    if (this.isDisposed() || this.associations.has(document.uri)) {
      return;
    }
    let pending = this.routing.get(document.uri);
    if (!pending) {
      pending = this.createAssociation(document);
      this.routing.set(document.uri, pending);
    }
    await pending;
  }

  /** Marks a runtime active and immediately cancels its LRU eviction candidate. */
  activate(runtime: ProjectRuntime): void {
    this.activeProjectKey = runtime.association.key;
    runtime.lastUsed = Date.now();
    runtime.resident = true;
    const residentCount = this.runtimes
      .values()
      .reduce((count, candidate) => count + (candidate.resident ? 1 : 0), 0);
    const candidate =
      residentCount > this.maxResidentProjects()
        ? this.evictionCandidate(runtime)
        : undefined;

    if (candidate) {
      candidate.controller?.abort();
      candidate.stale = true;
      candidate.pending = false;
      this.clearTimers(candidate);
    }
  }

  /**
   * Ensures the runtime is resident, evicting the least-recently-used non-active
   * runtime when the resident-project limit is reached. The evicted session is
   * disposed before execution can continue.
   */
  async makeResident(runtime: ProjectRuntime): Promise<void> {
    const residents = this.runtimes
      .values()
      .filter((candidate) => candidate.resident)
      .toArray();
    if (residents.length <= this.maxResidentProjects()) {
      runtime.resident = true;
      return;
    }
    const candidate =
      this.evictionCandidate(runtime) ??
      (this.activeProjectKey === runtime.association.key ? undefined : runtime);
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

  runtimeFor(document: TrackedDocument): ProjectRuntime | undefined {
    const key = this.associations.get(document.uri);
    return key ? this.runtimes.get(key) : undefined;
  }

  private evictionCandidate(
    runtime: ProjectRuntime
  ): ProjectRuntime | undefined {
    return this.runtimes
      .values()
      .filter(
        (candidate) =>
          candidate.resident &&
          candidate !== runtime &&
          candidate.association.key !== this.activeProjectKey
      )
      .toArray()
      .sort((first, second) => first.lastUsed - second.lastUsed)[0];
  }

  private createAssociation(document: TrackedDocument): Promise<void> {
    return this.router.associate(document).then((association) => {
      if (this.isDisposed() || !this.isDocumentOpen(document)) {
        this.routing.delete(document.uri);
        return;
      }
      this.associations.set(document.uri, association.key);
      const runtime = this.getOrCreateRuntime(association);
      runtime.openFiles.add(document.uri);
      this.routing.delete(document.uri);
      this.logger.verbose('project.associated', {
        uri: document.uri,
        projectKey: association.key,
      });
    });
  }

  private getOrCreateRuntime(
    association: HostProjectAssociation
  ): ProjectRuntime {
    const existing = this.runtimes.get(association.key);
    if (existing) {
      existing.association = association;
      existing.resident = true;
      return existing;
    }
    const created = new ProjectRuntime(association);
    this.runtimes.set(association.key, created);
    return created;
  }
}
