import {
  AnalysisCapability,
  type AnalysisIssue,
  type DiscoveryResult,
  type ProjectIdentity,
  type WebComponentRecord,
} from '@ts7-lit-analyzer/cem-analyzer-ts7';
import type {
  Attribute,
  ClassMember,
  CustomElementField,
  Event,
  Reference,
  Slot,
} from 'custom-elements-manifest';

import type {DeclarationEvidence} from '@ts7-lit-analyzer/cem-analyzer-ts7';

/**
 * An immutable, snapshot-scoped index over discovery records. Records are
 * adopted from the engine without adaptation; the view only indexes them and
 * never traverses TypeScript ASTs or dereferences semantic handles.
 */
export interface RegistryView {
  readonly project: ProjectIdentity;
  readonly snapshotId: string;
  readonly generation: number;
  readonly containsOverlays: boolean;
  readonly overlayFiles: readonly string[];
  readonly issues: readonly AnalysisIssue[];
  readonly moduleResolutionFallbackCount?: number;
  components(): readonly WebComponentRecord[];
  byTagName(tagName: string): WebComponentRecord | undefined;
  byDeclarationId(declarationId: string): WebComponentRecord | undefined;
}

export function createRegistryView(result: DiscoveryResult): RegistryView {
  const byTag = new Map<string, WebComponentRecord>();
  const byDeclaration = new Map<string, WebComponentRecord>();
  for (const component of result.components) {
    byDeclaration.set(component.declarationEvidence.id, component);
    const tags = new Set<string>();
    if (component.declaration.tagName) tags.add(component.declaration.tagName);
    for (const registration of component.registrations) {
      tags.add(registration.tagName);
    }
    for (const tag of tags) {
      if (!byTag.has(tag)) byTag.set(tag, component);
    }
  }
  return {
    project: result.project,
    snapshotId: result.snapshotId,
    generation: result.generation,
    containsOverlays: result.containsOverlays,
    overlayFiles: result.overlayFiles,
    issues: result.issues,
    ...(result.moduleResolutionFallbackCount !== undefined
      ? {moduleResolutionFallbackCount: result.moduleResolutionFallbackCount}
      : {}),
    components: () => result.components,
    byTagName: (tagName) => byTag.get(tagName),
    byDeclarationId: (declarationId) => byDeclaration.get(declarationId),
  };
}

export function findMember(
  record: WebComponentRecord,
  memberName: string
): ClassMember | undefined {
  return record.declaration.members?.find(
    (member) => member.name === memberName
  );
}

export function findProperty(
  record: WebComponentRecord,
  propertyName: string
): CustomElementField | undefined {
  const member = findMember(record, propertyName);
  return member?.kind === 'field' ? member : undefined;
}

export interface AttributeResolution {
  attribute: Attribute;
  property?: CustomElementField;
}

export function resolveAttribute(
  record: WebComponentRecord,
  attributeName: string
): AttributeResolution | undefined {
  const attribute = record.declaration.attributes?.find(
    (candidate) => candidate.name === attributeName
  );
  if (!attribute) return undefined;
  const property = attribute.fieldName
    ? findProperty(record, attribute.fieldName)
    : undefined;
  return {attribute, ...(property ? {property} : {})};
}

export function findEvent(
  record: WebComponentRecord,
  eventName: string
): Event | undefined {
  return record.declaration.events?.find((event) => event.name === eventName);
}

export function findSlot(
  record: WebComponentRecord,
  slotName: string
): Slot | undefined {
  return record.declaration.slots?.find((slot) => slot.name === slotName);
}

export function superclassReference(
  record: WebComponentRecord
): Reference | undefined {
  return record.declaration.superclass;
}

export function memberDeclaration(
  record: WebComponentRecord,
  memberName: string
): DeclarationEvidence | undefined {
  return record.members.find((member) => member.memberName === memberName)
    ?.declaration;
}

export type CapabilityStatus = 'complete' | 'incomplete' | 'not-collected';

export function capabilityStatus(
  record: WebComponentRecord,
  capability: number
): CapabilityStatus {
  if (record.analysis.complete & capability) return 'complete';
  if (record.analysis.incomplete & capability) return 'incomplete';
  return 'not-collected';
}

export type MetadataCoverage =
  'documented' | 'undocumented' | 'incomplete' | 'not-collected';

/**
 * Optional metadata coverage distinguishes documented facts from undocumented
 * emptiness. Without a manifest, an empty complete capability means metadata is
 * undocumented, never a confirmed absence.
 */
export function optionalMetadataCoverage(
  record: WebComponentRecord,
  capability: number
): MetadataCoverage {
  const status = capabilityStatus(record, capability);
  if (status !== 'complete') return status;
  return metadataItems(record, capability).length > 0
    ? 'documented'
    : 'undocumented';
}

function metadataItems(
  record: WebComponentRecord,
  capability: number
): readonly unknown[] {
  const declaration = record.declaration;
  if (capability === AnalysisCapability.events) {
    return declaration.events ?? [];
  }
  if (capability === AnalysisCapability.slots) {
    return declaration.slots ?? [];
  }
  if (capability === AnalysisCapability.css) {
    return [
      ...(declaration.cssParts ?? []),
      ...(declaration.cssProperties ?? []),
      ...(declaration.cssStates ?? []),
    ];
  }
  return [];
}
