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
  isArrayLiteralExpression,
  isCallExpression,
  isClassDeclaration,
  isClassExpression,
  isDecorator,
  isGetAccessorDeclaration,
  isIdentifier,
  isImportDeclaration,
  isInterfaceDeclaration,
  isNamedImports,
  isNewExpression,
  isObjectLiteralExpression,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertyDeclaration,
  isPropertySignatureDeclaration,
  isReturnStatement,
  isSetAccessorDeclaration,
  isSpreadAssignment,
  isStringLiteralLikeNode,
  isVariableDeclaration,
  SyntaxKind,
  type ArrayLiteralExpression,
  type CallExpression,
  type ClassDeclaration,
  type ClassExpression,
  type Decorator,
  type Expression,
  type GetAccessorDeclaration,
  type ImportDeclaration,
  type Node,
  type PropertyDeclaration,
  type SourceFile,
  type VariableDeclaration,
} from 'typescript/ast';

import type {
  AnalysisIssue,
  DeclarationEvidence,
  RegistrationEvidence,
  SourceRange,
} from './contracts.js';
import {collectClassDocumentation} from './jsdoc.js';

type ClassLikeDeclaration = ClassDeclaration | ClassExpression;

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

interface MutableFragment extends ComponentFrameworkFragment {}

interface RegistryBinding {
  symbolId: number;
  declaration: VariableDeclaration;
}

interface DecoratorIdentity {
  customElement: Set<number>;
  property: Set<number>;
  state: Set<number>;
}

interface ReactiveOptions {
  attribute?: string | false;
  reflect?: boolean;
}

export const vanillaFrameworkStrategy: FrameworkStrategy = {
  name: 'vanilla',
  collect: collectVanillaMetadata,
};

export const litFrameworkStrategy: FrameworkStrategy = {
  name: 'lit',
  collect: collectLitMetadata,
};

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
    if (declaration) fragment.declaration = declarationEvidence(declaration);
    const existing = canonicalFragments.get(fragment.declaration.id);
    if (existing) {
      mergeFragment(existing, fragment);
    } else {
      canonicalFragments.set(fragment.declaration.id, fragment);
    }
  }
  return [...canonicalFragments.values()];
}

