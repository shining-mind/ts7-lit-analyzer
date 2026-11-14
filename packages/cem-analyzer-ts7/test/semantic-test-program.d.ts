import type {Program} from 'typescript/async';

export interface SemanticTestProject {
  program: Program;
  snapshotId: string;
}

export function withSemanticTestProgram(
  files: Readonly<Record<string, string>>,
  run: (project: SemanticTestProject) => Promise<void>
): Promise<void>;
