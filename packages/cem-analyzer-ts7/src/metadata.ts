import type {
  Attribute,
  ClassMember,
  CustomElementField,
} from 'custom-elements-manifest';
import type {Checker, Program} from 'typescript/async';
import {
  isClassDeclaration,
  isExpressionStatement,
  type ClassDeclaration,
  type Node,
  type SourceFile,
} from 'typescript/ast';

import {
  AnalysisCapability,
  markAnalysisComplete,
  markAnalysisIncomplete,
} from './contracts.js';
import type {DeclarationEvidence, WebComponentRecord} from './contracts.js';
import {
  collectClassDocumentation,
  collectMemberDocumentation,
  type ClassDocumentationFragment,
} from './jsdoc.js';
import {
  collectFrameworkMetadata,
  type ComponentFrameworkFragment,
} from './strategies/index.js';

export interface MetadataContext {
  program: Program;
  checker: Checker;
  sourceFiles: readonly SourceFile[];
}

export async function mergeComponentMetadata(
  components: readonly WebComponentRecord[],
  context: MetadataContext,
  collectedFragments?: readonly ComponentFrameworkFragment[]
): Promise<WebComponentRecord[]> {
  const fragments =
    collectedFragments ?? (await collectFrameworkMetadata(context));
  const fragmentsByDeclaration = new Map(
    fragments.map((fragment) => [fragment.declaration.id, fragment])
  );
  const result: WebComponentRecord[] = [];

  for (const component of components) {
    const fragment = fragmentsByDeclaration.get(
      component.declarationEvidence.id
    );
    if (!fragment) continue;
    const classDeclaration = await findClassDeclaration(
      context.program,
      component.declarationEvidence
    );
    const documentation = classDeclaration
      ? collectClassDocumentation(classDeclaration)
      : undefined;
    if (documentation?.ignored) continue;
    if (fragment.registrations.length === 0 && !documentation?.tagName)
      continue;
    result.push(
      await mergeComponent(
        component,
        fragment,
        documentation,
        context.program,
        fragmentsByDeclaration
      )
    );
  }
  return result;
}

async function mergeComponent(
  component: WebComponentRecord,
  fragment: ComponentFrameworkFragment,
  documentation: ClassDocumentationFragment | undefined,
  program: Program,
  fragmentsByDeclaration: ReadonlyMap<string, ComponentFrameworkFragment>
): Promise<WebComponentRecord> {
  const declaration = component.declaration;
  const metadataMembers = new Map<string, CustomElementField>();
  for (const member of fragment.members) {
    metadataMembers.set(member.name, member);
  }
  for (const member of documentation?.members ?? []) {
    metadataMembers.set(
      member.name,
      mergeFieldMetadata(metadataMembers.get(member.name), member)
    );
  }

  const ignoredMembers = new Set<string>();
  const documentedMembers = new Map<string, CustomElementField>();
  const memberAttributes: Attribute[] = [];
  for (const semantics of component.members) {
    const declaringFragment = findDeclaringFragment(
      fragmentsByDeclaration,
      semantics.declaration,
      semantics.memberName
    );
    const frameworkMember = declaringFragment?.members.find(
      (member) => member.name === semantics.memberName
    );
    if (frameworkMember) {
      metadataMembers.set(
        semantics.memberName,
        mergeFieldMetadata(
          metadataMembers.get(semantics.memberName),
          frameworkMember
        )
      );
    }
    memberAttributes.push(
      ...(declaringFragment?.attributes.filter(
        (attribute) => attribute.fieldName === semantics.memberName
      ) ?? [])
    );
  }
  for (const semantics of component.members) {
    const node = await findEvidenceNode(program, semantics.declaration);
    const documentationHost =
      node?.parent && isExpressionStatement(node.parent) ? node.parent : node;
    if (!documentationHost) continue;
    const memberDocumentation = collectMemberDocumentation(documentationHost);
    const memberName = memberDocumentation.memberName ?? semantics.memberName;
    if (memberDocumentation.ignored) {
      ignoredMembers.add(memberName);
      continue;
    }
    if (memberDocumentation.member) {
      documentedMembers.set(memberName, memberDocumentation.member);
    }
    memberAttributes.push(...memberDocumentation.attributes);
  }

  declaration.members = (declaration.members ?? [])
    .filter((member) => !ignoredMembers.has(member.name))
    .map((member) => {
      const metadata = metadataMembers.get(member.name);
      const documented = documentedMembers.get(member.name);
      return mergeFieldMetadata(
        mergeFieldMetadata(metadata, documented),
        member
      );
    });
  for (const [name, member] of metadataMembers) {
    if (
      !ignoredMembers.has(name) &&
      !declaration.members.some((candidate) => candidate.name === name)
    ) {
      declaration.members.push(member);
    }
  }
  component.members = component.members.filter(
    (member) => !ignoredMembers.has(member.memberName)
  );

  declaration.attributes = mergeUnique(
    fragment.attributes,
    documentation?.attributes ?? [],
    memberAttributes
  );
  declaration.events = mergeUnique(
    fragment.events,
    documentation?.events ?? []
  );
  declaration.slots = mergeUnique(documentation?.slots ?? []);
  declaration.cssParts = mergeUnique(documentation?.cssParts ?? []);
  declaration.cssProperties = mergeUnique(documentation?.cssProperties ?? []);
  declaration.cssStates = mergeUnique(documentation?.cssStates ?? []);
  if (documentation?.description && !declaration.description) {
    declaration.description = documentation.description;
  }
  if (documentation?.summary) declaration.summary = documentation.summary;
  const tagName = documentation?.tagName ?? fragment.registrations[0]?.tagName;
  if (tagName) {
    declaration.customElement = true;
    declaration.tagName = tagName;
  }
  component.registrations = [...fragment.registrations];
  markAnalysisComplete(
    component.analysis,
    AnalysisCapability.registration |
      AnalysisCapability.attributes |
      AnalysisCapability.events |
      AnalysisCapability.slots |
      AnalysisCapability.css
  );
  if (fragment.issues.length > 0) {
    markAnalysisIncomplete(component.analysis, AnalysisCapability.attributes);
    component.analysis.issues.push(...fragment.issues);
  }
  return component;
}

