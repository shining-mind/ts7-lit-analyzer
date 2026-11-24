import {analyzerPackageVersion} from '@ts7-lit-analyzer/analyzer-core';
import {workspace, type ExtensionContext} from 'vscode';

import {
  EditorAnalysisCoordinator,
  type OrchestrationDiagnostic,
} from './host/coordinator.js';
import {ExtensionLogger} from './host/logging.js';
import {SpawnedProjectRouter} from './host/project-router.js';
import {readSettings} from './host/settings.js';

export interface ExtensionApi {
  analyzerVersion: string;
  orchestration: {
    snapshot(): OrchestrationDiagnostic;
    idle(): Promise<void>;
  };
}

let coordinator: EditorAnalysisCoordinator | undefined;
let logger: ExtensionLogger | undefined;

export async function activate(
  context: ExtensionContext
): Promise<ExtensionApi> {
  const settings = readSettings();
  logger = new ExtensionLogger(settings.loggingLevel);
  coordinator = new EditorAnalysisCoordinator({
    router: await SpawnedProjectRouter.create(),
    settings,
    logger,
  });
  coordinator.initialize();
  logger.normal('extension.activated', {version: analyzerPackageVersion});

  context.subscriptions.push(
    workspace.onDidChangeConfiguration((event) => {
      if (event.affectsConfiguration('ts7LitAnalyzer')) {
        const updated = readSettings();
        logger?.setLevel(updated.loggingLevel);
        coordinator?.updateSettings(updated);
      }
    }),
    {
      dispose: () => coordinator?.dispose(),
    }
  );
  return {
    analyzerVersion: analyzerPackageVersion,
    orchestration: {
      snapshot: () => coordinator!.snapshot(),
      idle: () => coordinator!.idle(),
    },
  };
}

export async function deactivate(): Promise<void> {
  await coordinator?.dispose();
  coordinator = undefined;
  logger?.dispose();
  logger = undefined;
}
