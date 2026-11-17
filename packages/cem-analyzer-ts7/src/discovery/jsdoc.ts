import type {
  Attribute,
  CssCustomProperty,
  CssCustomState,
  CssPart,
  CustomElementField,
  Event,
  Slot,
} from 'custom-elements-manifest';
import {
  getJSDocCommentsAndTags,
  getJSDocTags,
  getTextOfJSDocComment,
  isBinaryExpression,
  isCallExpression,
  isClassDeclaration,
  isExpressionStatement,
  isGetAccessorDeclaration,
  isIdentifier,
  isJSDoc,
  isMethodDeclaration,
  isNewExpression,
  isPropertyAccessExpression,
  isPropertyDeclaration,
  isSetAccessorDeclaration,
  isStringLiteralLikeNode,
  isThisExpression,
  type ClassDeclaration,
  type ClassExpression,
  type JSDocTag,
  type Node,
  type SourceFile,
} from 'typescript/ast';

import type {SourceRange} from '../contracts.js';

export interface DocumentationEvidence {
  kind: 'jsdoc' | 'inline-event';
  tagName: string;
  fileName: string;
  range: SourceRange;
  memberName?: string;
}

export interface ClassDocumentationFragment {
  description?: string;
  summary?: string;
  tagName?: string;
  attributes: Attribute[];
  members: CustomElementField[];
  events: Event[];
  slots: Slot[];
  cssParts: CssPart[];
  cssProperties: CssCustomProperty[];
  cssStates: CssCustomState[];
  ignored: boolean;
  evidence: DocumentationEvidence[];
}

export interface MemberDocumentationFragment {
  memberName?: string;
  member?: CustomElementField;
  attributes: Attribute[];
  ignored: boolean;
  evidence: DocumentationEvidence[];
}

interface ParsedTag {
  typeText?: string;
  name?: string;
  defaultValue?: string;
  description?: string;
  value: string;
}

export function collectClassDocumentation(
  declaration: ClassDeclaration | ClassExpression
): ClassDocumentationFragment {
  const result: ClassDocumentationFragment = {
    attributes: [],
    members: [],
    events: [],
    slots: [],
    cssParts: [],
    cssProperties: [],
    cssStates: [],
    ignored: false,
    evidence: [],
  };
  const description = getDocumentationDescription(declaration);
  if (description) result.description = description;

  for (const tag of getJSDocTags(declaration)) {
    const tagName = tag.tagName.text.toLowerCase();
    const parsed = parseTag(tag);
    addEvidence(result.evidence, tag, tagName);

    switch (tagName) {
      case 'attr':
      case 'attribute': {
        const attribute = createAttribute(parsed);
        if (attribute) result.attributes.push(attribute);
        break;
      }
      case 'prop':
      case 'property': {
        if (parsed.name) {
          const member: CustomElementField = {kind: 'field', name: parsed.name};
          if (parsed.typeText) member.type = {text: parsed.typeText};
          if (parsed.defaultValue !== undefined)
            member.default = parsed.defaultValue;
          if (parsed.description) member.description = parsed.description;
          result.members.push(member);
        }
        break;
      }
      case 'part':
      case 'csspart': {
        if (parsed.name) {
          const part: CssPart = {name: parsed.name};
          if (parsed.description) part.description = parsed.description;
          result.cssParts.push(part);
        }
        break;
      }
      case 'slot': {
        const slot: Slot = {name: parsed.name ?? ''};
        if (parsed.description) slot.description = parsed.description;
        result.slots.push(slot);
        break;
      }
      case 'cssprop':
      case 'cssproperty': {
        if (parsed.name) {
          const property: CssCustomProperty = {name: parsed.name};
          if (parsed.typeText) property.syntax = parsed.typeText;
          if (parsed.defaultValue !== undefined)
            property.default = parsed.defaultValue;
          if (parsed.description) property.description = parsed.description;
          result.cssProperties.push(property);
        }
        break;
      }
      case 'cssstate': {
        if (parsed.name) {
          const state: CssCustomState = {name: parsed.name};
          if (parsed.description) state.description = parsed.description;
          result.cssStates.push(state);
        }
        break;
      }
      case 'fires':
      case 'event': {
        if (parsed.name) {
          result.events.push(createEvent(parsed.name, parsed));
        }
        break;
      }
      case 'tag':
      case 'tagname':
        if (parsed.value) result.tagName = firstWord(parsed.value);
        break;
      case 'summary':
        if (parsed.value) result.summary = parsed.value;
        break;
      case 'internal':
      case 'ignore':
        result.ignored = true;
        break;
    }
  }

  collectInlineEvents(declaration, result.events, result.evidence);
  return result;
}

