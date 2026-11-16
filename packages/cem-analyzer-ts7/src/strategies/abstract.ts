import type {
  Attribute,
  CustomElementField,
  Event,
} from 'custom-elements-manifest';
import {SymbolFlags, TypeFlags} from 'typescript/async';
import type {
  Checker,
  IntersectionType,
  Program,
  Symbol,
  Type,
} from 'typescript/async';
import {
  isCallExpression,
  isClassDeclaration,
  isClassExpression,
  isIdentifier,
  SyntaxKind,
  type CallExpression,
  type ClassDeclaration,
  type ClassExpression,
  type Expression,
  type GetAccessorDeclaration,
  type Node,
  type PropertyDeclaration,
  type SourceFile,
} from 'typescript/ast';

import type {
  AnalysisIssue,
  DeclarationEvidence,
  RegistrationEvidence,
  SourceRange,
} from '../contracts.js';

export type ClassLikeDeclaration = ClassDeclaration | ClassExpression;

export type FrameworkName = 'vanilla' | 'lit';

export type FrameworkEvidenceKind =
  | 'framework'
  | 'registration'
  | 'tag-name-map'
  | 'observed-attribute'
  | 'event'
  | 'custom-element-decorator'
  | 'reactive-decorator'
  | 'compiled-decorator'
  | 'static-reactive-properties';

export interface FrameworkEvidence {
  kind: FrameworkEvidenceKind;
  strategy: FrameworkName;
  fileName: string;
  range: SourceRange;
  memberName?: string;
  attributeName?: string;
}

export interface ComponentFrameworkFragment {
  declaration: DeclarationEvidence;
  frameworks: FrameworkName[];
  registrations: RegistrationEvidence[];
  attributes: Attribute[];
  members: CustomElementField[];
  events: Event[];
  evidence: FrameworkEvidence[];
  issues: AnalysisIssue[];
}

export interface FrameworkStrategyContext {
  program: Program;
  checker: Checker;
  sourceFiles: readonly SourceFile[];
}

export interface FrameworkStrategy {
  readonly name: FrameworkName;
  collect(
    context: FrameworkStrategyContext
  ): Promise<readonly ComponentFrameworkFragment[]>;
}

export interface MutableFragment extends ComponentFrameworkFragment {}

export async function resolveClassExpression(
  checker: Checker,
  expression: Expression
): Promise<ClassDeclaration | undefined> {
  if (!isIdentifier(expression)) {
    return undefined;
  }
  const symbol = await checker.getSymbolAtLocation(expression);
  if (!symbol) {
    return undefined;
  }
  const aliased =
    (symbol.flags & SymbolFlags.Alias) !== 0
      ? await checker.getAliasedSymbol(symbol)
      : symbol;
  return classFromSymbol(aliased);
}

export async function classFromSymbol(
  symbol: Symbol
): Promise<ClassDeclaration | undefined> {
  for (const handle of symbol.declarations) {
    const declaration = await handle.resolve();
    if (declaration && isClassDeclaration(declaration)) {
      return declaration;
    }
  }
  return undefined;
}

export async function getInstanceType(
  checker: Checker,
  declaration: ClassLikeDeclaration
): Promise<Type | undefined> {
  const symbol = await checker.getSymbolOfDeclaration(declaration);
  const classType = await checker.getTypeOfSymbol(symbol);
  const signature = (await classType.getConstructSignatures())[0];
  return signature ? checker.getReturnTypeOfSignature(signature) : undefined;
}

export async function inheritsFrom(
  checker: Checker,
  type: Type,
  predicate: (symbol: Symbol) => boolean
): Promise<boolean> {
  const visited = new Set<number>();
  async function visit(current: Type): Promise<boolean> {
    if (visited.has(current.id)) {
      return false;
    }
    visited.add(current.id);
    for (const base of await getCheckerBaseTypes(checker, current)) {
      const symbol = await base.getSymbol();
      if (symbol && predicate(symbol)) {
        return true;
      }
      if (await visit(base)) {
        return true;
      }
    }
    return false;
  }
  return visit(type);
}

