import type {LitAnalyzerConfig} from 'lit-analyzer/lib/analyze/lit-analyzer-config.js';
import type {TestFile} from './compile-files.ts';
import {prepareLegacyAnalyzer} from './legacy-provider.ts';

export function prepareAnalyzer(
  inputFiles: TestFile[] | TestFile,
  config: Partial<LitAnalyzerConfig> = {}
): ReturnType<typeof prepareLegacyAnalyzer> {
  const provider = process.env.ANALYZER_PROVIDER ?? 'legacy';

  if (provider !== 'legacy') {
    throw new Error(`Analyzer provider "${provider}" is not implemented`);
  }

  return prepareLegacyAnalyzer(inputFiles, config);
}
