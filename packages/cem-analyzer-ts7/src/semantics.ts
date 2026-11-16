import type {
  ClassField,
  ClassMember,
  ClassMethod,
  CustomElementDeclaration,
  Parameter,
  Reference,
} from 'custom-elements-manifest';
import {
  ModifierFlags,
  SymbolFlags,
  TypeFlags,
  type Checker,
  type Program,
  type ProjectId,
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

import {AnalysisCapability} from './contracts.js';
import type {
  AnalysisIssue,
  DeclarationEvidence,
  MemberSemantics,
  ProjectIdentity,
  SemanticReference,
  WebComponentRecord,
} from './contracts.js';

export interface SemanticCollectorOptions {
  program: Program<ProjectId>;
  project: ProjectIdentity;
  snapshotId: string;
}

export interface SemanticCollector {
  collectSourceFile(fileName: string): Promise<WebComponentRecord[]>;
  registerSuccessorRecord(record: WebComponentRecord): void;
  getTypeAtPosition(
    fileName: string,
    position: number
  ): Promise<SemanticReference | undefined>;
  isAssignable(
    source: SemanticReference,
    target: SemanticReference
  ): Promise<boolean>;
}

type SemanticHandle =
  {kind: 'type'; value: Type} | {kind: 'signature'; value: Signature};

interface SuccessorHandle {
  kind: SemanticHandle['kind'];
  resolve(): Promise<SemanticHandle>;
  handle?: Promise<SemanticHandle>;
}

export function createSemanticCollector(
  options: SemanticCollectorOptions
): SemanticCollector {
  return new CheckerSemanticCollector(options);
}

class CheckerSemanticCollector implements SemanticCollector {
  private readonly program: Program<ProjectId>;
  private readonly checker: Checker;
  private readonly project: ProjectIdentity;
  private readonly snapshotId: string;
  private readonly handles = new Map<string, SemanticHandle>();
  private readonly references = new Map<Type | Signature, SemanticReference>();
  private readonly successorHandles = new Map<string, SuccessorHandle>();
  private nextHandleId = 1;

  constructor(options: SemanticCollectorOptions) {
    this.program = options.program;
    this.checker = options.program.getProject().checker;
    this.project = options.project;
    this.snapshotId = options.snapshotId;
  }

  async collectSourceFile(fileName: string): Promise<WebComponentRecord[]> {
    const sourceFile = await this.program.getSourceFile(fileName);
    if (!sourceFile) {
      return [];
    }
    const moduleSymbol = await this.checker.getSymbolOfSourceFile(fileName);
    if (!moduleSymbol) {
      return [];
    }

    const components: WebComponentRecord[] = [];
    for (const exportSymbol of await this.checker.getExportsOfModule(
      moduleSymbol
    )) {
      const classSymbol =
        exportSymbol.flags & SymbolFlags.Alias
          ? await this.checker.getAliasedSymbol(exportSymbol)
          : exportSymbol;
      const component = await this.collectClass(exportSymbol, classSymbol);
      if (component) {
        components.push(component);
      }
    }
    return components;
  }

  registerSuccessorRecord(record: WebComponentRecord): void {
    let currentComponent: Promise<WebComponentRecord | undefined> | undefined;
    const getCurrentComponent = () => {
      currentComponent ??= this.collectSourceFile(
        record.declarationEvidence.fileName
      ).then((components) =>
        components.find(
          (component) =>
            component.declarationEvidence.id === record.declarationEvidence.id
        )
      );
      return currentComponent;
    };
    const getCurrentReference = async (
      memberName: string,
      kind: SemanticHandle['kind']
    ): Promise<SemanticReference> => {
      const component = await getCurrentComponent();
      const member = component?.members.find(
        (candidate) => candidate.memberName === memberName
      );
      const reference = kind === 'type' ? member?.type : member?.signature;
      if (!reference) {
        throw new Error(
          `Cannot resolve successor ${kind} for ${record.declarationEvidence.id}.${memberName}`
        );
      }
      return reference;
    };

    for (const member of record.members) {
      if (member.type) {
        const reference = member.type;
        this.successorHandles.set(this.successorKey(reference), {
          kind: 'type',
          resolve: async () => ({
            kind: 'type',
            value: this.resolveHandle(
              await getCurrentReference(member.memberName, 'type'),
              'type'
            ),
          }),
        });
      }
      if (member.signature) {
        const reference = member.signature;
        this.successorHandles.set(this.successorKey(reference), {
          kind: 'signature',
          resolve: async () => ({
            kind: 'signature',
            value: this.resolveHandle(
              await getCurrentReference(member.memberName, 'signature'),
              'signature'
            ),
          }),
        });
      }
    }
  }

  async getTypeAtPosition(
    fileName: string,
    position: number
  ): Promise<SemanticReference | undefined> {
    const type = await this.checker.getTypeAtPosition(fileName, position);
    return type && this.storeHandle('type', type);
  }

  async isAssignable(
    source: SemanticReference,
    target: SemanticReference
  ): Promise<boolean> {
    const sourceType = await this.resolveOperationHandle(source, 'type');
    const targetType = await this.resolveOperationHandle(target, 'type');
    return this.checker.isTypeAssignableTo(sourceType, targetType);
  }

  private async collectClass(
    exportSymbol: Symbol,
    classSymbol: Symbol
  ): Promise<WebComponentRecord | undefined> {
    const classType = await this.checker.getTypeOfSymbol(classSymbol);
    const [constructSignature] = await classType.getConstructSignatures();
    if (!constructSignature) {
      return undefined;
    }

    const instanceType =
      await this.checker.getReturnTypeOfSignature(constructSignature);
    const classDeclaration = await this.selectDeclaration(classSymbol);
    if (!classDeclaration) {
      return undefined;
    }

    const className =
      (classDeclaration as Declaration & {name?: {text: string}}).name?.text ??
      classSymbol.name;

    const declarationEvidence = this.createDeclarationEvidence(
      classDeclaration,
      className,
      exportSymbol.name
    );

    const declaration: CustomElementDeclaration = {
      kind: 'class',
      name: className,
      customElement: true,
      members: [],
      attributes: [],
      events: [],
      slots: [],
      cssParts: [],
      cssProperties: [],
      cssStates: [],
    };

    const description = await classSymbol.getDocumentationComment(this.checker);
    if (description) {
      declaration.description = description;
    }

    const [baseType] = (await instanceType.getBaseTypes()) ?? [];
    const baseSymbol = await baseType?.getSymbol();
    if (baseSymbol) {
      declaration.superclass = {name: baseSymbol.name};
    }

    const members: MemberSemantics[] = [];
    const issues: AnalysisIssue[] = [];

    for (const memberSymbol of await instanceType.getProperties()) {
      const collected = await this.collectMember(memberSymbol, className);

      if (collected) {
        declaration.members?.push(collected.member);
        members.push(collected.semantics);
        issues.push(...collected.issues);
      }
    }

    return {
      declaration,
      declarationEvidence,
      project: this.project,
      registrations: [],
      members,
      analysis: {
        complete: issues.length === 0 ? AnalysisCapability.semantics : 0,
        incomplete: issues.length === 0 ? 0 : AnalysisCapability.semantics,
        issues,
      },
    };
  }

  private async collectMember(
    memberSymbol: Symbol,
    className: string
  ): Promise<
    | {member: ClassMember; semantics: MemberSemantics; issues: AnalysisIssue[]}
    | undefined
  > {
    const declaration = await this.selectDeclaration(memberSymbol);
    if (!declaration || memberSymbol.name.startsWith('#')) {
      return undefined;
    }

    const sourceFile = declaration.getSourceFile();
    if (await this.program.isSourceFileDefaultLibrary(sourceFile)) {
      return undefined;
    }

    const modifierFlags =
      (declaration as Declaration & Partial<ModifiersBase>).modifierFlags ?? 0;
    if (modifierFlags & (ModifierFlags.Private | ModifierFlags.Protected)) {
      return undefined;
    }

    const inheritedFrom = this.getInheritedFrom(declaration, className);
    const memberEvidence = this.createDeclarationEvidence(
      declaration,
      `${inheritedFrom?.name ?? className}.${memberSymbol.name}`
    );
    const memberType = await this.checker.getTypeOfSymbolAtLocation(
      memberSymbol,
      declaration
    );
    const typeReference = this.storeHandle('type', memberType);
    const description = await memberSymbol.getDocumentationComment(
      this.checker
    );
    const issues = this.getTypeIssues(
      memberSymbol.name,
      memberType,
      memberEvidence,
      declaration
    );

    if (this.isMethod(memberSymbol, declaration)) {
      const [signature] = await memberType.getCallSignatures();
      const member: ClassMethod = {
        kind: 'method',
        name: memberSymbol.name,
      };
      if (description) {
        member.description = description;
      }
      if (inheritedFrom) {
        member.inheritedFrom = inheritedFrom;
      }
      const semantics: MemberSemantics = {
        memberName: memberSymbol.name,
        declaration: memberEvidence,
        type: typeReference,
      };
      if (signature) {
        semantics.signature = this.storeHandle('signature', signature);
        member.parameters = await this.collectParameters(
          signature,
          declaration,
          issues
        );
        const returnType =
          await this.checker.getReturnTypeOfSignature(signature);
        member.return = {
          type: {
            text: await this.checker.typeToString(returnType, declaration),
          },
        };
        issues.push(
          ...this.getTypeIssues(
            memberSymbol.name,
            returnType,
            memberEvidence,
            declaration
          )
        );
      }
      return {member, semantics, issues};
    }

    const member: ClassField = {
      kind: 'field',
      name: memberSymbol.name,
      type: {text: await this.checker.typeToString(memberType, declaration)},
    };
    if (description) {
      member.description = description;
    }
    if (inheritedFrom) {
      member.inheritedFrom = inheritedFrom;
    }
    if (await this.checker.isReadonlySymbol(memberSymbol)) {
      member.readonly = true;
    }
    return {
      member,
      semantics: {
        memberName: memberSymbol.name,
        declaration: memberEvidence,
        type: typeReference,
      },
      issues,
    };
  }

  private async collectParameters(
    signature: Signature,
    location: Node,
    issues: AnalysisIssue[]
  ): Promise<Parameter[]> {
    const parameters: Parameter[] = [];
    const symbols = await signature.getParameters();
    for (let index = 0; index < symbols.length; index++) {
      const symbol = symbols[index];
      const declaration =
        (await symbol.valueDeclaration?.resolve()) ?? location;
      const type = await this.checker.getTypeOfSymbolAtLocation(
        symbol,
        declaration
      );
      const parameterDeclaration = declaration as ParameterDeclaration;
      const parameter: Parameter = {
        name: symbol.name,
        type: {text: await this.checker.typeToString(type, declaration)},
        optional: Boolean(
          parameterDeclaration.questionToken || parameterDeclaration.initializer
        ),
        rest: signature.hasRestParameter && index === symbols.length - 1,
      };
      parameters.push(parameter);
      issues.push(
        ...this.getTypeIssues(
          symbol.name,
          type,
          this.createDeclarationEvidence(declaration, symbol.name),
          declaration
        )
      );
    }
    return parameters;
  }

  private isMethod(symbol: Symbol, declaration: Declaration): boolean {
    return Boolean(
      symbol.flags & SymbolFlags.Method ||
      declaration.kind === SyntaxKind.MethodDeclaration ||
      declaration.kind === SyntaxKind.MethodSignature
    );
  }

  private async selectDeclaration(
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

  private createDeclarationEvidence(
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

  private getInheritedFrom(
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

  private getTypeIssues(
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

  private storeHandle(kind: 'type', value: Type): SemanticReference;
  private storeHandle(kind: 'signature', value: Signature): SemanticReference;
  private storeHandle(
    kind: 'type' | 'signature',
    value: Type | Signature
  ): SemanticReference {
    const existing = this.references.get(value);
    if (existing) {
      return existing;
    }
    const reference: SemanticReference = {
      id: `semantic-${this.nextHandleId++}`,
      projectId: this.project.id,
      snapshotId: this.snapshotId,
    };
    this.references.set(value, reference);
    this.handles.set(
      reference.id,
      kind === 'type'
        ? {kind, value: value as Type}
        : {kind, value: value as Signature}
    );
    return reference;
  }

  private successorKey(reference: SemanticReference): string {
    return `${reference.projectId}:${reference.snapshotId}:${reference.id}`;
  }

  private resolveOperationHandle(
    reference: SemanticReference,
    kind: 'type'
  ): Promise<Type>;
  private resolveOperationHandle(
    reference: SemanticReference,
    kind: 'signature'
  ): Promise<Signature>;
  private async resolveOperationHandle(
    reference: SemanticReference,
    kind: 'type' | 'signature'
  ): Promise<Type | Signature> {
    if (reference.projectId !== this.project.id) {
      throw new Error(
        'Semantic reference belongs to a different project or snapshot'
      );
    }
    if (reference.snapshotId === this.snapshotId) {
      return kind === 'type'
        ? this.resolveHandle(reference, 'type')
        : this.resolveHandle(reference, 'signature');
    }
    const successor = this.successorHandles.get(this.successorKey(reference));
    if (!successor || successor.kind !== kind) {
      throw new Error(
        'Semantic reference belongs to a different project or snapshot'
      );
    }
    successor.handle ??= successor.resolve();
    const handle = await successor.handle;
    return handle.value;
  }

  private resolveHandle(reference: SemanticReference, kind: 'type'): Type;
  private resolveHandle(
    reference: SemanticReference,
    kind: 'signature'
  ): Signature;
  private resolveHandle(
    reference: SemanticReference,
    kind: 'type' | 'signature'
  ): Type | Signature {
    if (
      reference.projectId !== this.project.id ||
      reference.snapshotId !== this.snapshotId
    ) {
      throw new Error(
        'Semantic reference belongs to a different project or snapshot'
      );
    }
    const handle = this.handles.get(reference.id);
    if (!handle || handle.kind !== kind) {
      throw new Error(`Semantic reference does not identify a ${kind}`);
    }
    return handle.value;
  }
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
