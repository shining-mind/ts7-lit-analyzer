export type AnalyzerConfig = Record<string, unknown>;

export interface SourceRange {
  start: number;
  end: number;
}

export interface AnalyzerDiagnostic {
  source: string;
  message: string;
}

export interface AnalyzerCodeFixAction {
  newText: string;
}

export interface AnalyzerCodeFix {
  actions: AnalyzerCodeFixAction[];
}