export function collectMemberDocumentation(
  node: Node
): MemberDocumentationFragment {
  const memberName = getDocumentedMemberName(node);
  const result: MemberDocumentationFragment = {
    attributes: [],
    ignored: false,
    evidence: [],
  };
  if (memberName) result.memberName = memberName;

  const description = getDocumentationDescription(node);
  let member: CustomElementField | undefined;
  let hasMemberMetadata = description !== undefined;
  let attributeDescription: string | undefined;
  let defaultValue: string | undefined;
  let reflects = false;

  const ensureMember = (): CustomElementField => {
    if (!member) {
      member = {kind: 'field', name: memberName ?? ''};
      if (description) member.description = description;
    }
    return member;
  };

  for (const tag of getJSDocTags(node)) {
    const tagName = tag.tagName.text.toLowerCase();
    const parsed = parseTag(tag);
    addEvidence(result.evidence, tag, tagName, memberName);

    switch (tagName) {
      case 'attr':
      case 'attribute': {
        const attribute = createAttribute(parsed, memberName);
        if (attribute) {
          result.attributes.push(attribute);
          attributeDescription = attribute.description;
          if (attribute.default !== undefined) defaultValue = attribute.default;
          ensureMember().attribute = attribute.name;
          hasMemberMetadata = true;
        }
        break;
      }
      case 'prop':
      case 'property': {
        const field = ensureMember();
        if (!memberName && parsed.name) {
          field.name = parsed.name;
          result.memberName = parsed.name;
        }
        if (parsed.typeText) field.type = {text: parsed.typeText};
        if (parsed.description) field.description = parsed.description;
        hasMemberMetadata = true;
        break;
      }
      case 'default':
        defaultValue = parsed.value;
        hasMemberMetadata = true;
        break;
      case 'reflect':
        reflects = parsed.value.toLowerCase() !== 'false';
        hasMemberMetadata = true;
        break;
      case 'summary':
        ensureMember().summary = parsed.value;
        hasMemberMetadata = true;
        break;
      case 'internal':
      case 'ignore':
        result.ignored = true;
        break;
    }
  }

  if (result.ignored) {
    result.attributes = [];
    return result;
  }
  if (!hasMemberMetadata && !member) return result;

  const field = ensureMember();
  if (defaultValue !== undefined) field.default = defaultValue;
  if (reflects) field.reflects = true;
  if (!field.description && attributeDescription)
    field.description = attributeDescription;
  for (const attribute of result.attributes) {
    if (attribute.default === undefined && defaultValue !== undefined) {
      attribute.default = defaultValue;
    }
  }
  result.member = field;
  return result;
}

function getDocumentationDescription(node: Node): string | undefined {
  for (const comment of getJSDocCommentsAndTags(node)) {
    if (!isJSDoc(comment)) continue;
    const text = getTextOfJSDocComment(comment.comment)?.trim();
    if (text) return text;
  }
  return undefined;
}

function parseTag(tag: JSDocTag): ParsedTag {
  const sourceFile = tag.getSourceFile();
  const value = sourceFile.text
    .slice(tag.tagName.end, tag.end)
    .replace(/\r?\n\s*\*/g, '\n')
    .trim();
  const typeText = takeBalancedType(value);
  const remainder =
    typeText === undefined ? value : value.slice(typeText.length + 2).trim();
  const bracketed = takeBracketedName(remainder);
  const nameAndDescription = bracketed?.remainder ?? remainder;
  const separator = nameAndDescription.match(/\s+-\s+/);
  const separatorIndex = separator?.index;
  const namePart =
    separatorIndex !== undefined
      ? nameAndDescription.slice(0, separatorIndex).trim()
      : nameAndDescription.trim();
  const leadingDescription = bracketed
    ? /^-\s+(.*)$/.exec(nameAndDescription)
    : undefined;
  const description =
    separator && separatorIndex !== undefined
      ? nameAndDescription.slice(separatorIndex + separator[0].length).trim()
      : leadingDescription?.[1].trim();
  const slotWithoutName = /^-\s*/.exec(nameAndDescription);

  if (slotWithoutName && tag.tagName.text.toLowerCase() === 'slot') {
    return {
      ...(typeText !== undefined ? {typeText} : {}),
      name: '',
      description: nameAndDescription.slice(slotWithoutName[0].length).trim(),
      value,
    };
  }

  return {
    ...(typeText !== undefined ? {typeText} : {}),
    ...(bracketed
      ? {name: bracketed.name, defaultValue: bracketed.defaultValue}
      : {}),
    ...(!bracketed && namePart ? {name: firstWord(namePart)} : {}),
    ...(description ? {description} : {}),
    value,
  };
}

function takeBalancedType(value: string): string | undefined {
  if (!value.startsWith('{')) return undefined;
  let depth = 0;
  for (let index = 0; index < value.length; index++) {
    if (value[index] === '{') depth++;
    if (value[index] === '}') depth--;
    if (depth === 0) return value.slice(1, index).trim();
  }
  return undefined;
}

