import {API} from 'typescript/async';
import {createFileSystemWithLib} from 'typescript/fs';

export async function withSemanticTestProgram(files, run) {
  const api = new API({cwd: '/virtual'});
  try {
    const snapshot = await api.createSnapshot({
      fileSystem: createFileSystemWithLib(
        Object.entries({
          '/virtual/tsconfig.json': JSON.stringify({
            compilerOptions: {
              target: 'ESNext',
              module: 'NodeNext',
              moduleResolution: 'NodeNext',
              strict: true,
              allowJs: true,
              checkJs: false,
              skipLibCheck: true,
            },
            include: ['**/*'],
          }),
          ...files,
        })
      ),
      openProjects: ['/virtual/tsconfig.json'],
      ensurePrograms: true,
    });
    const project = snapshot.getConfiguredProject('/virtual/tsconfig.json');
    if (!project) {
      throw new Error('The semantic test project was not created');
    }
    await run({program: project.program, snapshotId: String(snapshot.id)});
  } finally {
    await api.close();
  }
}
