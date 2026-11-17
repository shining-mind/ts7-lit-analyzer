import type {DeclarationEvidence, SemanticReference} from '../contracts.js';
import type {SemanticCollector} from '../semantics/collector.js';

interface LazyQuery {
  reference: SemanticReference;
  classEvidence: DeclarationEvidence;
  memberName: string;
}

/**
 * Tracks issued lazy type queries so references of structurally reused
 * records keep resolving through successor snapshots. References of
 * invalidated records are dropped and rejected: a stale reference must not
 * silently acquire the member's new type.
 */
export class LazyQueryTracker {
  private readonly queries = new Map<string, LazyQuery>();

  track(
    reference: SemanticReference,
    classEvidence: DeclarationEvidence,
    memberName: string
  ): void {
    this.queries.set(
      `${reference.projectId}:${reference.snapshotId}:${reference.id}`,
      {reference, classEvidence, memberName}
    );
  }

  registerSuccessors(
    semantics: SemanticCollector,
    reusedComponentIds: ReadonlySet<string>
  ): void {
    for (const [key, query] of this.queries) {
      if (!reusedComponentIds.has(query.classEvidence.id)) {
        this.queries.delete(key);
        continue;
      }
      const {reference, classEvidence, memberName} = query;
      semantics.registerSuccessorQuery(reference, async () => {
        const resolved = await semantics.getMemberTypeQuery(
          classEvidence,
          memberName
        );
        if (!resolved) {
          throw new Error(
            `Cannot resolve successor type for ${classEvidence.id}.${memberName}`
          );
        }
        return resolved.reference;
      });
    }
  }
}
