import type {Program, SourceFile} from 'typescript';
import type {LitAnalyzerConfig} from 'lit-analyzer/lib/analyze/lit-analyzer-config.js';
import type {LitIndexEntry} from 'lit-analyzer/lib/analyze/document-analyzer/html/lit-html-document-analyzer.js';
import type {TestFile} from './compile-files.ts';
import {prepareAnalyzer} from './provider.ts';

export {prepareAnalyzer} from './provider.ts';

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
