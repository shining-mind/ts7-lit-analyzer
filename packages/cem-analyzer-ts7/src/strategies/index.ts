import {
  isClassDeclaration,
  isClassExpression,
  type ClassDeclaration,
  type Node,
} from 'typescript/ast';

import {
  addUnique,
  declarationEvidence,
  type ClassLikeDeclaration,
  type ComponentFrameworkFragment,
  type FrameworkStrategy,
  type FrameworkStrategyContext,
} from './abstract.js';
import {litFrameworkStrategy} from './lit.js';
import {vanillaFrameworkStrategy} from './vanilla.js';

export {litFrameworkStrategy} from './lit.js';
export {vanillaFrameworkStrategy} from './vanilla.js';
export type {
  ComponentFrameworkFragment,
  FrameworkEvidence,
  FrameworkEvidenceKind,
  FrameworkName,
  FrameworkStrategy,
  FrameworkStrategyContext,
} from './abstract.js';

export const builtInFrameworkStrategies: readonly FrameworkStrategy[] = [
  vanillaFrameworkStrategy,
  litFrameworkStrategy,
];

export async function collectFrameworkMetadata(
  context: FrameworkStrategyContext,
  strategies: readonly FrameworkStrategy[] = builtInFrameworkStrategies
): Promise<ComponentFrameworkFragment[]> {
  const fragments = new Map<string, ComponentFrameworkFragment>();
  for (const strategy of strategies) {
    for (const fragment of await strategy.collect(context)) {
      const existing = fragments.get(fragment.declaration.id);
      if (existing) {
        mergeFragment(existing, fragment);
      } else {
        fragments.set(fragment.declaration.id, fragment);
      }
    }
  }
  const canonicalFragments = new Map<string, ComponentFrameworkFragment>();
  for (const fragment of fragments.values()) {
    const declaration = await canonicalClassDeclaration(context, fragment);
    if (declaration) {
      fragment.declaration = declarationEvidence(declaration);
    }
    const existing = canonicalFragments.get(fragment.declaration.id);
    if (existing) {
      mergeFragment(existing, fragment);
    } else {
      canonicalFragments.set(fragment.declaration.id, fragment);
    }
  }
  return [...canonicalFragments.values()];
}

async function canonicalClassDeclaration(
  context: FrameworkStrategyContext,
  fragment: ComponentFrameworkFragment
): Promise<ClassLikeDeclaration | undefined> {
  const sourceFile = context.sourceFiles.find(
    (candidate) => candidate.fileName === fragment.declaration.fileName
  );
  if (!sourceFile) {
    return undefined;
  }
  let declaration: ClassLikeDeclaration | undefined;
  function visit(node: Node): void {
    if (
      (isClassDeclaration(node) || isClassExpression(node)) &&
      node.getStart(sourceFile) === fragment.declaration.range.start &&
      node.end === fragment.declaration.range.end
    ) {
      declaration = node;
      return;
    }
    if (!declaration) {
      node.forEachChild(visit);
    }
  }
  visit(sourceFile);
  if (!declaration) {
    return undefined;
  }
  const symbol = await context.checker.getSymbolOfDeclaration(declaration);
  for (const handle of symbol.declarations) {
    const candidate = await handle.resolve();
    if (
      candidate &&
      candidate.getSourceFile().isDeclarationFile &&
      isClassDeclaration(candidate)
    ) {
      return candidate;
    }
  }

  const declarationFileName = fragment.declaration.fileName.replace(
    /\.(js|mjs|cjs)$/,
    (_extension, kind: string) =>
      ({js: '.d.ts', mjs: '.d.mts', cjs: '.d.cts'})[kind]!
  );
  const declarationSource = context.sourceFiles.find(
    (candidate) => candidate.fileName === declarationFileName
  );
  const className = fragment.declaration.id.split('#').at(-1);
  return declarationSource?.statements.find(
    (statement): statement is ClassDeclaration =>
      isClassDeclaration(statement) && statement.name?.text === className
  );
}

function mergeFragment(
  target: ComponentFrameworkFragment,
  source: ComponentFrameworkFragment
): void {
  for (const framework of source.frameworks) {
    addUnique(target.frameworks, framework);
  }
  for (const registration of source.registrations) {
    addUnique(target.registrations, registration);
  }
  for (const attribute of source.attributes) {
    addUnique(target.attributes, attribute);
  }
  for (const member of source.members) {
    addUnique(target.members, member);
  }
  for (const event of source.events) {
    addUnique(target.events, event);
  }
  for (const evidence of source.evidence) {
    addUnique(target.evidence, evidence);
  }
  for (const issue of source.issues) {
    addUnique(target.issues, issue);
  }
}
