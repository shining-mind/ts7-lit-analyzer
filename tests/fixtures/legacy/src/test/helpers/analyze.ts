import type {
  AnalyzerCodeFix,
  AnalyzerConfig,
  AnalyzerDiagnostic,
  SourceRange,
} from '@ts7-lit-analyzer/analyzer';
import type {TestFile} from './compile-files.ts';
import {prepareAnalyzer} from './provider.ts';

export {prepareAnalyzer} from './provider.ts';

export function getDiagnostics(
  inputFiles: TestFile[] | TestFile,
  config: AnalyzerConfig = {}
): {diagnostics: AnalyzerDiagnostic[]} {
  const {analyzer, sourceFile} = prepareAnalyzer(inputFiles, config);
  return {diagnostics: analyzer.getDiagnosticsInFile(sourceFile)};
}

export function getCodeFixesAtRange(
  inputFiles: TestFile[] | TestFile,
  range: SourceRange,
  config: AnalyzerConfig = {}
): {codeFixes: AnalyzerCodeFix[]} {
  const {analyzer, sourceFile} = prepareAnalyzer(inputFiles, config);
  return {
    codeFixes: analyzer.getCodeFixesAtPositionRange(sourceFile, range),
  };
}
