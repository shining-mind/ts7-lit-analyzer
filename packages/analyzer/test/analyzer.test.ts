import assert from 'node:assert/strict';
import {test} from 'node:test';

import {
  analyzerPackageVersion,
  type AnalyzerCodeFix,
  type AnalyzerCodeFixAction,
  type AnalyzerConfig,
  type AnalyzerDiagnostic,
  type SourceRange,
} from '@ts7-lit-analyzer/analyzer';

test('exports the analyzer package version', () => {
  assert.equal(analyzerPackageVersion, '0.0.0');
});

test('exports the analyzer TypeScript contracts', () => {
  const config: AnalyzerConfig = {strict: true};
  const range: SourceRange = {start: 0, end: 10};
  const diagnostic: AnalyzerDiagnostic = {
    source: 'test',
    message: 'example diagnostic',
  };
  const action: AnalyzerCodeFixAction = {newText: 'replacement'};
  const fix: AnalyzerCodeFix = {actions: [action]};

  assert.deepEqual(
    {config, range, diagnostic, action, fix},
    {
      config: {strict: true},
      range: {start: 0, end: 10},
      diagnostic: {source: 'test', message: 'example diagnostic'},
      action: {newText: 'replacement'},
      fix: {actions: [{newText: 'replacement'}]},
    }
  );
});
