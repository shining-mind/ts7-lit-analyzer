import {workspace} from 'vscode';

import type {CoordinatorSettings} from './coordinator.js';
import type {LoggingLevel} from './logging.js';

export interface ExtensionSettings extends CoordinatorSettings {
  loggingLevel: LoggingLevel;
}

export function readSettings(): ExtensionSettings {
  const configuration = workspace.getConfiguration('ts7LitAnalyzer');
  return {
    trigger: configuration.get<'onType' | 'onSave'>(
      'analysis.trigger',
      'onType'
    ),
    debounceMs: configuration.get<number>('analysis.debounceMs', 100),
    maxWaitMs: configuration.get<number>('analysis.maxWaitMs', 500),
    maxResidentProjects: configuration.get<number>(
      'analysis.maxResidentProjects',
      8
    ),
    loggingLevel: configuration.get<LoggingLevel>('logging.level', 'normal'),
    collectTiming:
      configuration.get<LoggingLevel>('logging.level', 'normal') !== 'normal',
  };
}
