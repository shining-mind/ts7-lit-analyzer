import {dirname, resolve} from 'node:path';

import {
  isCallExpression,
  isExportDeclaration,
  isExternalModuleReference,
  isIdentifier,
  isImportDeclaration,
  isImportEqualsDeclaration,
  isImportTypeNode,
  isLiteralTypeNode,
  isStringLiteralLikeNode,
  SyntaxKind,
  type Node,
  type SourceFile,
} from 'typescript/ast';
import {
  ModuleKind,
  type API,
  type ModuleResolver,
  type Project,
  type RawCompilerOptions,
  type ResolutionMode,
  type Snapshot,
} from 'typescript/async';

export interface ModuleProvenance {
  moduleSpecifier?: string;
  importerFileName?: string;
  consumerFileName: string;
}

export interface ModuleDependency {
  moduleSpecifier: string;
  resolutionMode: ResolutionMode | undefined;
  resolvedFileName?: string;
  implementationFileName?: string;
  consumerFileName?: string;
  packageName?: string;
  packageVersion?: string;
  resolutionInputs?: readonly string[];
}

export interface ModuleRecord {
  fileName: string;
  packageName?: string;
  packageVersion?: string;
  provenance: ModuleProvenance[];
  dependencies: readonly ModuleDependency[];
}

export interface UnresolvedModule {
  fileName: string;
  moduleSpecifier: string;
}

export interface ModuleGraph {
  rootFiles: string[];
  modules: ModuleRecord[];
  unresolvedModules: UnresolvedModule[];
}

export interface ProjectSnapshot {
  snapshot: Snapshot;
  project: Project;
}

interface PreviousModuleGraph {
  graph: ModuleGraph;
  changedFiles: readonly string[];
}

interface ModuleGraphOptions {
  api: API;
  initial: ProjectSnapshot;
  rootFiles: readonly string[];
  initialProgramRoots?: readonly string[];
  retainProgramRoots?: readonly string[];
  compilerOptions: RawCompilerOptions;
  fileExists(fileName: string): boolean;
  reload(
    rootFiles: readonly string[],
    base: ProjectSnapshot
  ): Promise<ProjectSnapshot>;
  previous?: PreviousModuleGraph;
  createResolver?(): Promise<ModuleResolver>;
}

interface ModuleSpecifier {
  text: string;
  resolutionMode: ResolutionMode | undefined;
}

interface PackageHint {
  packageName?: string;
  packageVersion?: string;
}