async function getCheckerBaseTypes(
  checker: Checker,
  type: Type
): Promise<readonly Type[]> {
  if (type.flags & TypeFlags.Intersection) {
    return (type as IntersectionType).getTypes();
  }
  const direct = await type.getBaseTypes();
  if (direct && direct.length > 0) {
    return direct;
  }
  const symbol = await type.getSymbol();
  if (!symbol) {
    return [];
  }
  const bases: Type[] = [];
  for (const handle of symbol.declarations) {
    const declaration = await handle.resolve();
    if (
      !declaration ||
      (!isClassDeclaration(declaration) && !isClassExpression(declaration))
    ) {
      continue;
    }
    for (const heritage of declaration.heritageClauses ?? []) {
      if (heritage.token !== SyntaxKind.ExtendsKeyword) {
        continue;
      }
      for (const heritageType of heritage.types) {
        let call: CallExpression | undefined;
        function findCall(node: Node): void {
          if (isCallExpression(node)) {
            call = node;
          } else {
            node.forEachChild(findCall);
          }
        }
        findCall(heritageType);
        const heritageValue = await checker.getTypeAtLocation(
          call ?? heritageType
        );
        if (call) {
          const [signature] = await heritageValue.getConstructSignatures();
          if (signature) {
            bases.push(await checker.getReturnTypeOfSignature(signature));
          }
        } else {
          bases.push(heritageValue);
        }
      }
    }
  }
  return bases;
}

export function collectClasses(
  sourceFiles: readonly SourceFile[]
): ClassLikeDeclaration[] {
  const declarations: ClassLikeDeclaration[] = [];
  for (const sourceFile of sourceFiles) {
    function visit(node: Node): void {
      if (isClassDeclaration(node) || isClassExpression(node)) {
        declarations.push(node);
      }
      node.forEachChild(visit);
    }
    visit(sourceFile);
  }
  return declarations;
}

export function getOrCreateFragment(
  fragments: Map<string, MutableFragment>,
  declaration: ClassLikeDeclaration
): MutableFragment {
  const evidence = declarationEvidence(declaration);
  const existing = fragments.get(evidence.id);
  if (existing) {
    return existing;
  }
  const fragment: MutableFragment = {
    declaration: evidence,
    frameworks: [],
    registrations: [],
    attributes: [],
    members: [],
    events: [],
    evidence: [],
    issues: [],
  };
  fragments.set(evidence.id, fragment);
  return fragment;
}

export function declarationEvidence(
  declaration: ClassLikeDeclaration
): DeclarationEvidence {
  const sourceFile = declaration.getSourceFile();
  return {
    id: declarationId(declaration, declaration.name?.text ?? 'default'),
    fileName: sourceFile.fileName,
    range: sourceRange(declaration),
    ...(declaration.name ? {exportName: declaration.name.text} : {}),
  };
}

export function declarationId(node: Node, name: string): string {
  return `${node.getSourceFile().fileName}#${name}`;
}

export function addFramework(
  fragment: MutableFragment,
  framework: FrameworkName,
  declaration: ClassLikeDeclaration
): void {
  addUnique(fragment.frameworks, framework);
  addUnique(fragment.evidence, {
    kind: 'framework',
    strategy: framework,
    fileName: declaration.getSourceFile().fileName,
    range: sourceRange(declaration),
  });
}

export function addUnique<T>(items: T[], value: T): void {
  const serialized = JSON.stringify(value);
  if (!items.some((item) => JSON.stringify(item) === serialized)) {
    items.push(value);
  }
}

export function sourceRange(node: Node): SourceRange {
  const sourceFile = node.getSourceFile();
  return {start: node.getStart(sourceFile), end: node.end};
}

export function isStatic(
  node: PropertyDeclaration | GetAccessorDeclaration
): boolean {
  return (
    node.modifiers?.some(
      (modifier) => modifier.kind === SyntaxKind.StaticKeyword
    ) ?? false
  );
}

export async function visitAsync(
  node: Node,
  visitor: (node: Node) => Promise<void>
): Promise<void> {
  await visitor(node);
  for (const child of node.childrenIter()) {
    await visitAsync(child, visitor);
  }
}
