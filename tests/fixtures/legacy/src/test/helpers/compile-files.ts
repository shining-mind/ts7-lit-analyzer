import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import {dirname, isAbsolute, join, relative} from 'node:path';
import {fileURLToPath} from 'node:url';
import tsDefaults from 'typescript';
import type {
  CompilerHost,
  CompilerOptions,
  Program,
  ScriptTarget,
  SourceFile,
} from 'typescript';
import {getCurrentTsModule, getCurrentTsModuleDirectory} from './ts-test.ts';

export interface ITestFile {
  fileName?: string;
  text: string;
  entry?: boolean;
  includeLib?: boolean;
}

export type TestFile = ITestFile | string;

const projectsDirectory = fileURLToPath(
  new URL('../../../.test-projects/', import.meta.url)
);
const processProjectsDirectory = mkdtempSync(join(projectsDirectory, 'run-'));

export function compileFiles(inputFiles: TestFile[] | TestFile = []): {
  program: Program;
  sourceFile: SourceFile;
} {
  const ts = getCurrentTsModule();
  const files: ITestFile[] = (
    Array.isArray(inputFiles) ? inputFiles : [inputFiles]
  ).map((file) =>
    typeof file === 'string'
      ? {
          text: file,
          fileName: `auto-generated-${Math.floor(Math.random() * 100000)}.ts`,
          entry: true,
        }
      : {
          ...file,
          fileName:
            file.fileName ||
            `auto-generated-${Math.floor(Math.random() * 100000)}.ts`,
        }
  );

  const projectDirectory = mkdtempSync(
    join(processProjectsDirectory, 'project-')
  );
  for (const file of files) {
    const filePath = join(projectDirectory, file.fileName!);
    mkdirSync(dirname(filePath), {recursive: true});
    writeFileSync(filePath, file.text);
  }

  const compilerOptions: CompilerOptions = {
    module: tsDefaults.ModuleKind.ESNext,
    target: tsDefaults.ScriptTarget.ESNext,
    allowJs: true,
    sourceMap: false,
    strict: true,
  };
  writeFileSync(
    join(projectDirectory, 'tsconfig.json'),
    JSON.stringify({compilerOptions}, null, 2)
  );

  const entryFile = files.find((file) => file.entry === true) || files[0];
  const resolveProjectFile = (fileName: string) =>
    existsSync(fileName) ? fileName : join(projectDirectory, fileName);
  const getProjectFileName = (fileName: string) =>
    isAbsolute(fileName) && fileName.startsWith(`${projectDirectory}/`)
      ? relative(projectDirectory, fileName)
      : fileName;
  const readFile = (fileName: string): string | undefined => {
    const projectFile = resolveProjectFile(fileName);
    if (existsSync(projectFile)) {
      return readFileSync(projectFile, 'utf8');
    }

    const libraryFile = join(getCurrentTsModuleDirectory(), fileName);
    return existsSync(libraryFile)
      ? readFileSync(libraryFile, 'utf8')
      : undefined;
  };
  const fileExists = (fileName: string): boolean => {
    const projectFile = resolveProjectFile(fileName);
    return (
      existsSync(projectFile) ||
      existsSync(join(getCurrentTsModuleDirectory(), fileName))
    );
  };

  const compilerHost: CompilerHost = {
    writeFile: () => {},
    readFile,
    fileExists,
    getSourceFile(
      fileName: string,
      languageVersion: ScriptTarget
    ): SourceFile | undefined {
      const sourceText = this.readFile(fileName);
      if (sourceText == null) return undefined;

      return ts.createSourceFile(
        getProjectFileName(fileName),
        sourceText,
        languageVersion,
        true,
        tsDefaults.ScriptKind.TS
      );
    },
    getCurrentDirectory() {
      return './';
    },
    getDirectories(directoryName: string) {
      return ts.sys.getDirectories(directoryName);
    },
    getDefaultLibFileName(options: CompilerOptions): string {
      return ts.getDefaultLibFileName(options);
    },
    getCanonicalFileName(fileName: string): string {
      return this.useCaseSensitiveFileNames()
        ? getProjectFileName(fileName)
        : getProjectFileName(fileName).toLowerCase();
    },
    getNewLine(): string {
      return ts.sys.newLine;
    },
    useCaseSensitiveFileNames() {
      return ts.sys.useCaseSensitiveFileNames;
    },
  };

  const program = ts.createProgram({
    rootNames: [
      ...files.map((file) => file.fileName!),
      join(getCurrentTsModuleDirectory(), 'lib.dom.d.ts'),
    ],
    options: compilerOptions,
    host: compilerHost,
  });

  program.isSourceFileFromExternalLibrary = (
    sourceFile: SourceFile | undefined
  ): boolean => sourceFile?.fileName.includes('node_modules') ?? false;

  const entrySourceFile =
    entryFile.fileName != null
      ? program.getSourceFile(entryFile.fileName)!
      : program.getSourceFiles()[0];

  return {
    program,
    sourceFile: entrySourceFile,
  };
}
