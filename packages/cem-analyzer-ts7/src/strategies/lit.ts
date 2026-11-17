import type {CustomElementField} from 'custom-elements-manifest';
import {SymbolFlags} from 'typescript/async';
import type {Checker} from 'typescript/async';
import {
  isArrayLiteralExpression,
  isCallExpression,
  isDecorator,
  isGetAccessorDeclaration,
  isIdentifier,
  isImportDeclaration,
  isNamedImports,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertyDeclaration,
  isReturnStatement,
  isSpreadAssignment,
  isStringLiteralLikeNode,
  SyntaxKind,
  type CallExpression,
  type Decorator,
  type GetAccessorDeclaration,
  type ImportDeclaration,
  type Node,
  type PropertyDeclaration,
  type SourceFile,
} from 'typescript/ast';

import {
  addFramework,
  addUnique,
  collectClasses,
  declarationEvidence,
  getInstanceType,
  getOrCreateFragment,
  inheritsFrom,
  isStatic,
  resolveClassExpression,
  sourceRange,
  visitAsync,
  type ClassLikeDeclaration,
  type ComponentFrameworkFragment,
  type FrameworkEvidenceKind,
  type FrameworkStrategy,
  type FrameworkStrategyContext,
  type MutableFragment,
} from './abstract.js';

interface DecoratorIdentity {
  customElement: Set<number>;
  property: Set<number>;
  state: Set<number>;
}

interface ReactiveOptions {
  attribute?: string | false;
  reflect?: boolean;
}

export class LitFrameworkStrategy implements FrameworkStrategy {
  readonly name = 'lit';

  index(
    context: FrameworkStrategyContext
  ): Promise<ComponentFrameworkFragment[]> {
    return this.scan(context, 'index');
  }

  collect(
    context: FrameworkStrategyContext
  ): Promise<ComponentFrameworkFragment[]> {
    return this.scan(context, 'full');
  }

  private async scan(
    context: FrameworkStrategyContext,
    depth: 'index' | 'full'
  ): Promise<ComponentFrameworkFragment[]> {
    const {checker, sourceFiles} = context;
    const litClasses = await collectLitClassIdentities(checker, sourceFiles);
    const decorators = await collectDecoratorIdentities(checker, sourceFiles);
    const fragments = new Map<string, MutableFragment>();

    for (const declaration of collectClasses(sourceFiles)) {
      const instanceType = await getInstanceType(checker, declaration);
      const isLit =
        instanceType !== undefined &&
        (await inheritsFrom(checker, instanceType, (symbol) =>
          litClasses.has(symbol.id)
        ));
      if (
        !isLit &&
        !(await hasReactiveConfiguration(checker, declaration, decorators))
      ) {
        continue;
      }
      const fragment = await getOrCreateFragment(fragments, declaration);
      if (isLit) {
        addFramework(fragment, 'lit', declaration);
      }

      for (const decorator of getDecorators(declaration)) {
        const call = decoratorCall(decorator);
        const kind = call
          ? await decoratorKind(checker, call, decorators)
          : undefined;
        if (kind !== 'customElement') {
          continue;
        }
        const tagName = call?.arguments[0];
        if (!tagName || !isStringLiteralLikeNode(tagName)) {
          continue;
        }
        addLitRegistration(fragment, declaration, tagName.text, decorator);
      }

      if (depth === 'full') {
        for (const member of declaration.members) {
          if (isPropertyDeclaration(member)) {
            await collectPropertyDecorators(
              checker,
              fragment,
              member,
              decorators
            );
          }
          collectStaticProperties(fragment, member);
        }
      }
    }

    for (const sourceFile of sourceFiles) {
      await visitAsync(sourceFile, async (node) => {
        if (!isCompiledDecorateCall(node)) {
          return;
        }
        await collectCompiledDecorator(
          checker,
          fragments,
          node,
          decorators,
          depth
        );
      });
    }

    return [...fragments.values()];
  }
}

