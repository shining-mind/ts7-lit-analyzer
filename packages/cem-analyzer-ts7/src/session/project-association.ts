import {resolve} from 'node:path';

import {API, type Snapshot} from 'typescript/async';
import {createFileSystemLayer} from 'typescript/fs';

import type {VirtualSourceFile} from '../contracts.js';

export interface AssociatedProject {
  id: string;
  kind: 'configured' | 'inferred';
  currentDirectory: string;
  configFileName?: string;
}

export interface ProjectAssociationOptions {
  currentDirectory: string;
  configFileNames?: readonly string[];
  files?: readonly VirtualSourceFile[];
}

export interface ProjectAssociationSession {
  associate(fileName: string, text?: string): Promise<AssociatedProject>;
  dispose(): Promise<void>;
}

export async function createProjectAssociationSession(
  options: ProjectAssociationOptions
): Promise<ProjectAssociationSession> {
  const currentDirectory = resolve(options.currentDirectory);
  const api = new API({cwd: currentDirectory, runExternalCode: false});
  const files = new Map(
    (options.files ?? []).map((file) => [
      resolve(currentDirectory, file.fileName),
      file.text,
    ])
  );
  const configFileNames = (options.configFileNames ?? []).map((fileName) =>
    resolve(currentDirectory, fileName)
  );
  let snapshot: Snapshot | undefined;
  const openedFiles = new Set<string>();

  return {
    async associate(fileName, text) {
      const canonicalFileName = resolve(currentDirectory, fileName);
      if (text !== undefined) {
        files.set(canonicalFileName, text);
      }
      const filesToOpen = openedFiles.has(canonicalFileName)
        ? []
        : [canonicalFileName];
      const params = {
        fileSystem: createFileSystemLayer([...files]),
        openProjects: configFileNames,
        openFiles: filesToOpen,
        ensurePrograms: true as const,
      };
      const next = snapshot
        ? await snapshot.update(params)
        : await api.createSnapshot(params);
      if (snapshot) {
        await snapshot.dispose();
      }
      snapshot = next;
      const project = await next.getDefaultProjectForFile(canonicalFileName);
      if (!project) {
        throw new Error(
          `No default TypeScript project for ${canonicalFileName}`
        );
      }
      openedFiles.add(canonicalFileName);
      return {
        id: project.id,
        kind: project.configFileName ? 'configured' : 'inferred',
        currentDirectory: project.currentDirectory,
        ...(project.configFileName
          ? {configFileName: project.configFileName}
          : {}),
      };
    },
    async dispose() {
      if (snapshot) {
        await snapshot.dispose();
        snapshot = undefined;
      }
      await api.close();
    },
  };
}
