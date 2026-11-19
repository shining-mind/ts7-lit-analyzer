import {existsSync} from 'node:fs';
import {resolve} from 'node:path';

import {ScriptTarget} from 'typescript/ast';
import {createFileSystemLayer} from 'typescript/fs';
import {
  API,
  ModuleKind,
  ModuleResolutionKind,
  type CreateProgramOptions,
  type RawCompilerOptions,
} from 'typescript/async';

import type {DiscoveryOptions} from '../contracts.js';

/**
 * Reads and owns the session's derived configuration: project roots, compiler
 * options, virtual files, and the overlay-aware file system. Configuration is
 * cheap and is read at creation in both modes; snapshot construction is not
 * part of this responsibility.
 */
export class SessionConfiguration {
  readonly currentDirectory: string;
  private readonly options: DiscoveryOptions;
  private readonly files = new Map<string, string>();
  private rootFiles: string[] = [];
  private compilerOptions: RawCompilerOptions = {};
  private projectReferences: CreateProgramOptions['projectReferences'];

  constructor(options: DiscoveryOptions, currentDirectory: string) {
    this.options = options;
    this.currentDirectory = currentDirectory;
    for (const file of options.files ?? []) {
      this.files.set(this.absolutePath(file.fileName), file.text);
    }
  }

  get roots(): readonly string[] {
    return this.rootFiles;
  }

  get compiler(): RawCompilerOptions {
    return this.compilerOptions;
  }

  get references(): CreateProgramOptions['projectReferences'] {
    return this.projectReferences;
  }

  async read(api: API): Promise<void> {
    if (this.options.mode === 'standalone') {
      this.rootFiles = this.options.rootFiles.map((fileName) =>
        this.absolutePath(fileName)
      );
      this.compilerOptions = deriveCompilerOptions(
        this.options.compilerOptions as RawCompilerOptions | undefined
      );
      return;
    }
    await this.readConsumerConfiguration(api, this.options.configFileName);
  }

  absolutePath(fileName: string): string {
    return resolve(this.currentDirectory, fileName);
  }

  fileExists(fileName: string, overlays: ReadonlyMap<string, string>): boolean {
    const absolute = this.absolutePath(fileName);
    return (
      this.files.has(absolute) || overlays.has(absolute) || existsSync(absolute)
    );
  }

  createFileSystem(
    overlays: ReadonlyMap<string, string>
  ): ReturnType<typeof createFileSystemLayer> {
    const files = new Map(this.files);
    for (const [fileName, text] of overlays) {
      files.set(fileName, text);
    }
    return createFileSystemLayer(
      [...files].map(([fileName, text]) => [fileName, text]),
      {symlinks: {...this.options.symlinks}}
    );
  }

  private async readConsumerConfiguration(
    api: API,
    configFileName: string
  ): Promise<void> {
    const canonicalConfig = this.absolutePath(configFileName);
    const snapshot = await api.createSnapshot({
      fileSystem: this.createFileSystem(new Map()),
      openProjects: [canonicalConfig],
    });
    try {
      const project = snapshot.getConfiguredProject(canonicalConfig);
      if (project === undefined) {
        throw new Error(`Cannot open TypeScript project: ${canonicalConfig}`);
      }
      this.rootFiles = project.parsedCommandLine.fileNames.map((fileName) =>
        this.absolutePath(fileName)
      );
      this.compilerOptions = deriveCompilerOptions(
        project.parsedCommandLine.options as RawCompilerOptions
      );
      this.projectReferences = project.parsedCommandLine.projectReferences;
    } finally {
      await snapshot.dispose();
    }
  }
}

function deriveCompilerOptions(
  options: RawCompilerOptions | undefined
): RawCompilerOptions {
  return {
    strict: true,
    target: ScriptTarget.ESNext,
    module: ModuleKind.NodeNext,
    moduleResolution: ModuleResolutionKind.NodeNext,
    types: [],
    skipLibCheck: true,
    ...options,
    allowJs: true,
    checkJs: false,
    maxNodeModuleJsDepth: 0,
  };
}