export const litFrameworkStrategy: FrameworkStrategy =
  new LitFrameworkStrategy();

async function collectLitClassIdentities(
  checker: Checker,
  sourceFiles: readonly SourceFile[]
): Promise<Set<number>> {
  const identities = new Set<number>();
  for (const sourceFile of sourceFiles) {
    for (const statement of sourceFile.statements) {
      if (
        !isImportDeclaration(statement) ||
        !isStringLiteralLikeNode(statement.moduleSpecifier) ||
        !['lit', 'lit-element'].includes(statement.moduleSpecifier.text)
      ) {
        continue;
      }
      await addImportedIdentity(checker, statement, 'LitElement', identities);
    }
  }
  return identities;
}

async function collectDecoratorIdentities(
  checker: Checker,
  sourceFiles: readonly SourceFile[]
): Promise<DecoratorIdentity> {
  const identity: DecoratorIdentity = {
    customElement: new Set<number>(),
    property: new Set<number>(),
    state: new Set<number>(),
  };
  const supportedModules = new Set([
    'lit/decorators',
    'lit/decorators.js',
    'lit-element',
    'lit-element/decorators',
    'lit-element/decorators.js',
  ]);
  for (const sourceFile of sourceFiles) {
    for (const statement of sourceFile.statements) {
      if (
        !isImportDeclaration(statement) ||
        !isStringLiteralLikeNode(statement.moduleSpecifier) ||
        !supportedModules.has(statement.moduleSpecifier.text)
      ) {
        continue;
      }
      for (const name of ['customElement', 'property', 'state'] as const) {
        await addImportedIdentity(checker, statement, name, identity[name]);
      }
    }
  }
  return identity;
}

async function addImportedIdentity(
  checker: Checker,
  declaration: ImportDeclaration,
  importedName: string,
  target: Set<number>
): Promise<void> {
  const bindings = declaration.importClause?.namedBindings;
  if (!bindings || !isNamedImports(bindings)) {
    return;
  }
  for (const element of bindings.elements) {
    const imported = element.propertyName ?? element.name;
    if (imported.text !== importedName) {
      continue;
    }
    const symbol = await checker.getSymbolAtLocation(element.name);
    if (!symbol) {
      continue;
    }
    const aliased =
      (symbol.flags & SymbolFlags.Alias) !== 0
        ? await checker.getAliasedSymbol(symbol)
        : symbol;
    target.add(aliased.id);
  }
}

async function hasReactiveConfiguration(
  checker: Checker,
  declaration: ClassLikeDeclaration,
  decorators: DecoratorIdentity
): Promise<boolean> {
  for (const member of declaration.members) {
    if (
      (isPropertyDeclaration(member) || isGetAccessorDeclaration(member)) &&
      isStatic(member) &&
      isIdentifier(member.name) &&
      member.name.text === 'properties' &&
      (declaration.heritageClauses?.length ?? 0) > 0
    ) {
      return true;
    }
    if (!isPropertyDeclaration(member)) {
      continue;
    }
    for (const decorator of getDecorators(member)) {
      const call = decoratorCall(decorator);
      const kind = call
        ? await decoratorKind(checker, call, decorators)
        : undefined;
      if (kind === 'property' || kind === 'state') {
        return true;
      }
    }
  }
  return false;
}

async function collectPropertyDecorators(
  checker: Checker,
  fragment: MutableFragment,
  member: PropertyDeclaration,
  decorators: DecoratorIdentity
): Promise<void> {
  if (!isIdentifier(member.name) && !isStringLiteralLikeNode(member.name)) {
    return;
  }
  for (const decorator of getDecorators(member)) {
    const call = decoratorCall(decorator);
    const kind = call
      ? await decoratorKind(checker, call, decorators)
      : undefined;
    if (kind !== 'property' && kind !== 'state') {
      continue;
    }
    const options: ReactiveOptions =
      kind === 'property'
        ? parseReactiveOptions(call?.arguments[0])
        : {attribute: false};
    addReactiveProperty(
      fragment,
      member.name.text,
      options,
      decorator,
      'reactive-decorator'
    );
  }
}

