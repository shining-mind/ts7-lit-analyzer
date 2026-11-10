import type {LitAnalyzerRuleId} from 'lit-analyzer/lib/analyze/lit-analyzer-config.js';
import type {LitDiagnostic} from 'lit-analyzer/lib/analyze/types/lit-diagnostic.js';
import type {TsTestContext} from './ts-test.ts';

export function hasDiagnostic(
  t: TsTestContext,
  diagnostics: LitDiagnostic[],
  ruleName: LitAnalyzerRuleId
): void {
  if (diagnostics.length !== 1) {
    prettyLogDiagnostics(t, diagnostics);
  }
  t.is(diagnostics.length, 1);
  t.is(diagnostics[0].source, ruleName);
}

export function hasNoDiagnostics(
  t: TsTestContext,
  diagnostics: LitDiagnostic[]
): void {
  if (diagnostics.length !== 0) {
    prettyLogDiagnostics(t, diagnostics);
  }
  t.is(diagnostics.length, 0);
}

function prettyLogDiagnostics(t: TsTestContext, diagnostics: LitDiagnostic[]) {
  t.log(
    diagnostics.map(
      (diagnostic) => `${diagnostic.source}: ${diagnostic.message}`
    )
  );
}
