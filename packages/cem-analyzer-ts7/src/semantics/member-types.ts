import type {Checker, Program, Type} from 'typescript/async';
import {
  isClassDeclaration,
  isClassExpression,
  type Declaration,
  type Node,
} from 'typescript/ast';

import type {
  DeclarationEvidence,
  MemberTypeQuery,
  SemanticReference,
  WebComponentRecord,
} from '../contracts.js';
import {findEvidenceNode} from '../discovery/metadata.js';
import {collectParameters, selectDeclaration} from './collection.js';
import type {SemanticHandleStore} from './handles.js';

/**
 * Resolves member types on demand from the current snapshot and materializes
 * CEM type text at query or serialization time. Lazy records keep evidence
 * only; nothing here retains eagerly materialized text.
 */
export class MemberTypeResolver {
  private readonly program: Program;
  private readonly checker: Checker;
  private readonly handles: SemanticHandleStore;

  constructor(
    program: Program,
    checker: Checker,
    handles: SemanticHandleStore
  ) {
    this.program = program;
    this.checker = checker;
    this.handles = handles;
  }

  async getMemberTypeQuery(
    classEvidence: DeclarationEvidence,
    memberName: string
  ): Promise<MemberTypeQuery | undefined> {
    const instanceType = await this.instanceTypeFromEvidence(classEvidence);
    if (!instanceType) {
      return undefined;
    }
    const property = await instanceType.getProperty(memberName);
    if (!property) {
      return undefined;
    }
    const declaration = await selectDeclaration(property);
    if (!declaration) {
      return undefined;
    }
    const type = await this.checker.getTypeOfSymbolAtLocation(
      property,
      declaration
    );
    return {
      text: await this.checker.typeToString(type, declaration),
      reference: this.handles.storeHandle('type', type),
    };
  }

  async materializeRecordTypes(
    record: WebComponentRecord
  ): Promise<{memberName: string; reference: SemanticReference}[]> {
    const instanceType = await this.instanceTypeFromEvidence(
      record.declarationEvidence
    );
    if (!instanceType) {
      return [];
    }
    const semanticsByName = new Map(
      record.members.map((member) => [member.memberName, member])
    );
    const stored: {memberName: string; reference: SemanticReference}[] = [];
    for (const member of record.declaration.members ?? []) {
      const property = await instanceType.getProperty(member.name);
      if (!property) {
        continue;
      }
      const declaration = await selectDeclaration(property);
      if (!declaration) {
        continue;
      }
      const type = await this.checker.getTypeOfSymbolAtLocation(
        property,
        declaration
      );
      const reference = this.handles.storeHandle('type', type);
      const semantics = semanticsByName.get(member.name);
      if (semantics) {
        semantics.type = reference;
      }
      stored.push({memberName: member.name, reference});
      if (member.kind === 'method') {
        const [signature] = await type.getCallSignatures();
        if (signature) {
          if (semantics) {
            semantics.signature = this.handles.storeHandle(
              'signature',
              signature
            );
          }
          const returnType =
            await this.checker.getReturnTypeOfSignature(signature);
          member.return = {
            type: {
              text: await this.checker.typeToString(returnType, declaration),
            },
          };
          member.parameters = await collectParameters(
            this.checker,
            signature,
            declaration,
            [],
            true
          );
        }
      } else {
        member.type = {
          text: await this.checker.typeToString(type, declaration),
        };
      }
    }
    return stored;
  }

  private async instanceTypeFromEvidence(
    evidence: DeclarationEvidence
  ): Promise<Type | undefined> {
    const node = await findClassNode(this.program, evidence);
    if (!node) {
      return undefined;
    }
    const symbol = await this.checker.getSymbolOfDeclaration(node);
    const classType = await this.checker.getTypeOfSymbol(symbol);
    const [signature] = await classType.getConstructSignatures();
    return signature
      ? this.checker.getReturnTypeOfSignature(signature)
      : undefined;
  }
}

export async function findClassNode(
  program: Program,
  evidence: DeclarationEvidence
): Promise<Declaration | undefined> {
  const node = await findEvidenceNode(program, evidence);
  if (node && (isClassDeclaration(node) || isClassExpression(node))) {
    return node;
  }
  // Evidence ranges shift after overlays; fall back to the class name so
  // successor queries keep resolving from the current snapshot.
  const sourceFile = await program.getSourceFile(evidence.fileName);
  if (!sourceFile) {
    return undefined;
  }
  const className = evidence.id.split('#').at(-1);
  let found: Declaration | undefined;
  function visit(current: Node): void {
    if (found) {
      return;
    }
    if (
      (isClassDeclaration(current) || isClassExpression(current)) &&
      current.name?.text === className
    ) {
      found = current;
      return;
    }
    current.forEachChild(visit);
  }
  visit(sourceFile);
  return found;
}