async function collectVanillaMetadata(
  context: FrameworkStrategyContext
): Promise<ComponentFrameworkFragment[]> {
  const {checker, sourceFiles} = context;
  const fragments = new Map<string, MutableFragment>();
  const classes = collectClasses(sourceFiles);
  const htmlElement = await checker.resolveName(
    'HTMLElement',
    SymbolFlags.Interface
  );
  if (!htmlElement) return [];

  for (const declaration of classes) {
    const instanceType = await getInstanceType(checker, declaration);
    if (
      !instanceType ||
      !(await inheritsFrom(
        checker,
        instanceType,
        (symbol) => symbol.id === htmlElement.id
      ))
    )
      continue;
    const fragment = await getOrCreateFragment(fragments, declaration);
    addFramework(fragment, 'vanilla', declaration);
    await collectObservedAttributes(fragment, declaration, instanceType);
    const documentation = collectClassDocumentation(declaration);
    for (const event of documentation.events) addUnique(fragment.events, event);
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

  const registries = await collectRegistryBindings(checker, sourceFiles);
  for (const sourceFile of sourceFiles) {
    await visitAsync(sourceFile, async (node) => {
      if (!isCallExpression(node)) return;
      const registration = await recognizeDefinition(checker, node, registries);
      if (!registration) return;
      const fragment = getOrCreateFragment(fragments, registration.declaration);
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
        const declaration = symbol ? await classFromSymbol(symbol) : undefined;
        if (!declaration) continue;
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

async function collectLitMetadata(
  context: FrameworkStrategyContext
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
    if (isLit) addFramework(fragment, 'lit', declaration);

    for (const decorator of getDecorators(declaration)) {
      const call = decoratorCall(decorator);
      const kind = call
        ? await decoratorKind(checker, call, decorators)
        : undefined;
      if (kind !== 'customElement') continue;
      const tagName = call?.arguments[0];
      if (!tagName || !isStringLiteralLikeNode(tagName)) continue;
      addLitRegistration(fragment, declaration, tagName.text, decorator);
    }

    for (const member of declaration.members) {
      if (isPropertyDeclaration(member)) {
        await collectPropertyDecorators(checker, fragment, member, decorators);
      }
      collectStaticProperties(fragment, member);
    }
  }

  for (const sourceFile of sourceFiles) {
    await visitAsync(sourceFile, async (node) => {
      if (!isCompiledDecorateCall(node)) return;
      await collectCompiledDecorator(checker, fragments, node, decorators);
    });
  }

  return [...fragments.values()];
}

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
    if (!observedAttributes) continue;
    for (const element of observedAttributes.elements) {
      if (!isStringLiteralLikeNode(element)) continue;
      const memberName = await findObservedAttributeMember(
        instanceType,
        element.text
      );
      if (!memberName) continue;
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
    if (!symbol) continue;
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
        !isVariableDeclaration(node) ||
        !node.initializer ||
        !isNewExpression(node.initializer) ||
        !isIdentifier(node.initializer.expression) ||
        node.initializer.expression.text !== 'CustomElementRegistry'
      ) {
        return;
      }
      const symbol = await checker.getSymbolOfDeclaration(node);
      bindings.set(symbol.id, {symbolId: symbol.id, declaration: node});
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
  if (!isIdentifier(receiver)) return undefined;
  let scope: 'global' | 'custom';
  let registryDeclarationId: string | undefined;
  if (receiver.text === 'customElements') {
    scope = 'global';
  } else {
    const symbol = await checker.getSymbolAtLocation(receiver);
    const binding = symbol ? registries.get(symbol.id) : undefined;
    if (!binding) return undefined;
    scope = 'custom';
    registryDeclarationId = declarationId(
      binding.declaration,
      binding.declaration.name.getText()
    );
  }

  const declaration = await resolveClassExpression(checker, classArgument);
  if (!declaration) return undefined;
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
  if (!bindings || !isNamedImports(bindings)) return;
  for (const element of bindings.elements) {
    const imported = element.propertyName ?? element.name;
    if (imported.text !== importedName) continue;
    const symbol = await checker.getSymbolAtLocation(element.name);
    if (!symbol) continue;
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
    if (!isPropertyDeclaration(member)) continue;
    for (const decorator of getDecorators(member)) {
      const call = decoratorCall(decorator);
      const kind = call
        ? await decoratorKind(checker, call, decorators)
        : undefined;
      if (kind === 'property' || kind === 'state') return true;
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
  if (!isIdentifier(member.name) && !isStringLiteralLikeNode(member.name))
    return;
  for (const decorator of getDecorators(member)) {
    const call = decoratorCall(decorator);
    const kind = call
      ? await decoratorKind(checker, call, decorators)
      : undefined;
    if (kind !== 'property' && kind !== 'state') continue;
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
  decorators: DecoratorIdentity
): Promise<void> {
  const decoratorList = call.arguments[0];
  const target = call.arguments[1];
  if (!decoratorList || !isArrayLiteralExpression(decoratorList) || !target)
    return;
  for (const entry of decoratorList.elements) {
    if (!isCallExpression(entry)) continue;
    const kind = await decoratorKind(checker, entry, decorators);
    if (kind === 'customElement') {
      const tagName = entry.arguments[0];
      const declaration = await resolveClassExpression(checker, target);
      if (!tagName || !isStringLiteralLikeNode(tagName) || !declaration)
        continue;
      const fragment = await getOrCreateFragment(fragments, declaration);
      addLitRegistration(fragment, declaration, tagName.text, entry);
      addUnique(fragment.evidence, {
        kind: 'compiled-decorator',
        strategy: 'lit',
        fileName: call.getSourceFile().fileName,
        range: sourceRange(call),
      });
    } else if (kind === 'property' || kind === 'state') {
      const memberName = call.arguments[2];
      if (!memberName || !isStringLiteralLikeNode(memberName)) continue;
      const classExpression = isPropertyAccessExpression(target)
        ? target.expression
        : undefined;
      const declaration = classExpression
        ? await resolveClassExpression(checker, classExpression)
        : undefined;
      if (!declaration) continue;
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
  if (attributeName) member.attribute = attributeName;
  if (options.reflect) member.reflects = true;
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
  if (!node || !isObjectLiteralExpression(node)) return {};
  const options: ReactiveOptions = {};
  for (const property of node.properties) {
    if (!isPropertyAssignment(property) || !isIdentifier(property.name))
      continue;
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
  if (!isIdentifier(call.expression)) return undefined;
  const symbol = await checker.getSymbolAtLocation(call.expression);
  if (!symbol) return undefined;
  const aliased =
    (symbol.flags & SymbolFlags.Alias) !== 0
      ? await checker.getAliasedSymbol(symbol)
      : symbol;
  for (const kind of ['customElement', 'property', 'state'] as const) {
    if (decorators[kind].has(aliased.id)) return kind;
  }
  return undefined;
}

function decoratorCall(decorator: Decorator): CallExpression | undefined {
  return isCallExpression(decorator.expression)
    ? decorator.expression
    : undefined;
}

function getDecorators(node: Node): readonly Decorator[] {
  if (!('modifiers' in node)) return [];
  const modifiers = node.modifiers;
  if (!modifiers || !Array.isArray(modifiers)) return [];
  return modifiers.filter(isDecorator);
}

function isCompiledDecorateCall(node: Node): node is CallExpression {
  return (
    isCallExpression(node) &&
    isIdentifier(node.expression) &&
    node.expression.text === '__decorate'
  );
}

async function resolveClassExpression(
  checker: Checker,
  expression: Expression
): Promise<ClassDeclaration | undefined> {
  if (!isIdentifier(expression)) return undefined;
  const symbol = await checker.getSymbolAtLocation(expression);
  if (!symbol) return undefined;
  const aliased =
    (symbol.flags & SymbolFlags.Alias) !== 0
      ? await checker.getAliasedSymbol(symbol)
      : symbol;
  return classFromSymbol(aliased);
}

async function classFromSymbol(
  symbol: Symbol
): Promise<ClassDeclaration | undefined> {
  for (const handle of symbol.declarations) {
    const declaration = await handle.resolve();
    if (declaration && isClassDeclaration(declaration)) return declaration;
  }
  return undefined;
}

async function getInstanceType(
  checker: Checker,
  declaration: ClassLikeDeclaration
): Promise<Type | undefined> {
  const symbol = await checker.getSymbolOfDeclaration(declaration);
  const classType = await checker.getTypeOfSymbol(symbol);
  const signature = (await classType.getConstructSignatures())[0];
  return signature ? checker.getReturnTypeOfSignature(signature) : undefined;
}

async function inheritsFrom(
  checker: Checker,
  type: Type,
  predicate: (symbol: Symbol) => boolean
): Promise<boolean> {
  const visited = new Set<number>();
  async function visit(current: Type): Promise<boolean> {
    if (visited.has(current.id)) return false;
    visited.add(current.id);
    for (const base of await getCheckerBaseTypes(checker, current)) {
      const symbol = await base.getSymbol();
      if (symbol && predicate(symbol)) return true;
      if (await visit(base)) return true;
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
  if (direct && direct.length > 0) return direct;
  const symbol = await type.getSymbol();
  if (!symbol) return [];
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
      if (heritage.token !== SyntaxKind.ExtendsKeyword) continue;
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

function collectClasses(
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

async function canonicalClassDeclaration(
  context: FrameworkStrategyContext,
  fragment: ComponentFrameworkFragment
): Promise<ClassLikeDeclaration | undefined> {
  const sourceFile = context.sourceFiles.find(
    (candidate) => candidate.fileName === fragment.declaration.fileName
  );
  if (!sourceFile) return undefined;
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
    if (!declaration) node.forEachChild(visit);
  }
  visit(sourceFile);
  if (!declaration) return undefined;
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

function getOrCreateFragment(
  fragments: Map<string, MutableFragment>,
  declaration: ClassLikeDeclaration
): MutableFragment {
  const evidence = declarationEvidence(declaration);
  const existing = fragments.get(evidence.id);
  if (existing) return existing;
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

function declarationEvidence(
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

function declarationId(node: Node, name: string): string {
  return `${node.getSourceFile().fileName}#${name}`;
}

function addFramework(
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

function mergeFragment(
  target: ComponentFrameworkFragment,
  source: ComponentFrameworkFragment
): void {
  for (const framework of source.frameworks)
    addUnique(target.frameworks, framework);
  for (const registration of source.registrations) {
    addUnique(target.registrations, registration);
  }
  for (const attribute of source.attributes)
    addUnique(target.attributes, attribute);
  for (const member of source.members) addUnique(target.members, member);
  for (const event of source.events) addUnique(target.events, event);
  for (const evidence of source.evidence) addUnique(target.evidence, evidence);
  for (const issue of source.issues) addUnique(target.issues, issue);
}

function addUnique<T>(items: T[], value: T): void {
  const serialized = JSON.stringify(value);
  if (!items.some((item) => JSON.stringify(item) === serialized))
    items.push(value);
}

function sourceRange(node: Node): SourceRange {
  const sourceFile = node.getSourceFile();
  return {start: node.getStart(sourceFile), end: node.end};
}

function isStatic(node: PropertyDeclaration | GetAccessorDeclaration): boolean {
  return (
    node.modifiers?.some(
      (modifier) => modifier.kind === SyntaxKind.StaticKeyword
    ) ?? false
  );
}

function hasVisibilityModifier(node: Node): boolean {
  if (!('modifiers' in node)) return false;
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

async function visitAsync(
  node: Node,
  visitor: (node: Node) => Promise<void>
): Promise<void> {
  await visitor(node);
  for (const child of node.childrenIter()) {
    await visitAsync(child, visitor);
  }
}