function findDeclaringFragment(
  fragments: ReadonlyMap<string, ComponentFrameworkFragment>,
  evidence: DeclarationEvidence,
  memberName: string
): ComponentFrameworkFragment | undefined {
  const declarationId = evidence.id.replace(/\.[^.]+$/, '');
  const direct = fragments.get(declarationId);
  if (
    direct?.members.some((member) => member.name === memberName) ||
    direct?.attributes.some((attribute) => attribute.fieldName === memberName)
  ) {
    return direct;
  }
  return [...fragments.values()].find(
    (fragment) =>
      fragment.declaration.fileName === evidence.fileName &&
      fragment.declaration.range.start <= evidence.range.start &&
      fragment.declaration.range.end >= evidence.range.end &&
      fragment.members.some((member) => member.name === memberName)
  );
}

function mergeFieldMetadata<T extends ClassMember>(
  metadata: CustomElementField | undefined,
  member: T
): T;
function mergeFieldMetadata(
  metadata: CustomElementField | undefined,
  member: CustomElementField | undefined
): CustomElementField | undefined;
function mergeFieldMetadata(
  metadata: CustomElementField | undefined,
  member: ClassMember | undefined
): ClassMember | undefined {
  if (!metadata) return member;
  if (!member) return metadata;
  const merged = {...metadata, ...member};
  if (member.kind === 'field' && !member.type && metadata.type) {
    (merged as CustomElementField).type = metadata.type;
  }
  return merged;
}

function mergeUnique<T>(...groups: readonly (readonly T[])[]): T[] {
  const result: T[] = [];
  const identities = new Set<string>();
  for (const group of groups) {
    for (const item of group) {
      const identity = JSON.stringify(item);
      if (!identities.has(identity)) {
        identities.add(identity);
        result.push(item);
      }
    }
  }
  return result;
}

async function findClassDeclaration(
  program: Program,
  evidence: DeclarationEvidence
): Promise<ClassDeclaration | undefined> {
  const node = await findEvidenceNode(program, evidence);
  return node && isClassDeclaration(node) ? node : undefined;
}

async function findEvidenceNode(
  program: Program,
  evidence: DeclarationEvidence
): Promise<Node | undefined> {
  const sourceFile = await program.getSourceFile(evidence.fileName);
  if (!sourceFile) return undefined;
  function visit(node: Node): Node | undefined {
    if (
      node.getStart(sourceFile) === evidence.range.start &&
      node.end === evidence.range.end
    ) {
      return node;
    }
    return node.forEachChild(visit);
  }
  return visit(sourceFile);
}