function collectStaticProperties(
  fragment: MutableFragment,
  member: Node
): void {
  if (
    (!isPropertyDeclaration(member) && !isGetAccessorDeclaration(member)) ||
    !isStatic(member) ||
    !isIdentifier(member.name) ||
    member.name.text !== 'properties'
  ) {
    return;
  }
  const configuration = getStaticPropertiesConfiguration(member);
  if (!configuration) {
    addUnsupportedSyntax(fragment, member);
    return;
  }
  for (const property of configuration.properties) {
    if (
      isSpreadAssignment(property) &&
      isPropertyAccessExpression(property.expression) &&
      property.expression.expression.kind === SyntaxKind.SuperKeyword &&
      property.expression.name.text === 'properties'
    ) {
      continue;
    }
    if (
      !isPropertyAssignment(property) ||
      (!isIdentifier(property.name) && !isStringLiteralLikeNode(property.name))
    ) {
      addUnsupportedSyntax(fragment, property);
      continue;
    }
    const options = parseReactiveOptions(property.initializer);
    addReactiveProperty(
      fragment,
      property.name.text,
      options,
      property,
      'static-reactive-properties'
    );
  }
}

function getStaticPropertiesConfiguration(
  member: PropertyDeclaration | GetAccessorDeclaration
) {
  if (isPropertyDeclaration(member)) {
    return member.initializer && isObjectLiteralExpression(member.initializer)
      ? member.initializer
      : undefined;
  }
  for (const statement of member.body?.statements ?? []) {
    if (
      isReturnStatement(statement) &&
      statement.expression &&
      isObjectLiteralExpression(statement.expression)
    ) {
      return statement.expression;
    }
  }
  return undefined;
}

async function collectCompiledDecorator(
  checker: Checker,
  fragments: Map<string, MutableFragment>,
  call: CallExpression,
  decorators: DecoratorIdentity,
  depth: 'index' | 'full'
): Promise<void> {
  const decoratorList = call.arguments[0];
  const target = call.arguments[1];
  if (!decoratorList || !isArrayLiteralExpression(decoratorList) || !target) {
    return;
  }
  for (const entry of decoratorList.elements) {
    if (!isCallExpression(entry)) {
      continue;
    }
    const kind = await decoratorKind(checker, entry, decorators);
    if (kind === 'customElement') {
      const tagName = entry.arguments[0];
      const declaration = await resolveClassExpression(checker, target);
      if (!tagName || !isStringLiteralLikeNode(tagName) || !declaration) {
        continue;
      }
      const fragment = await getOrCreateFragment(fragments, declaration);
      addLitRegistration(fragment, declaration, tagName.text, entry);
      addUnique(fragment.evidence, {
        kind: 'compiled-decorator',
        strategy: 'lit',
        fileName: call.getSourceFile().fileName,
        range: sourceRange(call),
      });
    } else if (depth === 'full' && (kind === 'property' || kind === 'state')) {
      const memberName = call.arguments[2];
      if (!memberName || !isStringLiteralLikeNode(memberName)) {
        continue;
      }
      const classExpression = isPropertyAccessExpression(target)
        ? target.expression
        : undefined;
      const declaration = classExpression
        ? await resolveClassExpression(checker, classExpression)
        : undefined;
      if (!declaration) {
        continue;
      }
      const fragment = await getOrCreateFragment(fragments, declaration);
      const options: ReactiveOptions =
        kind === 'property'
          ? parseReactiveOptions(entry.arguments[0])
          : {attribute: false};
      addReactiveProperty(
        fragment,
        memberName.text,
        options,
        entry,
        'compiled-decorator'
      );
    }
  }
}

