import type {
  ClassField,
  ClassMember,
  ClassMethod,
  CustomElementDeclaration,
} from 'custom-elements-manifest';
import {
  SymbolFlags,
  type Checker,
  type Program,
  type ProjectId,
  type Symbol,
} from 'typescript/async';
import type {Declaration} from 'typescript/ast';

import {AnalysisCapability} from '../contracts.js';
import type {
  AnalysisIssue,
  DeclarationEvidence,
  MemberSemantics,
  MemberTypeQuery,
  ProjectIdentity,
  SemanticReference,
  WebComponentRecord,
} from '../contracts.js';
import {findClassNode, MemberTypeResolver} from './member-types.js';
import {
  collectParameters,
  createDeclarationEvidence,
  getInheritedFrom,
  getTypeIssues,
  isMethod,
  isPrivateOrProtected,
  selectDeclaration,
} from './collection.js';
import {SemanticHandleStore} from './handles.js';

export interface SemanticCollectorOptions {
  program: Program<ProjectId>;
  project: ProjectIdentity;
  snapshotId: string;
}

export interface CollectSourceFileOptions {
  materializeTypes?: boolean;
  candidates?: ReadonlySet<string>;
}

export interface SemanticCollector {
  collectSourceFile(
    fileName: string,
    options?: CollectSourceFileOptions
  ): Promise<WebComponentRecord[]>;
  collectClassSemantics(
    evidence: DeclarationEvidence,
    materializeTypes: boolean
  ): Promise<WebComponentRecord | undefined>;
  getMemberTypeQuery(
    classEvidence: DeclarationEvidence,
    memberName: string
  ): Promise<MemberTypeQuery | undefined>;
  materializeRecordTypes(
    record: WebComponentRecord
  ): Promise<{memberName: string; reference: SemanticReference}[]>;
  registerSuccessorRecord(record: WebComponentRecord): void;
  registerSuccessorQuery(
    reference: SemanticReference,
    resolve: () => Promise<SemanticReference>
  ): void;
  getTypeAtPosition(
    fileName: string,
    position: number
  ): Promise<SemanticReference | undefined>;
  isAssignable(
    source: SemanticReference,
    target: SemanticReference
  ): Promise<boolean>;
}

export function createSemanticCollector(
  options: SemanticCollectorOptions
): SemanticCollector {
  return new CheckerSemanticCollector(options);
}

/**
 * Collects checker-backed class and member semantics. Handle storage and
 * on-demand type resolution live in dedicated collaborators; this collector
 * owns the collection pipeline and the public collector contract.
 */
class CheckerSemanticCollector implements SemanticCollector {
  private readonly program: Program<ProjectId>;
  private readonly checker: Checker;
  private readonly project: ProjectIdentity;
  private readonly handles: SemanticHandleStore;
  private readonly memberTypes: MemberTypeResolver;

  constructor(options: SemanticCollectorOptions) {
    this.program = options.program;
    this.checker = options.program.getProject().checker;
    this.project = options.project;
    this.handles = new SemanticHandleStore(options.project, options.snapshotId);
    this.memberTypes = new MemberTypeResolver(
      options.program,
      this.checker,
      this.handles
    );
  }

