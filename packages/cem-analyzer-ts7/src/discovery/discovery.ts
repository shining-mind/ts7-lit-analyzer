import type {SourceFile} from 'typescript/ast';
import type {Project} from 'typescript/async';

import type {
  AnalysisIssue,
  ConsumerProvenance,
  DeclarationEvidence,
  DiscoveryResult,
  PackageIdentity,
  ProjectIdentity,
  WebComponentRecord,
} from '../contracts.js';
import {mergeComponentMetadata, type MetadataContext} from './metadata.js';
import type {BaseDocumentationCache} from './base-documentation-cache.js';
import {
  getImplementationFileName,
  type ModuleGraph,
  type ModuleRecord,
} from '../graph/module-graph.js';
import type {SemanticCollector} from '../semantics/collector.js';
import {collectFrameworkMetadata} from '../strategies/index.js';

export interface DiscoveryResultOptions {
  filterCandidates?: boolean;
  baseDocumentationCache?: BaseDocumentationCache;
}

export async function createDiscoveryResult(
  project: ProjectIdentity,
  snapshotId: string,
  generation: number,
  graph: ModuleGraph,
  overlayFiles: readonly string[],
  semantics: SemanticCollector,
  analysisProject: Project,
  previous?: {
    result: DiscoveryResult;
    affectedFiles: ReadonlySet<string>;
    moduleFiles: ReadonlySet<string>;
  },
  options?: DiscoveryResultOptions
): Promise<DiscoveryResult> {
  const affectedFiles = previous?.affectedFiles ?? new Set<string>();
  const filesToCollect = new Set(affectedFiles);
  const reusableComponents = new Map<string, WebComponentRecord>();
  for (const component of previous?.result.components ?? []) {
    if (isUnaffected(component, affectedFiles)) {
      reusableComponents.set(component.declarationEvidence.id, component);
    } else {
      filesToCollect.add(component.declarationEvidence.fileName);
    }
  }
  const issues: AnalysisIssue[] = graph.unresolvedModules.map((module) => ({
    code: 'unresolved-module',
    message: `Cannot resolve '${module.moduleSpecifier}' from '${module.fileName}'.`,
    fileName: module.fileName,
  }));
  const collected: WebComponentRecord[] = [];
  const componentIds = new Set<string>();
  const collectedById = new Map<string, WebComponentRecord>();
  const sourceFiles: SourceFile[] = [];
  const modulesByFile = new Map(
    graph.modules.map((module) => [module.fileName, module])
  );
  for (const module of graph.modules) {
    const sourceFile = await analysisProject.program.getSourceFile(
      module.fileName
    );
    if (sourceFile) sourceFiles.push(sourceFile);
  }

  const metadataContext: MetadataContext = {
    program: analysisProject.program,
    checker: analysisProject.checker,
    sourceFiles,
    snapshotId,
    ...(options?.baseDocumentationCache
      ? {baseDocumentationCache: options.baseDocumentationCache}
      : {}),
  };
  const fragments = await collectFrameworkMetadata(metadataContext);
  const candidates =
    (options?.filterCandidates ?? true)
      ? buildCandidateIds(fragments)
      : undefined;
  for (const fragment of fragments) {
    if (
      fragment.registrations.some((registration) =>
        affectedFiles.has(registration.fileName)
      ) ||
      fragment.evidence.some((evidence) => affectedFiles.has(evidence.fileName))
    ) {
      filesToCollect.add(fragment.declaration.fileName);
    }
  }

  for (const module of graph.modules) {
    if (
      previous &&
      previous.moduleFiles.has(module.fileName) &&
      !filesToCollect.has(module.fileName)
    ) {
      continue;
    }
    for (const component of await semantics.collectSourceFile(
      module.fileName,
      candidates ? {candidates} : {}
    )) {
      const id = component.declarationEvidence.id;
      const provenance = consumerProvenanceEntry(
        module,
        component.declarationEvidence.exportName ?? component.declaration.name
      );
      const existing = collectedById.get(id);
      if (!existing) {
        componentIds.add(id);
        const declarationModule = modulesByFile.get(
          component.declarationEvidence.fileName
        );
        const packageIdentity = declarationModule
          ? getPackageIdentity(declarationModule)
          : undefined;
        if (packageIdentity) {
          component.declarationEvidence.package = packageIdentity;
        }
        component.consumerProvenance = [provenance];
        collectedById.set(id, component);
        collected.push(component);
      } else {
        addConsumerProvenance(existing, provenance);
      }
    }
  }
  const components = await mergeComponentMetadata(
    collected,
    metadataContext,
    fragments
  );
  for (const component of components) {
    applySuperclassProvenance(component, graph.modules);
  }
  const mergedIds = new Set(
    components.map((component) => component.declarationEvidence.id)
  );
  const moduleFiles = new Set(graph.modules.map((module) => module.fileName));
  for (const [id, component] of reusableComponents) {
    if (
      !mergedIds.has(id) &&
      moduleFiles.has(component.declarationEvidence.fileName)
    ) {
      semantics.registerSuccessorRecord(component);
      components.push(component);
    }
  }
  return {
    project,
    snapshotId,
    generation,
    components,
    issues,
    containsOverlays: overlayFiles.length > 0,
    overlayFiles: [...overlayFiles].sort(),
    ...(graph.moduleResolutionFallbackCount !== undefined
      ? {moduleResolutionFallbackCount: graph.moduleResolutionFallbackCount}
      : {}),
  };
}

