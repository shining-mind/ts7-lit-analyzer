import {
  createDiscoverySession,
  type DiscoveryOperationOptions,
  type DiscoveryOptions,
  type DiscoveryResult,
  type DiscoverySession,
  type DiscoveryTimingInfo,
  type LazyDiscoverySession,
  type MemberTypeQuery,
  type SemanticReference,
  type SourceOverlay,
} from '@ts7-lit-analyzer/cem-analyzer-ts7';

import {
  createRegistryView,
  findProperty,
  type RegistryView,
} from './registry.js';
import {RegistrySemantics, type SemanticProvider} from './semantics.js';
import type {WebComponentRecord} from '@ts7-lit-analyzer/cem-analyzer-ts7';

/**
 * A single-project registry session composing the discovery engine. It applies
 * collected results to an immutable registry view and delegates semantic
 * operations to the engine; it owns no parallel TypeScript semantics.
 */
export interface RegistrySession {
  /**
   * Collects an eager registry view. A lazy session returns its current view
   * without expanding the active scope.
   */
  collect(options?: DiscoveryOperationOptions): Promise<RegistryView>;

  /** Applies unsaved source overlays and returns a successor registry view. */
  update(
    overlays: readonly SourceOverlay[],
    options?: DiscoveryOperationOptions
  ): Promise<RegistryView>;

  /**
   * Removes unsaved overlays and restores configured or filesystem content.
   * Names without an active overlay are ignored.
   */
  removeOverlays(
    fileNames: readonly string[],
    options?: DiscoveryOperationOptions
  ): Promise<RegistryView>;

  /**
   * Returns a member's display type and semantic reference, or `undefined`
   * when no collected type is available.
   */
  memberType(
    componentId: string,
    memberName: string,
    options?: DiscoveryOperationOptions
  ): Promise<MemberTypeQuery | undefined>;

  /**
   * Checks assignability through the TypeScript checker. Both references must
   * belong to the current project and snapshot.
   */
  isAssignable(
    source: SemanticReference,
    target: SemanticReference,
    options?: DiscoveryOperationOptions
  ): Promise<boolean>;

  /**
   * Checks a source type against a member's collected semantic reference.
   * Display type text is never used for assignability.
   *
   * @throws {Error} If the member has no collected semantic type.
   */
  isAssignableToMember(
    source: SemanticReference,
    record: WebComponentRecord,
    memberName: string,
    options?: DiscoveryOperationOptions
  ): Promise<boolean>;

  /** Returns the engine's serializable diagnostic timing measurements. */
  getTimingInfo(): Promise<DiscoveryTimingInfo>;

  /** Clears client and native timing history for subsequent measurements. */
  resetTimingInfo(): Promise<void>;

  /** Returns the latest successfully applied view, if one exists. */
  current(): RegistryView | undefined;

  /** Disposes the engine and all snapshots retained by the session. */
  dispose(): Promise<void>;
}

export interface LazyRegistrySession extends RegistrySession {
  /**
   * Extends the active scope and returns a view whose records may still require
   * enrichment for complete semantics.
   */
  collectScope(
    files: readonly string[],
    options?: DiscoveryOperationOptions
  ): Promise<RegistryView>;

  /**
   * Collects complete component semantics and metadata for indexed IDs.
   *
   * @throws {Error} If an ID is not present in the current registration index.
   */
  enrich(
    componentIds: readonly string[],
    options?: DiscoveryOperationOptions
  ): Promise<RegistryView>;

  /** Materializes display types for enriched members without expanding scope. */
  materializeTypes(options?: DiscoveryOperationOptions): Promise<RegistryView>;
}

export async function createRegistrySession(
  options: DiscoveryOptions & {eagerness: 'lazy'}
): Promise<LazyRegistrySession>;
export async function createRegistrySession(
  options: DiscoveryOptions
): Promise<RegistrySession>;
export async function createRegistrySession(
  options: DiscoveryOptions
): Promise<RegistrySession> {
  const engine = await createDiscoverySession(options);
  return new RegistrySessionImpl(engine, options.eagerness === 'lazy');
}

class RegistrySessionImpl implements LazyRegistrySession {
  private readonly engine: DiscoverySession;
  private readonly lazy: boolean;
  private readonly semantics: RegistrySemantics;
  private view: RegistryView | undefined;
  private disposed = false;

