import {SymbolFlags} from 'typescript/async';
import type {Checker, Type} from 'typescript/async';
import {
  isArrayLiteralExpression,
  isCallExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isInterfaceDeclaration,
  isNewExpression,
  isPropertyAccessExpression,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isReturnStatement,
  isSetAccessorDeclaration,
  isStringLiteralLikeNode,
  isVariableDeclaration,
  SyntaxKind,
  type ArrayLiteralExpression,
  type CallExpression,
  type GetAccessorDeclaration,
  type Node,
  type PropertyDeclaration,
  type SourceFile,
  type VariableDeclaration,
} from 'typescript/ast';

import type {RegistrationEvidence} from '../contracts.js';
import {collectClassDocumentation} from '../discovery/jsdoc.js';
import {
  addFramework,
  addUnique,
  classFromSymbol,
  collectClasses,
  declarationId,
  getInstanceType,
  getOrCreateFragment,
  inheritsFrom,
  isStatic,
  resolveClassExpression,
  sourceRange,
  visitAsync,
  type ClassLikeDeclaration,
  type ComponentFrameworkFragment,
  type FrameworkStrategy,
  type FrameworkStrategyContext,
  type MutableFragment,
} from './abstract.js';

interface RegistryBinding {
  symbolId: number;
  declaration: VariableDeclaration;
}

export class VanillaFrameworkStrategy implements FrameworkStrategy {
  readonly name = 'vanilla';

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
    const fragments = new Map<string, MutableFragment>();
    const classes = collectClasses(sourceFiles);
    const htmlElement = await checker.resolveName(
      'HTMLElement',
      SymbolFlags.Interface
    );
    if (!htmlElement) {
      return [];
    }

    for (const declaration of classes) {
      const instanceType = await getInstanceType(checker, declaration);
      if (
        !instanceType ||
        !(await inheritsFrom(
          checker,
          instanceType,
          (symbol) => symbol.id === htmlElement.id
        ))
      ) {
        continue;
      }
      const fragment = await getOrCreateFragment(fragments, declaration);
      addFramework(fragment, 'vanilla', declaration);
      if (depth === 'full') {
        await collectObservedAttributes(fragment, declaration, instanceType);
        const documentation = collectClassDocumentation(declaration);
        for (const event of documentation.events) {
          addUnique(fragment.events, event);
        }
        for (const item of documentation.evidence) {
          if (
            item.kind === 'inline-event' ||
            item.tagName === 'fires' ||
            item.tagName === 'event'
          ) {
            addUnique(fragment.evidence, {
              kind: 'event',
              strategy: 'vanilla',
              fileName: item.fileName,
              range: item.range,
            });
          }
        }
      }
    }

    const registries = await collectRegistryBindings(checker, sourceFiles);
    for (const sourceFile of sourceFiles) {
      await visitAsync(sourceFile, async (node) => {
        if (!isCallExpression(node)) {
          return;
        }
        const registration = await recognizeDefinition(
          checker,
          node,
          registries
        );
        if (!registration) {
          return;
        }
        const fragment = getOrCreateFragment(
          fragments,
          registration.declaration
        );
        addUnique(fragment.registrations, registration.evidence);
        addUnique(fragment.evidence, {
          kind: 'registration',
          strategy: 'vanilla',
          fileName: registration.evidence.fileName,
          range: registration.evidence.range,
        });
      });
    }

    for (const sourceFile of sourceFiles) {
      await visitAsync(sourceFile, async (node) => {
        if (
          !isInterfaceDeclaration(node) ||
          node.name.text !== 'HTMLElementTagNameMap'
        ) {
          return;
        }
        for (const member of node.members) {
          if (
            !isPropertySignatureDeclaration(member) ||
            !isStringLiteralLikeNode(member.name) ||
            !member.type
          ) {
            continue;
          }
          const type = await checker.getTypeAtLocation(member.type);
          const symbol = await type.getSymbol();
          const declaration = symbol
            ? await classFromSymbol(symbol)
            : undefined;
          if (!declaration) {
            continue;
          }
          const fragment = await getOrCreateFragment(fragments, declaration);
          const range = sourceRange(member);
          addUnique(fragment.registrations, {
            tagName: member.name.text,
            fileName: sourceFile.fileName,
            range,
            scope: 'global',
            strategy: 'vanilla',
          });
          addUnique(fragment.evidence, {
            kind: 'tag-name-map',
            strategy: 'vanilla',
            fileName: sourceFile.fileName,
            range,
          });
        }
      });
    }

    return [...fragments.values()].filter((fragment) =>
      fragment.frameworks.includes('vanilla')
    );
  }
}

export const vanillaFrameworkStrategy: FrameworkStrategy =
  new VanillaFrameworkStrategy();