  async collectSourceFile(
    fileName: string,
    options?: CollectSourceFileOptions
  ): Promise<WebComponentRecord[]> {
    const materializeTypes = options?.materializeTypes ?? true;
    const candidates = options?.candidates;
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
      const component = await this.collectClass(
        exportSymbol,
        classSymbol,
        materializeTypes,
        candidates
      );
      if (component) {
        components.push(component);
      }
    }
    return components;
  }

  async collectClassSemantics(
    evidence: DeclarationEvidence,
    materializeTypes: boolean
  ): Promise<WebComponentRecord | undefined> {
    const node = await findClassNode(this.program, evidence);
    if (!node) {
      return undefined;
    }
    const symbol = await this.checker.getSymbolOfDeclaration(node);
    return this.collectClass(symbol, symbol, materializeTypes);
  }

  getMemberTypeQuery(
    classEvidence: DeclarationEvidence,
    memberName: string
  ): Promise<MemberTypeQuery | undefined> {
    return this.memberTypes.getMemberTypeQuery(classEvidence, memberName);
  }

  materializeRecordTypes(
    record: WebComponentRecord
  ): Promise<{memberName: string; reference: SemanticReference}[]> {
    return this.memberTypes.materializeRecordTypes(record);
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
      kind: 'type' | 'signature'
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
        this.handles.registerSuccessor(reference, 'type', () =>
          getCurrentReference(member.memberName, 'type')
        );
      }
      if (member.signature) {
        const reference = member.signature;
        this.handles.registerSuccessor(reference, 'signature', () =>
          getCurrentReference(member.memberName, 'signature')
        );
      }
    }
  }

  registerSuccessorQuery(
    reference: SemanticReference,
    resolve: () => Promise<SemanticReference>
  ): void {
    this.handles.registerSuccessor(reference, 'type', resolve);
  }

  async getTypeAtPosition(
    fileName: string,
    position: number
  ): Promise<SemanticReference | undefined> {
    const type = await this.checker.getTypeAtPosition(fileName, position);
    return type && this.handles.storeHandle('type', type);
  }

  async isAssignable(
    source: SemanticReference,
    target: SemanticReference
  ): Promise<boolean> {
    const sourceType = await this.handles.resolveOperationHandle(
      source,
      'type'
    );
    const targetType = await this.handles.resolveOperationHandle(
      target,
      'type'
    );
    return this.checker.isTypeAssignableTo(sourceType, targetType);
  }

  private async collectClass(
    exportSymbol: Symbol,
    classSymbol: Symbol,
    materializeTypes: boolean,
    candidates?: ReadonlySet<string>
  ): Promise<WebComponentRecord | undefined> {
    const classType = await this.checker.getTypeOfSymbol(classSymbol);
    const [constructSignature] = await classType.getConstructSignatures();
    if (!constructSignature) {
      return undefined;
    }

    const instanceType =
      await this.checker.getReturnTypeOfSignature(constructSignature);
    const classDeclaration = await selectDeclaration(classSymbol);
    if (!classDeclaration) {
      return undefined;
    }

    const className =
      (classDeclaration as Declaration & {name?: {text: string}}).name?.text ??
      classSymbol.name;

    const declarationEvidence = createDeclarationEvidence(
      classDeclaration,
      className,
      exportSymbol.name
    );
    if (candidates && !candidates.has(declarationEvidence.id)) {
      return undefined;
    }

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
      const collected = await this.collectMember(
        memberSymbol,
        className,
        materializeTypes
      );

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
    className: string,
    materializeTypes: boolean
  ): Promise<
    | {member: ClassMember; semantics: MemberSemantics; issues: AnalysisIssue[]}
    | undefined
  > {
    const declaration = await selectDeclaration(memberSymbol);
    if (!declaration || memberSymbol.name.startsWith('#')) {
      return undefined;
    }

    const sourceFile = declaration.getSourceFile();
    if (await this.program.isSourceFileDefaultLibrary(sourceFile)) {
      return undefined;
    }
    if (isPrivateOrProtected(declaration)) {
      return undefined;
    }

    const inheritedFrom = getInheritedFrom(declaration, className);
    const memberEvidence = createDeclarationEvidence(
      declaration,
      `${inheritedFrom?.name ?? className}.${memberSymbol.name}`
    );
    const memberType = await this.checker.getTypeOfSymbolAtLocation(
      memberSymbol,
      declaration
    );
    const typeReference = materializeTypes
      ? this.handles.storeHandle('type', memberType)
      : undefined;
    const description = await memberSymbol.getDocumentationComment(
      this.checker
    );
    const issues = getTypeIssues(
      memberSymbol.name,
      memberType,
      memberEvidence,
      declaration
    );

    if (isMethod(memberSymbol, declaration)) {
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
        ...(typeReference ? {type: typeReference} : {}),
      };
      if (signature) {
        if (materializeTypes) {
          semantics.signature = this.handles.storeHandle(
            'signature',
            signature
          );
        }
        member.parameters = await collectParameters(
          this.checker,
          signature,
          declaration,
          issues,
          materializeTypes
        );
        const returnType =
          await this.checker.getReturnTypeOfSignature(signature);
        if (materializeTypes) {
          member.return = {
            type: {
              text: await this.checker.typeToString(returnType, declaration),
            },
          };
        }
        issues.push(
          ...getTypeIssues(
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
    };
    if (materializeTypes) {
      member.type = {
        text: await this.checker.typeToString(memberType, declaration),
      };
    }
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
        ...(typeReference ? {type: typeReference} : {}),
      },
      issues,
    };
  }
}
