import {dirname, relative} from 'node:path';

import {Uri, workspace, type WorkspaceFolder} from 'vscode';

import type {TrackedDocument} from './documents.js';

export interface HostProjectAssociation {
  key: string;
  kind: 'configured' | 'inferred';
  currentDirectory: string;
  workspaceFolder?: string;
  configFileName?: string;
}

/** Associates a tracked document with the identity of its analysis project. */
export interface ProjectRouter {
  associate(document: TrackedDocument): Promise<HostProjectAssociation>;
}

/**
 * Primitive pre-#25 fallback, not TypeScript project-service routing. It scans
 * `tsconfig.json` once and chooses by path, so custom config names, solution
 * style projects, and multiply included files require native-preview routing.
 */
export class SpawnedProjectRouter implements ProjectRouter {
  private readonly configFileNames: readonly string[];

  private constructor(configFileNames: readonly string[]) {
    this.configFileNames = configFileNames;
  }

  static async create(): Promise<SpawnedProjectRouter> {
    const configs = await workspace.findFiles(
      '**/tsconfig.json',
      '**/node_modules/**'
    );
    return new SpawnedProjectRouter(configs.map((uri) => uri.fsPath).sort());
  }

  async associate(document: TrackedDocument): Promise<HostProjectAssociation> {
    const folder = workspace.getWorkspaceFolder(Uri.parse(document.uri));
    const configFileName = this.nearestConfig(document.fileName, folder);
    const workspaceFolder =
      folder?.uri.toString(true) ?? document.workspaceFolder;
    if (configFileName) {
      return {
        key: `configured:${configFileName}`,
        kind: 'configured',
        currentDirectory: dirname(configFileName),
        configFileName,
        ...(workspaceFolder ? {workspaceFolder} : {}),
      };
    }
    const currentDirectory = folder?.uri.fsPath ?? dirname(document.fileName);
    return {
      key: `inferred:${workspaceFolder ?? currentDirectory}`,
      kind: 'inferred',
      currentDirectory,
      ...(workspaceFolder ? {workspaceFolder} : {}),
    };
  }

  private nearestConfig(
    fileName: string,
    folder: WorkspaceFolder | undefined
  ): string | undefined {
    return this.configFileNames
      .filter((config) => {
        if (folder && isOutside(folder.uri.fsPath, config)) {
          return false;
        }
        const path = relative(dirname(config), fileName);
        return path !== '' && !path.startsWith('..') && !path.startsWith('/');
      })
      .sort((first, second) => second.length - first.length)[0];
  }
}

function isOutside(directory: string, fileName: string): boolean {
  const path = relative(directory, fileName);
  return path.startsWith('..') || path.startsWith('/');
}
