import type {
  MemberTypeQuery,
  SemanticReference,
  WebComponentRecord,
} from '@ts7-lit-analyzer/cem-analyzer-ts7';

/**
 * The narrow semantic surface the registry delegates to. The engine session
 * implements it; the registry never dereferences handles or re-implements
 * checker operations.
 */
export interface SemanticProvider {
  getMemberType(
    componentId: string,
    memberName: string
  ): Promise<MemberTypeQuery | undefined>;
  isAssignable(
    source: SemanticReference,
    target: SemanticReference
  ): Promise<boolean>;
}

/**
 * Delegates type queries and assignability to the provider using opaque
 * snapshot-scoped references. Display text is never an assignability input.
 */
export class RegistrySemantics {
  private readonly provider: SemanticProvider;

  constructor(provider: SemanticProvider) {
    this.provider = provider;
  }

  memberType(
    componentId: string,
    memberName: string
  ): Promise<MemberTypeQuery | undefined> {
    return this.provider.getMemberType(componentId, memberName);
  }

  isAssignable(
    source: SemanticReference,
    target: SemanticReference
  ): Promise<boolean> {
    return this.provider.isAssignable(source, target);
  }

  /**
   * Checks a source type against a member's collected semantic reference. A
   * member without a collected reference is incomplete, never a successful
   * check, and the member's display text is not consulted.
   */
  async isAssignableToMember(
    source: SemanticReference,
    record: WebComponentRecord,
    memberName: string
  ): Promise<boolean> {
    const target = record.members.find(
      (member) => member.memberName === memberName
    )?.type;
    if (!target) {
      throw new Error(
        `Member ${memberName} has no collected semantic type to check against`
      );
    }
    return this.provider.isAssignable(source, target);
  }
}