function takeBracketedName(
  value: string
): {name: string; defaultValue?: string; remainder: string} | undefined {
  if (!value.startsWith('[')) return undefined;
  const close = value.indexOf(']');
  if (close < 0) return undefined;
  const content = value.slice(1, close);
  const equals = content.indexOf('=');
  return {
    name: (equals < 0 ? content : content.slice(0, equals)).trim(),
    ...(equals >= 0 ? {defaultValue: content.slice(equals + 1).trim()} : {}),
    remainder: value.slice(close + 1).trim(),
  };
}

function createAttribute(
  parsed: ParsedTag,
  memberName?: string
): Attribute | undefined {
  const name = parsed.name ?? memberName;
  if (!name) return undefined;
  const attribute: Attribute = {name};
  const fieldName = memberName ?? name;
  if (fieldName) attribute.fieldName = fieldName;
  if (parsed.typeText) attribute.type = {text: parsed.typeText};
  if (parsed.defaultValue !== undefined)
    attribute.default = parsed.defaultValue;
  if (parsed.description) attribute.description = parsed.description;
  return attribute;
}

function createEvent(name: string, parsed: ParsedTag): Event {
  const event: Event = {name, type: {text: parsed.typeText ?? 'Event'}};
  if (parsed.description) event.description = parsed.description;
  return event;
}

function collectInlineEvents(
  declaration: ClassDeclaration | ClassExpression,
  events: Event[],
  evidence: DocumentationEvidence[]
): void {
  function visit(node: Node): void {
    if (
      isMethodDeclaration(node) &&
      (isIdentifier(node.name) || isStringLiteralLikeNode(node.name)) &&
      node.name.text === 'render'
    ) {
      return;
    }
    if (isCallExpression(node) && isDispatchEventCall(node)) {
      const event = getInlineEvent(node);
      if (event) {
        events.push(event.event);
        if (event.tag) {
          addEvidence(evidence, event.tag, 'type', undefined, 'inline-event');
        }
      }
    }
    node.forEachChild(visit);
  }
  visit(declaration);
}

function isDispatchEventCall(node: Node): boolean {
  return (
    isCallExpression(node) &&
    isPropertyAccessExpression(node.expression) &&
    node.expression.name.text === 'dispatchEvent' &&
    node.arguments.length > 0 &&
    isNewExpression(node.arguments[0])
  );
}

function getInlineEvent(
  node: Node
): {event: Event; tag?: JSDocTag} | undefined {
  if (!isCallExpression(node)) return undefined;
  const eventConstruction = node.arguments[0];
  if (!isNewExpression(eventConstruction)) return undefined;
  const literalName = eventConstruction.arguments?.[0];
  const dispatchedName =
    literalName && isStringLiteralLikeNode(literalName)
      ? literalName.text
      : undefined;
  const documentationHost = findExpressionStatement(node) ?? node;
  const typeTag = getJSDocTags(documentationHost).find(
    (tag) => tag.tagName.text.toLowerCase() === 'type'
  );
  const parsed = typeTag ? parseTag(typeTag) : undefined;
  const name = parsed?.name ?? dispatchedName;
  if (!name) return undefined;
  const event = createEvent(name, {
    typeText: parsed?.typeText ?? eventConstruction.expression.getText(),
    name,
    ...(parsed?.description ? {description: parsed.description} : {}),
    value: parsed?.value ?? '',
  });
  return {event, ...(typeTag ? {tag: typeTag} : {})};
}

function findExpressionStatement(node: Node): Node | undefined {
  let current: Node = node;
  while (current.parent && !isClassDeclaration(current.parent)) {
    if (isExpressionStatement(current)) return current;
    current = current.parent;
  }
  return undefined;
}

function getDocumentedMemberName(node: Node): string | undefined {
  if (
    isPropertyDeclaration(node) ||
    isGetAccessorDeclaration(node) ||
    isSetAccessorDeclaration(node)
  ) {
    return isStringLiteralLikeNode(node.name) || isIdentifier(node.name)
      ? node.name.text
      : undefined;
  }

  let found: string | undefined;
  function visit(child: Node): void {
    if (found) return;
    if (
      isBinaryExpression(child) &&
      isPropertyAccessExpression(child.left) &&
      isThisExpression(child.left.expression)
    ) {
      found = child.left.name.text;
      return;
    }
    child.forEachChild(visit);
  }
  node.forEachChild(visit);
  return found;
}

function addEvidence(
  evidence: DocumentationEvidence[],
  tag: JSDocTag,
  tagName: string,
  memberName?: string,
  kind: 'jsdoc' | 'inline-event' = 'jsdoc'
): void {
  const sourceFile: SourceFile = tag.getSourceFile();
  evidence.push({
    kind,
    tagName,
    fileName: sourceFile.fileName,
    range: {start: tag.getStart(sourceFile), end: tag.end},
    ...(memberName ? {memberName} : {}),
  });
}

function firstWord(value: string): string {
  return value.trim().split(/\s+/, 1)[0] ?? '';
}
