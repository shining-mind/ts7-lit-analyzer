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

export const AnalysisCapability = {
  registration: 1 << 0,
  semantics: 1 << 1,
  attributes: 1 << 2,
  events: 1 << 3,
  slots: 1 << 4,
  css: 1 << 5,
  all: (1 << 6) - 1,
} as const;

export type AnalysisCapability =
  (typeof AnalysisCapability)[keyof typeof AnalysisCapability];

export interface AnalysisIssue {
  code: string;
  message: string;
  fileName?: string;
  range?: SourceRange;
}

export interface ComponentAnalysis {
  complete: number;
  incomplete: number;
  issues: AnalysisIssue[];
}

export function markAnalysisComplete(
  analysis: ComponentAnalysis,
  capabilities: number
): void {
  analysis.complete |= capabilities;
  analysis.incomplete &= ~capabilities;
}

export function markAnalysisIncomplete(
  analysis: ComponentAnalysis,
  capabilities: number
): void {
  analysis.complete &= ~capabilities;
  analysis.incomplete |= capabilities;
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
  generation: number;
  components: WebComponentRecord[];
  issues: AnalysisIssue[];
  containsOverlays: boolean;
  overlayFiles: string[];
}

export interface MemberTypeQuery {
  text: string;
  reference: SemanticReference;
}

export interface VirtualSourceFile {
  fileName: string;
  text: string;
}

export interface SourceOverlay extends VirtualSourceFile {
  version?: number;
}

export interface VirtualSymlink {
  target: string;
}

interface DiscoveryOptionsBase {
  currentDirectory?: string;
  files?: readonly VirtualSourceFile[];
  overlays?: readonly SourceOverlay[];
  symlinks?: Readonly<Record<string, VirtualSymlink>>;
  eagerness?: 'eager' | 'lazy';
  retentionBound?: number;
}

export interface StandaloneDiscoveryOptions extends DiscoveryOptionsBase {
  mode: 'standalone';
  rootFiles: readonly string[];
  compilerOptions?: Readonly<Record<string, unknown>>;
}

export interface ConsumerDiscoveryOptions extends DiscoveryOptionsBase {
  mode: 'consumer';
  configFileName: string;
}

export type DiscoveryOptions =
  StandaloneDiscoveryOptions | ConsumerDiscoveryOptions;
