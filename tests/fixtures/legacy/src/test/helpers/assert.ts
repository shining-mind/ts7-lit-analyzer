import type {AnalyzerDiagnostic} from '@ts7-lit-analyzer/analyzer';
import type {TsTestContext} from './ts-test.ts';

export function hasDiagnostic(
  t: TsTestContext,
  diagnostics: AnalyzerDiagnostic[],
  ruleName: string
): void {
  if (diagnostics.length !== 1) {
    prettyLogDiagnostics(t, diagnostics);
  }
  t.is(diagnostics.length, 1);
  t.is(diagnostics[0].source, ruleName);
}

export function hasNoDiagnostics(
  t: TsTestContext,
  diagnostics: AnalyzerDiagnostic[]
): void {
  if (diagnostics.length !== 0) {
    prettyLogDiagnostics(t, diagnostics);
  }
  t.is(diagnostics.length, 0);
}

function prettyLogDiagnostics(
  t: TsTestContext,
  diagnostics: AnalyzerDiagnostic[]
) {
  t.log(
    diagnostics.map(
      (diagnostic) => `${diagnostic.source}: ${diagnostic.message}`
    )
  );
}
