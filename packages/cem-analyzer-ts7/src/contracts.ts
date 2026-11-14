import type {CustomElementDeclaration} from 'custom-elements-manifest';

export interface SourceRange {
  start: number;
  end: number;
}

export interface ProjectIdentity {
  id: string;
  currentDirectory: string;
  configFileName?: string;
}

export interface PackageIdentity {
  name: string;
  version?: string;
  realPath: string;
}

export interface DeclarationEvidence {
  id: string;
  fileName: string;
  range: SourceRange;
  exportName?: string;
  package?: PackageIdentity;
}

export interface RegistrationEvidence {
  tagName: string;
  fileName: string;
  range: SourceRange;
  scope: 'global' | 'custom';
  registryDeclarationId?: string;
  strategy: string;
}

export interface SemanticReference {
  id: string;
  projectId: string;
  snapshotId: string;
}

export type AnalysisStatus = 'complete' | 'incomplete' | 'not-collected';

export interface AnalysisIssue {
  code: string;
  message: string;
  fileName?: string;
  range?: SourceRange;
}

export interface ComponentAnalysis {
  registration: AnalysisStatus;
  semantics: AnalysisStatus;
  attributes: AnalysisStatus;
  events: AnalysisStatus;
  slots: AnalysisStatus;
  css: AnalysisStatus;
  issues: AnalysisIssue[];
}

export interface MemberSemantics {
  memberName: string;
  declaration: DeclarationEvidence;
  type?: SemanticReference;
  signature?: SemanticReference;
}

export interface WebComponentRecord {
  declaration: CustomElementDeclaration;
  declarationEvidence: DeclarationEvidence;
  project: ProjectIdentity;
  registrations: RegistrationEvidence[];
  members: MemberSemantics[];
  analysis: ComponentAnalysis;
}

export interface DiscoveryResult {
  project: ProjectIdentity;
  snapshotId: string;
  components: WebComponentRecord[];
  issues: AnalysisIssue[];
  containsOverlays: boolean;
  overlayFiles: string[];
}

export interface VirtualSourceFile {
  fileName: string;
  text: string;
}

export interface SourceOverlay extends VirtualSourceFile {
  version?: number;
}
