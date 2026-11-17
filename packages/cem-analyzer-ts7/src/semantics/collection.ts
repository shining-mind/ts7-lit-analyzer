import type {Parameter, Reference} from 'custom-elements-manifest';
import {
  ModifierFlags,
  SymbolFlags,
  TypeFlags,
  type Checker,
  type Signature,
  type Symbol,
  type Type,
} from 'typescript/async';
import {
  getJSDocTags,
  SyntaxKind,
  type Declaration,
  type ModifiersBase,
  type Node,
  type ParameterDeclaration,
} from 'typescript/ast';

import type {AnalysisIssue, DeclarationEvidence} from '../contracts.js';

/**
 * Shared member-collection helpers. Declaration selection prefers declaration
 * files so dual packages keep declaration authority; type issues distinguish
 * implicit any from explicit any and checker error types.
 */
export async function selectDeclaration(
  symbol: Symbol
): Promise<Declaration | undefined> {
  let fallback: Declaration | undefined;
  const handles = symbol.valueDeclaration
    ? [symbol.valueDeclaration, ...symbol.declarations]
    : symbol.declarations;
  for (const handle of handles) {
    const declaration = await handle.resolve();
    if (!declaration) {
      continue;
    }
    fallback ??= declaration;
    if (declaration.getSourceFile().isDeclarationFile) {
      return declaration;
    }
  }
  return fallback;
}

export function createDeclarationEvidence(
  declaration: Node,
  qualifiedName: string,
  exportName?: string
): DeclarationEvidence {
  const fileName = declaration.getSourceFile().fileName;
  return {
    id: `${fileName}#${qualifiedName}`,
    fileName,
    range: {start: declaration.getStart(), end: declaration.end},
    ...(exportName ? {exportName} : {}),
  };
}

export function getInheritedFrom(
  declaration: Declaration,
  className: string
): Reference | undefined {
  let current = declaration.parent;
  while (current && current.kind !== SyntaxKind.SourceFile) {
    if (current.kind === SyntaxKind.ClassDeclaration) {
      const name = (current as Declaration & {name?: {text: string}}).name
        ?.text;
      return name && name !== className ? {name} : undefined;
    }
    current = current.parent;
  }
  return undefined;
}

export function isMethod(symbol: Symbol, declaration: Declaration): boolean {
  return Boolean(
    symbol.flags & SymbolFlags.Method ||
    declaration.kind === SyntaxKind.MethodDeclaration ||
    declaration.kind === SyntaxKind.MethodSignature
  );
}

export function isPrivateOrProtected(declaration: Declaration): boolean {
  const modifierFlags =
    (declaration as Declaration & Partial<ModifiersBase>).modifierFlags ?? 0;
  return Boolean(
    modifierFlags & (ModifierFlags.Private | ModifierFlags.Protected)
  );
}

export function getTypeIssues(
  memberName: string,
  type: Type,
  evidence: DeclarationEvidence,
  declaration: Node
): AnalysisIssue[] {
  if (type.isErrorType()) {
    return [
      {
        code: 'semantic-error-type',
        message: `The checker could not resolve the type of ${memberName}.`,
        fileName: evidence.fileName,
        range: evidence.range,
      },
    ];
  }
  if (type.flags & TypeFlags.Any && !hasExplicitTypeAnnotation(declaration)) {
    return [
      {
        code: 'implicit-any-type',
        message: `The type of ${memberName} is implicitly any.`,
        fileName: evidence.fileName,
        range: evidence.range,
      },
    ];
  }
  return [];
}

export async function collectParameters(
  checker: Checker,
  signature: Signature,
  location: Node,
  issues: AnalysisIssue[],
  materializeTypes: boolean
): Promise<Parameter[]> {
  const parameters: Parameter[] = [];
  const symbols = await signature.getParameters();
  for (let index = 0; index < symbols.length; index++) {
    const symbol = symbols[index];
    const declaration = (await symbol.valueDeclaration?.resolve()) ?? location;
    const type = await checker.getTypeOfSymbolAtLocation(symbol, declaration);
    const parameterDeclaration = declaration as ParameterDeclaration;
    const parameter: Parameter = {
      name: symbol.name,
      optional: Boolean(
        parameterDeclaration.questionToken || parameterDeclaration.initializer
      ),
      rest: signature.hasRestParameter && index === symbols.length - 1,
    };
    if (materializeTypes) {
      parameter.type = {
        text: await checker.typeToString(type, declaration),
      };
    }
    parameters.push(parameter);
    issues.push(
      ...getTypeIssues(
        symbol.name,
        type,
        createDeclarationEvidence(declaration, symbol.name),
        declaration
      )
    );
  }
  return parameters;
}

function hasExplicitTypeAnnotation(declaration: Node): boolean {
  if ((declaration as Node & {type?: Node}).type) return true;
  return getJSDocTags(declaration).some((tag) => {
    if (
      !['type', 'returns', 'return'].includes(tag.tagName.text.toLowerCase())
    ) {
      return false;
    }
    const value = declaration
      .getSourceFile()
      .text.slice(tag.tagName.end, tag.end)
      .trim();
    return /^\{\s*(?:any|\*)\s*\}/.test(value);
  });
}