function addLitRegistration(
  fragment: MutableFragment,
  declaration: ClassLikeDeclaration,
  tagName: string,
  evidenceNode: Node
): void {
  const fileName = evidenceNode.getSourceFile().fileName;
  const range = sourceRange(evidenceNode);
  addUnique(fragment.registrations, {
    tagName,
    fileName,
    range,
    scope: 'global',
    strategy: 'lit',
  });
  addUnique(fragment.evidence, {
    kind: 'custom-element-decorator',
    strategy: 'lit',
    fileName,
    range,
  });
  if (!fragment.declaration.id) {
    fragment.declaration = declarationEvidence(declaration);
  }
}

function addReactiveProperty(
  fragment: MutableFragment,
  propertyName: string,
  options: ReactiveOptions,
  evidenceNode: Node,
  kind: FrameworkEvidenceKind
): void {
  const attributeName =
    options.attribute === false
      ? undefined
      : (options.attribute ?? propertyName);
  const member: CustomElementField = {kind: 'field', name: propertyName};
  if (attributeName) {
    member.attribute = attributeName;
  }
  if (options.reflect) {
    member.reflects = true;
  }
  addUnique(fragment.members, member);
  if (attributeName) {
    addUnique(fragment.attributes, {
      name: attributeName,
      fieldName: propertyName,
    });
  }
  addUnique(fragment.evidence, {
    kind,
    strategy: 'lit',
    fileName: evidenceNode.getSourceFile().fileName,
    range: sourceRange(evidenceNode),
    memberName: propertyName,
    ...(attributeName ? {attributeName} : {}),
  });
}

function addUnsupportedSyntax(fragment: MutableFragment, node: Node): void {
  addUnique(fragment.issues, {
    code: 'unsupported-syntax',
    message:
      'The reactive property configuration is not a supported literal form.',
    fileName: node.getSourceFile().fileName,
    range: sourceRange(node),
  });
}

function parseReactiveOptions(node: Node | undefined): ReactiveOptions {
  if (!node || !isObjectLiteralExpression(node)) {
    return {};
  }
  const options: ReactiveOptions = {};
  for (const property of node.properties) {
    if (!isPropertyAssignment(property) || !isIdentifier(property.name)) {
      continue;
    }
    if (property.name.text === 'attribute') {
      if (isStringLiteralLikeNode(property.initializer)) {
        options.attribute = property.initializer.text;
      } else if (property.initializer.kind === SyntaxKind.FalseKeyword) {
        options.attribute = false;
      }
    } else if (
      property.name.text === 'reflect' &&
      property.initializer.kind === SyntaxKind.TrueKeyword
    ) {
      options.reflect = true;
    }
  }
  return options;
}

async function decoratorKind(
  checker: Checker,
  call: CallExpression,
  decorators: DecoratorIdentity
): Promise<keyof DecoratorIdentity | undefined> {
  if (!isIdentifier(call.expression)) {
    return undefined;
  }
  const symbol = await checker.getSymbolAtLocation(call.expression);
  if (!symbol) {
    return undefined;
  }
  const aliased =
    (symbol.flags & SymbolFlags.Alias) !== 0
      ? await checker.getAliasedSymbol(symbol)
      : symbol;
  for (const kind of ['customElement', 'property', 'state'] as const) {
    if (decorators[kind].has(aliased.id)) {
      return kind;
    }
  }
  return undefined;
}

function decoratorCall(decorator: Decorator): CallExpression | undefined {
  return isCallExpression(decorator.expression)
    ? decorator.expression
    : undefined;
}

function getDecorators(node: Node): readonly Decorator[] {
  if (!('modifiers' in node)) {
    return [];
  }
  const modifiers = node.modifiers;
  if (!modifiers || !Array.isArray(modifiers)) {
    return [];
  }
  return modifiers.filter(isDecorator);
}

function isCompiledDecorateCall(node: Node): node is CallExpression {
  return (
    isCallExpression(node) &&
    isIdentifier(node.expression) &&
    node.expression.text === '__decorate'
  );
}
