import type {Checker, Program} from 'typescript/async';
import {
  isClassDeclaration,
  isClassExpression,
  type ClassDeclaration,
} from 'typescript/ast';

import {
  getInstanceType,
  type ClassLikeDeclaration,
} from '../strategies/abstract.js';
import {selectDeclaration} from '../semantics/collection.js';
import {
  collectClassDocumentation,
  type ClassDocumentationFragment,
} from './jsdoc.js';
import {SingleFlightCache} from './single-flight-cache.js';

export interface BaseDocumentationContext {
  program: Program;
  checker: Checker;
  snapshotId: string;
}

interface BaseDocumentationEntry {
  fragment: ClassDocumentationFragment;
  baseLinkKey?: string;
}

/**
 * Intra-session cache of base-class documentation. Each entry is isolated: a
 * class's own JSDoc fragment plus a base-link held as declaration identity, not
 * the base's merged data. Walks follow cached links and re-merge each time, so a
 * base edit invalidates only that base's entry while subclasses keep their links
 * and read fresh base data. Concurrent misses coalesce through single-flight
 * in-flight promises. A per-key epoch discards resolutions completing after
 * invalidation; a snapshot generation discards resolutions captured against a
 * superseded snapshot. Misses always re-resolve from the live component
 * declaration on the current snapshot, so no stale declaration can be reused.
 */
export class BaseDocumentationCache {
  private readonly entries = new SingleFlightCache<BaseDocumentationEntry>();
  private snapshotId: string | undefined;

  /**
   * On a snapshot change, advances the generation and drops in-flight promises
   * so completing old-snapshot results are discarded and the next collection
   * resolves against the current snapshot.
   */
  alignSnapshot(snapshotId: string): void {
    if (this.snapshotId !== snapshotId) {
      this.snapshotId = snapshotId;
      this.entries.bumpGeneration();
      this.entries.staleInFlight();
    }
  }

  /** Evicts entries whose own file changed, bumping their epoch so in-flight resolutions stale. */
  invalidate(changedFiles: Iterable<string>): void {
    const changed = new Set(changedFiles);
    if (changed.size === 0) return;
    for (const key of this.entries.keys()) {
      if (changed.has(fileNameOf(key))) {
        this.entries.invalidate(key);
      }
    }
  }

  async collectBaseDocumentation(
    classDeclaration: ClassDeclaration,
    startKey: string,
    context: BaseDocumentationContext
  ): Promise<ClassDocumentationFragment[]> {
    this.alignSnapshot(context.snapshotId);
    const generation = this.entries.currentGeneration;

    const fragments: ClassDocumentationFragment[] = [];
    const visited = new Set<string>();
    let entry = await this.ensureEntry(
      startKey,
      context,
      async () => classDeclaration,
      generation
    );
    let linkKey = entry.baseLinkKey;
    while (linkKey && !visited.has(linkKey)) {
      visited.add(linkKey);
      const target = linkKey;
      entry = await this.ensureEntry(
        target,
        context,
        () => this.reResolve(target, classDeclaration, startKey, context),
        generation
      );
      fragments.push(entry.fragment);
      linkKey = entry.baseLinkKey;
    }
    return fragments;
  }

  private ensureEntry(
    key: string,
    context: BaseDocumentationContext,
    resolveDeclaration: () => Promise<ClassLikeDeclaration>,
    generation: number
  ): Promise<BaseDocumentationEntry> {
    return this.entries.resolve(
      key,
      async () => {
        const declaration = await resolveDeclaration();
        const fragment = collectClassDocumentation(declaration);
        const base = await resolveBaseClass(declaration, context.checker);
        let baseLinkKey: string | undefined;
        if (
          base &&
          !(await context.program.isSourceFileDefaultLibrary(
            base.declaration.getSourceFile()
          ))
        ) {
          baseLinkKey = declarationKey(base.declaration, base.name);
        }
        return {fragment, ...(baseLinkKey ? {baseLinkKey} : {})};
      },
      generation
    );
  }

  /** Re-resolves a base declaration from the live component declaration down the chain. */
  private async reResolve(
    targetKey: string,
    startDeclaration: ClassDeclaration,
    startKey: string,
    context: BaseDocumentationContext
  ): Promise<ClassLikeDeclaration> {
    let declaration: ClassLikeDeclaration = startDeclaration;
    let key = startKey;
    const guard = new Set<string>([startKey]);
    while (key !== targetKey) {
      const base = await resolveBaseClass(declaration, context.checker);
      if (!base) {
        throw new Error(`Cannot re-resolve base class for ${targetKey}.`);
      }
      declaration = base.declaration;
      key = declarationKey(declaration, base.name);
      if (guard.has(key)) {
        throw new Error(`Cyclic base chain while resolving ${targetKey}.`);
      }
      guard.add(key);
    }
    return declaration;
  }
}

function declarationKey(
  declaration: ClassLikeDeclaration,
  name: string
): string {
  return `${declaration.getSourceFile().fileName}#${name}`;
}

function fileNameOf(key: string): string {
  return key.slice(0, key.lastIndexOf('#'));
}

async function resolveBaseClass(
  declaration: ClassLikeDeclaration,
  checker: Checker
): Promise<{declaration: ClassLikeDeclaration; name: string} | undefined> {
  const instanceType = await getInstanceType(checker, declaration);
  const [baseType] = (await instanceType?.getBaseTypes()) ?? [];
  const baseSymbol = baseType ? await baseType.getSymbol() : undefined;
  if (!baseSymbol) return undefined;
  const baseDeclaration = await selectDeclaration(baseSymbol);
  if (
    !baseDeclaration ||
    (!isClassDeclaration(baseDeclaration) &&
      !isClassExpression(baseDeclaration))
  ) {
    return undefined;
  }
  return {declaration: baseDeclaration, name: baseSymbol.name};
}