  constructor(engine: DiscoverySession, lazy: boolean) {
    this.engine = engine;
    this.lazy = lazy;
    const provider: SemanticProvider = {
      getMemberType: (componentId, memberName, options) =>
        this.resolveMemberType(componentId, memberName, options),
      isAssignable: (source, target, options) =>
        this.engine.isAssignable(source, target, options),
    };
    this.semantics = new RegistrySemantics(provider);
  }

  async collect(options?: DiscoveryOperationOptions): Promise<RegistryView> {
    this.ensureActive();
    return this.apply(await this.engine.collect(options), options);
  }

  async update(
    overlays: readonly SourceOverlay[],
    options?: DiscoveryOperationOptions
  ): Promise<RegistryView> {
    this.ensureActive();
    return this.apply(await this.engine.update(overlays, options), options);
  }

  async removeOverlays(
    fileNames: readonly string[],
    options?: DiscoveryOperationOptions
  ): Promise<RegistryView> {
    this.ensureActive();
    return this.apply(
      await this.engine.removeOverlays(fileNames, options),
      options
    );
  }

  async collectScope(
    files: readonly string[],
    options?: DiscoveryOperationOptions
  ): Promise<RegistryView> {
    this.ensureActive();
    return this.apply(
      await this.lazyEngine().collectScope(files, options),
      options
    );
  }

  async enrich(
    componentIds: readonly string[],
    options?: DiscoveryOperationOptions
  ): Promise<RegistryView> {
    this.ensureActive();
    return this.apply(
      await this.lazyEngine().enrich(componentIds, options),
      options
    );
  }

  async materializeTypes(
    options?: DiscoveryOperationOptions
  ): Promise<RegistryView> {
    this.ensureActive();
    return this.apply(
      await this.lazyEngine().materializeTypes(options),
      options
    );
  }

  async memberType(
    componentId: string,
    memberName: string,
    options?: DiscoveryOperationOptions
  ): Promise<MemberTypeQuery | undefined> {
    this.ensureActive();
    options?.signal?.throwIfAborted();
    return this.semantics.memberType(componentId, memberName, options);
  }

  async isAssignable(
    source: SemanticReference,
    target: SemanticReference,
    options?: DiscoveryOperationOptions
  ): Promise<boolean> {
    this.ensureActive();
    return this.semantics.isAssignable(source, target, options);
  }

  async isAssignableToMember(
    source: SemanticReference,
    record: WebComponentRecord,
    memberName: string,
    options?: DiscoveryOperationOptions
  ): Promise<boolean> {
    this.ensureActive();
    return this.semantics.isAssignableToMember(
      source,
      record,
      memberName,
      options
    );
  }

  async getTimingInfo(): Promise<DiscoveryTimingInfo> {
    this.ensureActive();
    return this.engine.getTimingInfo();
  }

  async resetTimingInfo(): Promise<void> {
    this.ensureActive();
    return this.engine.resetTimingInfo();
  }

  current(): RegistryView | undefined {
    return this.view;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.engine.dispose();
  }

  private apply(
    result: DiscoveryResult,
    options?: DiscoveryOperationOptions
  ): RegistryView {
    options?.signal?.throwIfAborted();
    this.view = createRegistryView(result);
    return this.view;
  }

  private lazyEngine(): LazyDiscoverySession {
    if (!this.lazy) {
      throw new Error('This registry session is not lazy');
    }
    return this.engine as LazyDiscoverySession;
  }

  private resolveMemberType(
    componentId: string,
    memberName: string,
    options?: DiscoveryOperationOptions
  ): Promise<MemberTypeQuery | undefined> {
    if (this.lazy) {
      return this.lazyEngine().getMemberType(componentId, memberName, options);
    }
    const record = this.view?.byDeclarationId(componentId);
    const semantics = record?.members.find(
      (member) => member.memberName === memberName
    );
    const field = record ? findProperty(record, memberName) : undefined;
    if (!semantics?.type || !field?.type) {
      return Promise.resolve(undefined);
    }
    return Promise.resolve({text: field.type.text, reference: semantics.type});
  }

  private ensureActive(): void {
    if (this.disposed) {
      throw new Error('Registry session is disposed');
    }
  }
}
