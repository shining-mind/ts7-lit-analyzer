import type {CustomElementDeclaration} from 'custom-elements-manifest';

import {
  AnalysisCapability,
  type AnalysisIssue,
  type DiscoveryResult,
  type ProjectIdentity,
  type WebComponentRecord,
} from '../contracts.js';
import {getPackageIdentity, isUnaffected} from '../discovery/discovery.js';
import type {ModuleGraph, ModuleRecord} from '../graph/module-graph.js';
import type {
  RegistrationIndex,
  RegistrationIndexEntry,
} from './registration-index.js';

export interface RegistryAssembly {
  index: RegistrationIndex;
  graph: ModuleGraph;
  snapshotId: string;
  generation: number;
  overlayFiles: readonly string[];
  issues: AnalysisIssue[];
}

/**
 * Owns the lazy registry: the active scope, enriched records, and structural
 * reuse. Indexed entries stay identity-only until enrichment is requested.
 */
export class ComponentRegistry {
  private readonly project: ProjectIdentity;
  private readonly enriched = new Map<string, WebComponentRecord>();
  private readonly indexed = new Map<string, WebComponentRecord>();
  private readonly scope = new Set<string>();

  constructor(project: ProjectIdentity) {
    this.project = project;
  }

  get activeScope(): ReadonlySet<string> {
    return this.scope;
  }

  extendScope(files: readonly string[]): void {
    for (const fileName of files) {
      this.scope.add(fileName);
    }
  }

  getEnriched(id: string): WebComponentRecord | undefined {
    return this.enriched.get(id);
  }

  setEnriched(record: WebComponentRecord): void {
    this.enriched.set(record.declarationEvidence.id, record);
  }

  enrichedRecords(): IterableIterator<WebComponentRecord> {
    return this.enriched.values();
  }

  enrichedIds(): ReadonlySet<string> {
    return new Set(this.enriched.keys());
  }

  invalidateAffected(affectedFiles: ReadonlySet<string>): void {
    for (const records of [this.enriched, this.indexed]) {
      for (const [id, record] of [...records]) {
        if (!isUnaffected(record, affectedFiles)) {
          records.delete(id);
        }
      }
    }
  }

  retainIndexed(ids: ReadonlySet<string>): void {
    for (const records of [this.enriched, this.indexed]) {
      for (const id of [...records.keys()]) {
        if (!ids.has(id)) {
          records.delete(id);
        }
      }
    }
  }

  assemble(assembly: RegistryAssembly): DiscoveryResult {
    const modulesByFile = new Map(
      assembly.graph.modules.map((module) => [module.fileName, module])
    );
    const components: WebComponentRecord[] = [];
    for (const entry of assembly.index.values()) {
      const id = entry.declaration.id;
      const enriched = this.enriched.get(id);
      if (enriched) {
        components.push(enriched);
        continue;
      }
      let record = this.indexed.get(id);
      if (!record) {
        record = this.createIndexedRecord(entry, modulesByFile);
        this.indexed.set(id, record);
      }
      components.push(record);
    }
    return {
      project: this.project,
      snapshotId: assembly.snapshotId,
      generation: assembly.generation,
      components,
      issues: assembly.issues,
      containsOverlays: assembly.overlayFiles.length > 0,
      overlayFiles: [...assembly.overlayFiles].sort(),
    };
  }

  private createIndexedRecord(
    entry: RegistrationIndexEntry,
    modulesByFile: ReadonlyMap<string, ModuleRecord>
  ): WebComponentRecord {
    const declaration: CustomElementDeclaration = {
      kind: 'class',
      name:
        entry.declaration.exportName ??
        entry.declaration.id.split('#').at(-1) ??
        'default',
      customElement: true,
      members: [],
      attributes: [],
      events: [],
      slots: [],
      cssParts: [],
      cssProperties: [],
      cssStates: [],
    };
    if (entry.tagName) {
      declaration.tagName = entry.tagName;
    }
    if (entry.summary) {
      declaration.summary = entry.summary;
    }
    if (entry.description) {
      declaration.description = entry.description;
    }
    const declarationEvidence = {...entry.declaration};
    const module = modulesByFile.get(entry.declaration.fileName);
    const packageIdentity = module ? getPackageIdentity(module) : undefined;
    if (packageIdentity) {
      declarationEvidence.package = packageIdentity;
    }
    return {
      declaration,
      declarationEvidence,
      project: this.project,
      registrations: [...entry.registrations],
      members: [],
      analysis: {
        complete: AnalysisCapability.registration,
        incomplete: 0,
        issues: [],
      },
    };
  }
}
