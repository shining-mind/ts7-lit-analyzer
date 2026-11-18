export const cemAnalyzerTs7PackageVersion = '0.0.0';

export {createDiscoverySession} from './session/index.js';
export {createProjectAssociationSession} from './session/project-association.js';
export type {
  AssociatedProject,
  ProjectAssociationOptions,
  ProjectAssociationSession,
} from './session/project-association.js';
export {AnalysisCapability} from './contracts.js';
export type {
  AnalysisIssue,
  ComponentAnalysis,
  ConsumerProvenance,
  DeclarationEvidence,
  DiscoveryResult,
  DocumentationEvidence,
  MemberSemantics,
  MemberTypeQuery,
  PackageIdentity,
  ProjectIdentity,
  RegistrationEvidence,
  SemanticReference,
  SourceOverlay,
  SourceRange,
  VirtualSourceFile,
  WebComponentRecord,
} from './contracts.js';
export type {
  ConsumerDiscoveryOptions,
  DiscoveryOperationOptions,
  DiscoveryOptions,
  DiscoverySession,
  DiscoveryTimingInfo,
  LazyDiscoverySession,
  StandaloneDiscoveryOptions,
  VirtualSymlink,
} from './session/index.js';
