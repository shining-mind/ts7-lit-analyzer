import type {Program, SourceFile} from 'typescript';
import {DefaultLitAnalyzerContext} from 'lit-analyzer/lib/analyze/default-lit-analyzer-context.js';
import {LitAnalyzer} from 'lit-analyzer/lib/analyze/lit-analyzer.js';
import type {LitAnalyzerConfig} from 'lit-analyzer/lib/analyze/lit-analyzer-config.js';
import {makeConfig} from 'lit-analyzer/lib/analyze/lit-analyzer-config.js';
import type {LitAnalyzerContext} from 'lit-analyzer/lib/analyze/lit-analyzer-context.js';
import {compileFiles} from './compile-files.ts';
import type {TestFile} from './compile-files.ts';
import {getCurrentTsModule} from './ts-test.ts';

export function prepareLegacyAnalyzer(
  inputFiles: TestFile[] | TestFile,
  config: Partial<LitAnalyzerConfig> = {}
): {
  analyzer: LitAnalyzer;
  program: Program;
  sourceFile: SourceFile;
  context: LitAnalyzerContext;
} {
  const {program, sourceFile} = compileFiles(inputFiles);

  const context = new DefaultLitAnalyzerContext({
    ts: getCurrentTsModule(),
    getProgram(): Program {
      return program;
    },
  });

  const analyzer = new LitAnalyzer(context);
  context.updateConfig(makeConfig(config));

  return {
    analyzer,
    program,
    sourceFile,
    context,
  };
}