async function collectObservedAttributes(
  fragment: MutableFragment,
  declaration: ClassLikeDeclaration,
  instanceType: Type
): Promise<void> {
  for (const member of declaration.members) {
    if (
      (!isPropertyDeclaration(member) && !isGetAccessorDeclaration(member)) ||
      !isStatic(member) ||
      !isIdentifier(member.name) ||
      member.name.text !== 'observedAttributes'
    ) {
      continue;
    }
    const observedAttributes = getObservedAttributesArray(member);
    if (!observedAttributes) {
      continue;
    }
    for (const element of observedAttributes.elements) {
      if (!isStringLiteralLikeNode(element)) {
        continue;
      }
      const memberName = await findObservedAttributeMember(
        instanceType,
        element.text
      );
      if (!memberName) {
        continue;
      }
      addUnique(fragment.attributes, {
        name: element.text,
        fieldName: memberName,
      });
      addUnique(fragment.evidence, {
        kind: 'observed-attribute',
        strategy: 'vanilla',
        fileName: element.getSourceFile().fileName,
        range: sourceRange(element),
        memberName,
        attributeName: element.text,
      });
    }
  }
}

function getObservedAttributesArray(
  member: PropertyDeclaration | GetAccessorDeclaration
): ArrayLiteralExpression | undefined {
  if (isPropertyDeclaration(member)) {
    return member.initializer && isArrayLiteralExpression(member.initializer)
      ? member.initializer
      : undefined;
  }
  for (const statement of member.body?.statements ?? []) {
    if (
      isReturnStatement(statement) &&
      statement.expression &&
      isArrayLiteralExpression(statement.expression)
    ) {
      return statement.expression;
    }
  }
  return undefined;
}

async function findObservedAttributeMember(
  instanceType: Type,
  attributeName: string
): Promise<string | undefined> {
  const candidates = [attributeName, camelCase(attributeName)];
  for (const name of candidates) {
    const symbol = await instanceType.getProperty(name);
    if (!symbol) {
      continue;
    }
    for (const handle of symbol.declarations) {
      const declaration = await handle.resolve();
      if (
        declaration &&
        (isGetAccessorDeclaration(declaration) ||
          isSetAccessorDeclaration(declaration)) &&
        !hasVisibilityModifier(declaration)
      ) {
        return name;
      }
    }
  }
  return undefined;
}

async function collectRegistryBindings(
  checker: Checker,
  sourceFiles: readonly SourceFile[]
): Promise<Map<number, RegistryBinding>> {
  const bindings = new Map<number, RegistryBinding>();
  for (const sourceFile of sourceFiles) {
    await visitAsync(sourceFile, async (node) => {
      if (
        isVariableDeclaration(node) &&
        node.initializer &&
        isNewExpression(node.initializer) &&
        isIdentifier(node.initializer.expression) &&
        node.initializer.expression.text === 'CustomElementRegistry'
      ) {
        const symbol = await checker.getSymbolOfDeclaration(node);
        bindings.set(symbol.id, {symbolId: symbol.id, declaration: node});
      }
    });
  }
  return bindings;
}

async function recognizeDefinition(
  checker: Checker,
  call: CallExpression,
  registries: ReadonlyMap<number, RegistryBinding>
): Promise<
  | {declaration: ClassLikeDeclaration; evidence: RegistrationEvidence}
  | undefined
> {
  if (
    !isPropertyAccessExpression(call.expression) ||
    call.expression.name.text !== 'define'
  ) {
    return undefined;
  }
  const tagName = call.arguments[0];
  const classArgument = call.arguments[1];
  if (
    !tagName ||
    !isStringLiteralLikeNode(tagName) ||
    !classArgument ||
    !isIdentifier(classArgument)
  ) {
    return undefined;
  }

  const receiver = call.expression.expression;
  if (!isIdentifier(receiver)) {
    return undefined;
  }
  let scope: 'global' | 'custom';
  let registryDeclarationId: string | undefined;
  if (receiver.text === 'customElements') {
    scope = 'global';
  } else {
    const symbol = await checker.getSymbolAtLocation(receiver);
    const binding = symbol ? registries.get(symbol.id) : undefined;
    if (!binding) {
      return undefined;
    }
    scope = 'custom';
    registryDeclarationId = declarationId(
      binding.declaration,
      binding.declaration.name.getText()
    );
  }

  const declaration = await resolveClassExpression(checker, classArgument);
  if (!declaration) {
    return undefined;
  }
  return {
    declaration,
    evidence: {
      tagName: tagName.text,
      fileName: call.getSourceFile().fileName,
      range: sourceRange(call),
      scope,
      ...(registryDeclarationId ? {registryDeclarationId} : {}),
      strategy: 'vanilla',
    },
  };
}

function hasVisibilityModifier(node: Node): boolean {
  if (!('modifiers' in node)) {
    return false;
  }
  const modifiers = node.modifiers;
  return (
    Array.isArray(modifiers) &&
    modifiers.some(
      (modifier) =>
        modifier.kind === SyntaxKind.PrivateKeyword ||
        modifier.kind === SyntaxKind.ProtectedKeyword
    )
  );
}

function camelCase(attributeName: string): string {
  return attributeName.replace(/-([a-z])/g, (_, letter: string) =>
    letter.toUpperCase()
  );
}
