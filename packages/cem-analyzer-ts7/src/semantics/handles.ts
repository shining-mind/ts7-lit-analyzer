import type {Signature, Type} from 'typescript/async';

import type {ProjectIdentity, SemanticReference} from '../contracts.js';

type HandleKind = 'type' | 'signature';

type SemanticHandle =
  {kind: 'type'; value: Type} | {kind: 'signature'; value: Signature};

interface SuccessorHandle {
  kind: HandleKind;
  resolve(): Promise<SemanticHandle>;
  handle?: Promise<SemanticHandle>;
}

/**
 * Owns snapshot-scoped semantic handles and their references, including
 * lazy successor resolution. References never escape their project and
 * snapshot; stale references resolve only through registered successors.
 */
export class SemanticHandleStore {
  private readonly project: ProjectIdentity;
  private readonly snapshotId: string;
  private readonly handles = new Map<string, SemanticHandle>();
  private readonly references = new Map<Type | Signature, SemanticReference>();
  private readonly successorHandles = new Map<string, SuccessorHandle>();
  private nextHandleId = 1;

  constructor(project: ProjectIdentity, snapshotId: string) {
    this.project = project;
    this.snapshotId = snapshotId;
  }

  storeHandle(kind: 'type', value: Type): SemanticReference;
  storeHandle(kind: 'signature', value: Signature): SemanticReference;
  storeHandle(kind: HandleKind, value: Type | Signature): SemanticReference {
    const existing = this.references.get(value);
    if (existing) {
      return existing;
    }
    const reference: SemanticReference = {
      id: `semantic-${this.nextHandleId++}`,
      projectId: this.project.id,
      snapshotId: this.snapshotId,
    };
    this.references.set(value, reference);
    this.handles.set(
      reference.id,
      kind === 'type'
        ? {kind, value: value as Type}
        : {kind, value: value as Signature}
    );
    return reference;
  }

  registerSuccessor(
    reference: SemanticReference,
    kind: HandleKind,
    resolve: () => Promise<SemanticReference>
  ): void {
    this.successorHandles.set(this.successorKey(reference), {
      kind,
      resolve: async () => {
        const value = this.resolveHandle(await resolve(), kind);
        return kind === 'type'
          ? {kind, value: value as Type}
          : {kind, value: value as Signature};
      },
    });
  }

  resolveOperationHandle(
    reference: SemanticReference,
    kind: 'type'
  ): Promise<Type>;
  resolveOperationHandle(
    reference: SemanticReference,
    kind: 'signature'
  ): Promise<Signature>;
  async resolveOperationHandle(
    reference: SemanticReference,
    kind: HandleKind
  ): Promise<Type | Signature> {
    if (reference.projectId !== this.project.id) {
      throw new Error(
        'Semantic reference belongs to a different project or snapshot'
      );
    }
    if (reference.snapshotId === this.snapshotId) {
      return this.resolveHandle(reference, kind);
    }
    const successor = this.successorHandles.get(this.successorKey(reference));
    if (!successor || successor.kind !== kind) {
      throw new Error(
        'Semantic reference belongs to a different project or snapshot'
      );
    }
    successor.handle ??= successor.resolve();
    const handle = await successor.handle;
    return handle.value;
  }

  private successorKey(reference: SemanticReference): string {
    return `${reference.projectId}:${reference.snapshotId}:${reference.id}`;
  }

  private resolveHandle(
    reference: SemanticReference,
    kind: HandleKind
  ): Type | Signature {
    if (
      reference.projectId !== this.project.id ||
      reference.snapshotId !== this.snapshotId
    ) {
      throw new Error(
        'Semantic reference belongs to a different project or snapshot'
      );
    }
    const handle = this.handles.get(reference.id);
    if (!handle || handle.kind !== kind) {
      throw new Error(`Semantic reference does not identify a ${kind}`);
    }
    return handle.value;
  }
}