function buildCandidateIds(
  fragments: readonly {declaration: DeclarationEvidence}[]
): ReadonlySet<string> {
  const candidates = new Set<string>();
  for (const fragment of fragments) {
    candidates.add(fragment.declaration.id);
    const implementationFileName = getImplementationFileName(
      fragment.declaration.fileName
    );
    if (implementationFileName) {
      const className = fragment.declaration.id.split('#').at(-1);
      candidates.add(`${implementationFileName}#${className}`);
    }
  }
  return candidates;
}

export function isUnaffected(
  component: WebComponentRecord,
  affectedFiles: ReadonlySet<string>
): boolean {
  return (
    !affectedFiles.has(component.declarationEvidence.fileName) &&
    component.members.every(
      (member) => !affectedFiles.has(member.declaration.fileName)
    ) &&
    component.registrations.every(
      (registration) => !affectedFiles.has(registration.fileName)
    )
  );
}

export function getPackageIdentity(
  module: ModuleRecord
): PackageIdentity | undefined {
  if (!module.packageName) return undefined;
  const marker = 'node_modules/';
  const markerIndex = module.fileName.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  return {
    name: module.packageName,
    ...(module.packageVersion ? {version: module.packageVersion} : {}),
    realPath: module.fileName.slice(
      0,
      markerIndex + marker.length + module.packageName.length
    ),
  };
}

/**
 * Attaches the canonical dependency package name to a superclass reference
 * whose declaration module is part of the resolved graph. Heritage bases may be
 * present in the program without being graph modules, so the canonical real
 * path supplies the package name as a fallback. Local and built-in bases keep
 * module-only or name-only references respectively.
 */
export function applySuperclassProvenance(
  component: WebComponentRecord,
  modules: readonly ModuleRecord[]
): void {
  const superclass = component.declaration.superclass;
  if (!superclass?.module) return;
  const module = modules.find(
    (candidate) => candidate.fileName === superclass.module
  );
  const identity = module ? getPackageIdentity(module) : undefined;
  const packageName =
    identity?.name ?? packageNameFromFileName(superclass.module);
  if (packageName) superclass.package = packageName;
}

function packageNameFromFileName(fileName: string): string | undefined {
  const marker = 'node_modules/';
  const markerIndex = fileName.lastIndexOf(marker);
  if (markerIndex < 0) return undefined;
  const segments = fileName.slice(markerIndex + marker.length).split('/');
  if (segments[0]?.startsWith('@')) {
    return segments.length >= 2 ? `${segments[0]}/${segments[1]}` : undefined;
  }
  return segments[0] || undefined;
}

export function consumerProvenanceEntry(
  module: ModuleRecord,
  exportName: string
): ConsumerProvenance {
  const identity =
    getPackageIdentity(module) ?? packageIdentityFromPath(module.fileName);
  return {
    exportName,
    module: module.fileName,
    ...(identity ? {package: identity} : {}),
  };
}

function packageIdentityFromPath(
  fileName: string
): PackageIdentity | undefined {
  const name = packageNameFromFileName(fileName);
  if (!name) return undefined;
  const marker = 'node_modules/';
  const markerIndex = fileName.lastIndexOf(marker);
  return {
    name,
    realPath: fileName.slice(0, markerIndex + marker.length + name.length),
  };
}

export function addConsumerProvenance(
  component: WebComponentRecord,
  provenance: ConsumerProvenance
): void {
  const list = (component.consumerProvenance ??= []);
  const identity = JSON.stringify(provenance);
  if (!list.some((entry) => JSON.stringify(entry) === identity)) {
    list.push(provenance);
  }
}

/**
 * Accumulates consumer-facing export/module provenance for an enriched record by
 * scanning the given modules for exports that resolve to its declaration. Used
 * by lazy enrichment, where collection is per-component rather than per-module.
 */
export async function collectConsumerProvenance(
  component: WebComponentRecord,
  modules: readonly ModuleRecord[],
  semantics: SemanticCollector
): Promise<void> {
  const id = component.declarationEvidence.id;
  const candidates = new Set([id]);
  for (const module of modules) {
    for (const collected of await semantics.collectSourceFile(module.fileName, {
      candidates,
      materializeTypes: false,
    })) {
      if (collected.declarationEvidence.id === id) {
        addConsumerProvenance(
          component,
          consumerProvenanceEntry(
            module,
            collected.declarationEvidence.exportName ??
              component.declaration.name
          )
        );
      }
    }
  }
}
