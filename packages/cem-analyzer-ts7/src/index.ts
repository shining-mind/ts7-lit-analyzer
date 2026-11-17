export const cemAnalyzerTs7PackageVersion = '0.0.0';

export {createDiscoverySession} from './session/index.js';
export {AnalysisCapability} from './contracts.js';
export type {
  AnalysisIssue,
  ComponentAnalysis,
  DeclarationEvidence,
  DiscoveryResult,
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
  DiscoveryOptions,
  DiscoverySession,
  LazyDiscoverySession,
  StandaloneDiscoveryOptions,
  VirtualSymlink,
} from './session/index.js';
