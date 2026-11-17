import {
  createDiscoverySession,
  type DiscoveryOptions,
  type DiscoveryResult,
  type DiscoverySession,
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
  collect(): Promise<RegistryView>;
  update(overlays: readonly SourceOverlay[]): Promise<RegistryView>;
  memberType(
    componentId: string,
    memberName: string
  ): Promise<MemberTypeQuery | undefined>;
  isAssignable(
    source: SemanticReference,
    target: SemanticReference
  ): Promise<boolean>;
  isAssignableToMember(
    source: SemanticReference,
    record: WebComponentRecord,
    memberName: string
  ): Promise<boolean>;
  current(): RegistryView | undefined;
  dispose(): Promise<void>;
}

export interface LazyRegistrySession extends RegistrySession {
  collectScope(files: readonly string[]): Promise<RegistryView>;
  enrich(componentIds: readonly string[]): Promise<RegistryView>;
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
      getMemberType: (componentId, memberName) =>
        this.resolveMemberType(componentId, memberName),
      isAssignable: (source, target) =>
        this.engine.isAssignable(source, target),
    };
    this.semantics = new RegistrySemantics(provider);
  }

  async collect(): Promise<RegistryView> {
    this.ensureActive();
    return this.apply(await this.engine.collect());
  }

  async update(overlays: readonly SourceOverlay[]): Promise<RegistryView> {
    this.ensureActive();
    return this.apply(await this.engine.update(overlays));
  }

  async collectScope(files: readonly string[]): Promise<RegistryView> {
    this.ensureActive();
    return this.apply(await this.lazyEngine().collectScope(files));
  }

  async enrich(componentIds: readonly string[]): Promise<RegistryView> {
    this.ensureActive();
    return this.apply(await this.lazyEngine().enrich(componentIds));
  }

  async memberType(
    componentId: string,
    memberName: string
  ): Promise<MemberTypeQuery | undefined> {
    this.ensureActive();
    return this.semantics.memberType(componentId, memberName);
  }

  async isAssignable(
    source: SemanticReference,
    target: SemanticReference
  ): Promise<boolean> {
    this.ensureActive();
    return this.semantics.isAssignable(source, target);
  }

  async isAssignableToMember(
    source: SemanticReference,
    record: WebComponentRecord,
    memberName: string
  ): Promise<boolean> {
    this.ensureActive();
    return this.semantics.isAssignableToMember(source, record, memberName);
  }

  current(): RegistryView | undefined {
    return this.view;
  }

  async dispose(): Promise<void> {
    this.disposed = true;
    await this.engine.dispose();
  }

  private apply(result: DiscoveryResult): RegistryView {
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
    memberName: string
  ): Promise<MemberTypeQuery | undefined> {
    if (this.lazy) {
      return this.lazyEngine().getMemberType(componentId, memberName);
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
