import {analyzerPackageVersion} from '@ts7-lit-analyzer/analyzer';
import type {ExtensionContext} from 'vscode';

export function activate(_context: ExtensionContext): {
  analyzerVersion: string;
} {
  return {analyzerVersion: analyzerPackageVersion};
}
