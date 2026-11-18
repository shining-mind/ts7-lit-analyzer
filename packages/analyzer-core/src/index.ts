export const analyzerPackageVersion = '0.0.0';

export type {
  AnalyzerCodeFix,
  AnalyzerCodeFixAction,
  AnalyzerConfig,
  AnalyzerDiagnostic,
  SourceRange,
} from './contracts.js';

export {AnalysisCapability} from '@ts7-lit-analyzer/cem-analyzer-ts7';
export type {
  AnalysisIssue,
  ComponentAnalysis,
  ConsumerDiscoveryOptions,
  ConsumerProvenance,
  DeclarationEvidence,
  DiscoveryOptions,
  DiscoveryResult,
  DiscoverySession,
  DocumentationEvidence,
  LazyDiscoverySession,
  MemberSemantics,
  MemberTypeQuery,
  PackageIdentity,
  ProjectIdentity,
  RegistrationEvidence,
  SemanticReference,
  SourceOverlay,
  StandaloneDiscoveryOptions,
  VirtualSourceFile,
  VirtualSymlink,
  WebComponentRecord,
} from '@ts7-lit-analyzer/cem-analyzer-ts7';

export {
  capabilityStatus,
  createRegistryView,
  findEvent,
  findMember,
  findProperty,
  findSlot,
  memberDeclaration,
  optionalMetadataCoverage,
  resolveAttribute,
  superclassReference,
  type AttributeResolution,
  type CapabilityStatus,
  type MetadataCoverage,
  type RegistryView,
} from './registry.js';

export {RegistrySemantics, type SemanticProvider} from './semantics.js';

export {
  createRegistrySession,
  type LazyRegistrySession,
  type RegistrySession,
} from './session.js';
