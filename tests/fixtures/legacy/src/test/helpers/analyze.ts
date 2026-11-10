import type {Program, SourceFile} from 'typescript';
import type {LitAnalyzerConfig} from 'lit-analyzer/lib/analyze/lit-analyzer-config.js';
import type {LitDiagnostic} from 'lit-analyzer/lib/analyze/types/lit-diagnostic.js';
import type {TestFile} from './compile-files.ts';
import {prepareAnalyzer} from './provider.ts';
import type {Range} from 'lit-analyzer/lib/analyze/types/range.js';
import type {LitCodeFix} from 'lit-analyzer/lib/analyze/types/lit-code-fix.js';
import type {LitIndexEntry} from 'lit-analyzer/lib/analyze/document-analyzer/html/lit-html-document-analyzer.js';

export {prepareAnalyzer} from './provider.ts';

export function getDiagnostics(
  inputFiles: TestFile[] | TestFile,
  config: Partial<LitAnalyzerConfig> = {}
): {diagnostics: LitDiagnostic[]; program: Program; sourceFile: SourceFile} {
  const {analyzer, sourceFile, program} = prepareAnalyzer(inputFiles, config);

  return {
    diagnostics: analyzer.getDiagnosticsInFile(sourceFile),
    program,
    sourceFile,
  };
}

export function getCodeFixesAtRange(
  inputFiles: TestFile[] | TestFile,
  range: Range,
  config: Partial<LitAnalyzerConfig> = {}
): {codeFixes: LitCodeFix[]; program: Program; sourceFile: SourceFile} {
  const {analyzer, sourceFile, program} = prepareAnalyzer(inputFiles, config);

  return {
    codeFixes: analyzer.getCodeFixesAtPositionRange(sourceFile, range),
    program,
    sourceFile,
  };
}

export function getIndexEntries(
  inputFiles: TestFile[] | TestFile,
  config: Partial<LitAnalyzerConfig> = {}
): {
  indexEntries: IterableIterator<LitIndexEntry>;
  program: Program;
  sourceFile: SourceFile;
} {
  const {analyzer, sourceFile, program} = prepareAnalyzer(inputFiles, config);

  return {
    indexEntries: analyzer.indexFile(sourceFile),
    program,
    sourceFile,
  };
}