export async function buildModuleGraph(
  options: ModuleGraphOptions
): Promise<ProjectSnapshot & {graph: ModuleGraph}> {
  const resolver = options.createResolver
    ? await options.createResolver()
    : await options.api.createModuleResolver(options.compilerOptions);
  let current = options.initial;
  try {
    const rootFiles = normalizeFiles(options.rootFiles);
    const includedRoots = new Set(
      normalizeFiles(options.initialProgramRoots ?? rootFiles)
    );
    const changedFiles = new Set(
      (options.previous?.changedFiles ?? []).map(normalizeFileName)
    );
    const previousModules = new Map(
      (options.previous?.graph.modules ?? []).map((module) => [
        module.fileName,
        module,
      ])
    );
    const modules = new Map<string, ModuleRecord>();
    const packageHints = new Map<string, PackageHint>();
    const processed = new Set<string>();
    const queued = new Set(rootFiles);
    let pending = [...rootFiles];

    while (pending.length > 0) {
      const nextPending: string[] = [];
      for (const fileName of pending) {
        if (processed.has(fileName)) {
          continue;
        }

        processed.add(fileName);
        const previous = previousModules.get(fileName);

        if (previous && canReuseModuleResolutions(previous, changedFiles)) {
          modules.set(fileName, {...previous, provenance: []});

          for (const dependency of previous.dependencies) {
            for (const dependencyFile of dependencyFiles(dependency)) {
              queueModule(dependencyFile, dependency);
            }
          }

          continue;
        }

        const sourceFile =
          await current.project.program.getSourceFile(fileName);
        if (sourceFile === undefined) {
          throw new Error(`Semantic root was not included: ${fileName}`);
        }
        const packageHint = packageHints.get(fileName) ?? previous;
        const dependencies: ModuleDependency[] = [];
        modules.set(fileName, {
          fileName: sourceFile.fileName,
          ...(packageHint?.packageName
            ? {packageName: packageHint.packageName}
            : {}),
          ...(packageHint?.packageVersion
            ? {packageVersion: packageHint.packageVersion}
            : {}),
          provenance: [],
          dependencies,
        });

        for (const specifier of getModuleSpecifiers(sourceFile)) {
          const result = await resolver.resolveModuleName(
            specifier.text,
            dirname(sourceFile.fileName),
            specifier.resolutionMode,
            {snapshot: current.snapshot}
          );
          const resolved = result.resolvedModule;
          const dependency: ModuleDependency = {
            moduleSpecifier: specifier.text,
            resolutionMode: specifier.resolutionMode,
          };
          dependencies.push(dependency);
          if (resolved === undefined) {
            continue;
          }

          const resolvedFileName = normalizeFileName(resolved.resolvedFileName);
          dependency.resolvedFileName = resolvedFileName;
          dependency.consumerFileName =
            resolved.originalPath ?? resolvedFileName;
          if (resolved.packageId !== undefined) {
            dependency.packageName = resolved.packageId.name;
            dependency.packageVersion = resolved.packageId.version;
          }
          if (
            resolved.packageId !== undefined ||
            resolved.isExternalLibraryImport
          ) {
            const resolutionInputs = findPackageManifests(
              [resolvedFileName, dependency.consumerFileName],
              options.fileExists
            );
            if (resolutionInputs.length > 0) {
              dependency.resolutionInputs = resolutionInputs;
            }
          }
          queueModule(resolvedFileName, dependency);

          const implementationFileName =
            getImplementationFileName(resolvedFileName);
          if (
            implementationFileName &&
            options.fileExists(implementationFileName)
          ) {
            dependency.implementationFileName = implementationFileName;
            queueModule(implementationFileName, dependency);
          }
        }
      }

      if (nextPending.length > 0) {
        const next = await options.reload([...includedRoots], current);
        await current.snapshot.dispose();
        current = next;
      }
      pending = nextPending;

      function queueModule(
        fileName: string,
        dependency: ModuleDependency
      ): void {
        const canonicalFileName = normalizeFileName(fileName);
        if (!packageHints.has(canonicalFileName)) {
          packageHints.set(canonicalFileName, {
            ...(dependency.packageName
              ? {packageName: dependency.packageName}
              : {}),
            ...(dependency.packageVersion
              ? {packageVersion: dependency.packageVersion}
              : {}),
          });
        }
        includedRoots.add(canonicalFileName);
        if (
          !processed.has(canonicalFileName) &&
          !queued.has(canonicalFileName)
        ) {
          queued.add(canonicalFileName);
          nextPending.push(canonicalFileName);
        }
      }
    }

    addProvenance(rootFiles, modules);
    if ([...includedRoots].some((fileName) => !modules.has(fileName))) {
      const next = await options.reload(
        [
          ...new Set([
            ...(options.retainProgramRoots ?? []),
            ...modules.keys(),
          ]),
        ],
        current
      );
      await current.snapshot.dispose();
      current = next;
    }

    return {
      ...current,
      graph: {
        rootFiles,
        modules: [...modules.values()],
        unresolvedModules: [...modules.values()].flatMap((module) =>
          module.dependencies
            .filter((dependency) => !dependency.resolvedFileName)
            .map((dependency) => ({
              fileName: module.fileName,
              moduleSpecifier: dependency.moduleSpecifier,
            }))
        ),
      },
    };
  } catch (error) {
    await current.snapshot.dispose();
    throw error;
  } finally {
    await resolver.dispose();
  }
}

export function getAffectedModuleFiles(
  graph: ModuleGraph,
  changedFiles: readonly string[]
): ReadonlySet<string> {
  const affected = new Set(changedFiles.map(normalizeFileName));
  let expanded = true;
  while (expanded) {
    expanded = false;
    for (const module of graph.modules) {
      const implementationFileName = getImplementationFileName(module.fileName);
      if (
        implementationFileName !== undefined &&
        affected.has(implementationFileName) &&
        !affected.has(module.fileName)
      ) {
        affected.add(module.fileName);
        expanded = true;
      }
      if (
        affected.has(module.fileName) &&
        implementationFileName !== undefined &&
        graph.modules.some(
          (candidate) => candidate.fileName === implementationFileName
        ) &&
        !affected.has(implementationFileName)
      ) {
        affected.add(implementationFileName);
        expanded = true;
      }
      for (const provenance of module.provenance) {
        if (
          provenance.importerFileName !== undefined &&
          affected.has(module.fileName) &&
          !affected.has(provenance.importerFileName)
        ) {
          affected.add(provenance.importerFileName);
          expanded = true;
        }
      }
    }
  }
  return affected;
}

