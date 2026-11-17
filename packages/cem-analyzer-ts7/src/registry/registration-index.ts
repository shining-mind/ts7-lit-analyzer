import type {Program} from 'typescript/async';
import {isClassDeclaration, isClassExpression} from 'typescript/ast';

import type {DeclarationEvidence, RegistrationEvidence} from '../contracts.js';
import {collectClassDocumentation} from '../discovery/jsdoc.js';
import {findEvidenceNode} from '../discovery/metadata.js';
import {
  collectFrameworkMetadata,
  type FrameworkEvidence,
  type FrameworkName,
  type FrameworkStrategyContext,
} from '../strategies/index.js';

export interface RegistrationIndexEntry {
  declaration: DeclarationEvidence;
  frameworks: FrameworkName[];
  registrations: RegistrationEvidence[];
  evidence: FrameworkEvidence[];
  tagName?: string;
  summary?: string;
  description?: string;
}

/**
 * Project-wide syntactic registration facts without member types. Enrichment
 * and the full metadata merge remain the correctness authority for semantics.
 */
export class RegistrationIndex {
  private readonly entries = new Map<string, RegistrationIndexEntry>();

  get size(): number {
    return this.entries.size;
  }

  get(id: string): RegistrationIndexEntry | undefined {
    return this.entries.get(id);
  }

  values(): IterableIterator<RegistrationIndexEntry> {
    return this.entries.values();
  }

  ids(): ReadonlySet<string> {
    return new Set(this.entries.keys());
  }

  async refresh(context: FrameworkStrategyContext): Promise<void> {
    const fragments = await collectFrameworkMetadata(
      context,
      undefined,
      'index'
    );
    this.entries.clear();
    for (const fragment of fragments) {
      const documentation = await classDocumentation(
        context.program,
        fragment.declaration
      );
      if (
        !documentation?.ignored &&
        (fragment.registrations.length > 0 || documentation?.tagName)
      ) {
        const tagName =
          documentation?.tagName ?? fragment.registrations[0]?.tagName;
        this.entries.set(fragment.declaration.id, {
          declaration: fragment.declaration,
          frameworks: [...fragment.frameworks],
          registrations: [...fragment.registrations],
          evidence: [...fragment.evidence],
          ...(tagName ? {tagName} : {}),
          ...(documentation?.summary ? {summary: documentation.summary} : {}),
          ...(documentation?.description
            ? {description: documentation.description}
            : {}),
        });
      }
    }
  }
}

async function classDocumentation(
  program: Program,
  evidence: DeclarationEvidence
): Promise<ReturnType<typeof collectClassDocumentation> | undefined> {
  const node = await findEvidenceNode(program, evidence);
  if (!node || (!isClassDeclaration(node) && !isClassExpression(node))) {
    return undefined;
  }
  return collectClassDocumentation(node);
}
