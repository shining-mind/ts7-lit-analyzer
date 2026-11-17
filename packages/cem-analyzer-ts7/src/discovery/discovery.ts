import type {SourceFile} from 'typescript/ast';
import type {Project} from 'typescript/async';

import type {
  AnalysisIssue,
  DeclarationEvidence,
  DiscoveryResult,
  PackageIdentity,
  ProjectIdentity,
  WebComponentRecord,
} from '../contracts.js';
import {mergeComponentMetadata, type MetadataContext} from './metadata.js';
import {
  getImplementationFileName,
  type ModuleGraph,
  type ModuleRecord,
} from '../graph/module-graph.js';
import type {SemanticCollector} from '../semantics/collector.js';
import {collectFrameworkMetadata} from '../strategies/index.js';

export interface DiscoveryResultOptions {
  filterCandidates?: boolean;
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
      if (!componentIds.has(id)) {
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
        collected.push(component);
      }
    }
  }
  const components = await mergeComponentMetadata(
    collected,
    metadataContext,
    fragments
  );
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