function canReuseModuleResolutions(
  module: ModuleRecord,
  changedFiles: ReadonlySet<string>
): boolean {
  if (changedFiles.has(module.fileName)) {
    return false;
  }
  if (changedFiles.size === 0) {
    return true;
  }
  return module.dependencies.every(
    (dependency) =>
      dependency.resolvedFileName !== undefined &&
      !(dependency.resolutionInputs ?? []).some((fileName) =>
        changedFiles.has(fileName)
      )
  );
}

function findPackageManifests(
  fileNames: readonly string[],
  fileExists: (fileName: string) => boolean
): string[] {
  const manifests = new Set<string>();
  for (const fileName of fileNames) {
    let directory = dirname(normalizeFileName(fileName));
    while (true) {
      const manifest = resolve(directory, 'package.json');
      if (fileExists(manifest)) {
        manifests.add(manifest);
        break;
      }
      const parent = dirname(directory);
      if (parent === directory) {
        break;
      }
      directory = parent;
    }
  }
  return [...manifests];
}

function dependencyFiles(dependency: ModuleDependency): string[] {
  return [
    dependency.resolvedFileName,
    dependency.implementationFileName,
  ].filter((fileName): fileName is string => fileName !== undefined);
}

function addProvenance(
  rootFiles: readonly string[],
  modules: Map<string, ModuleRecord>
): void {
  for (const rootFile of rootFiles) {
    const module = modules.get(rootFile);
    if (module) {
      addUniqueProvenance(module, {consumerFileName: rootFile});
    }
  }
  for (const module of modules.values()) {
    for (const dependency of module.dependencies) {
      if (!dependency.resolvedFileName || !dependency.consumerFileName) {
        continue;
      }

      for (const fileName of dependencyFiles(dependency)) {
        const dependencyModule = modules.get(fileName);
        if (dependencyModule) {
          addUniqueProvenance(dependencyModule, {
            moduleSpecifier: dependency.moduleSpecifier,
            importerFileName: module.fileName,
            consumerFileName: dependency.consumerFileName,
          });
        }
      }
    }
  }
}

function addUniqueProvenance(
  module: ModuleRecord,
  provenance: ModuleProvenance
): void {
  if (
    !module.provenance.some(
      (item) =>
        item.consumerFileName === provenance.consumerFileName &&
        item.moduleSpecifier === provenance.moduleSpecifier &&
        item.importerFileName === provenance.importerFileName
    )
  ) {
    module.provenance.push(provenance);
  }
}

export function getImplementationFileName(
  declarationFileName: string
): string | undefined {
  const match = /\.d\.(ts|mts|cts)$/.exec(declarationFileName);
  if (!match) {
    return undefined;
  }
  const extension = {ts: '.js', mts: '.mjs', cts: '.cjs'}[match[1]];
  return `${declarationFileName.slice(0, -match[0].length)}${extension}`;
}

function normalizeFiles(fileNames: readonly string[]): string[] {
  return [...new Set(fileNames.map(normalizeFileName))];
}

function normalizeFileName(fileName: string): string {
  return resolve(fileName);
}

function getModuleSpecifiers(sourceFile: SourceFile): ModuleSpecifier[] {
  const specifiers: ModuleSpecifier[] = [];
  const addStringSpecifier = (
    node: Node | undefined,
    resolutionMode: ResolutionMode
  ): void => {
    if (node !== undefined && isStringLiteralLikeNode(node)) {
      specifiers.push({text: node.text, resolutionMode});
    }
  };

  const visit = (node: Node): void => {
    if (
      isImportDeclaration(node) ||
      (isExportDeclaration(node) && node.moduleSpecifier !== undefined)
    ) {
      addStringSpecifier(node.moduleSpecifier, ModuleKind.ESNext);
    } else if (
      isImportEqualsDeclaration(node) &&
      isExternalModuleReference(node.moduleReference)
    ) {
      addStringSpecifier(node.moduleReference.expression, ModuleKind.CommonJS);
    } else if (isImportTypeNode(node) && isLiteralTypeNode(node.argument)) {
      addStringSpecifier(node.argument.literal, ModuleKind.ESNext);
    } else if (isCallExpression(node)) {
      const isRequire =
        isIdentifier(node.expression) && node.expression.text === 'require';
      const isDynamicImport = node.expression.kind === SyntaxKind.ImportKeyword;

      if (isRequire || isDynamicImport) {
        addStringSpecifier(
          node.arguments[0],
          isRequire ? ModuleKind.CommonJS : ModuleKind.ESNext
        );
      }
    }

    node.forEachChild(visit);
  };

  visit(sourceFile);
  return specifiers;
}
