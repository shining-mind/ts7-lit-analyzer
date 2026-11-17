// Verifies that an unreferenced installed package is not included in the
// TypeScript program, while a package reached from an out-of-scope root is.
// Mirrors the lazy session's snapshot build (scoped collection graph +
// project-wide index graph) through the real engine SnapshotFactory.
// Run from the repository root after `pnpm build`:
//   node openspec/changes/add-lazy-discovery-mode/probes/program-inclusion.mjs
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {API} from 'typescript/async';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));
const pkgDir = join(repoRoot, 'packages/cem-analyzer-ts7');
const {SessionConfiguration} = await import(
  join(pkgDir, 'dist/session/configuration.js')
);
const {SnapshotFactory} = await import(
  join(pkgDir, 'dist/session/snapshot-factory.js')
);

const files = [
  {
    fileName: '/virtual/app.ts',
    text: "import {DepElement} from './dep.js';\nexport class AppElement extends HTMLElement { label = 'x'; }\ncustomElements.define('x-app', AppElement);\ncustomElements.define('x-dep', DepElement);\n",
  },
  {
    fileName: '/virtual/dep.ts',
    text: 'export class DepElement extends HTMLElement { count = 0; }\n',
  },
  {
    fileName: '/virtual/register.ts',
    text: "import {PackageElement} from 'package-b';\ncustomElements.define('x-package', PackageElement);\n",
  },
  {
    fileName: '/virtual/node_modules/package-b/package.json',
    text: JSON.stringify({
      name: 'package-b',
      version: '1.0.0',
      type: 'module',
      exports: './index.js',
    }),
  },
  {
    fileName: '/virtual/node_modules/package-b/index.js',
    text: 'export class PackageElement extends HTMLElement { flag = true; }\n',
  },
  {
    fileName: '/virtual/node_modules/package-c/package.json',
    text: JSON.stringify({
      name: 'package-c',
      version: '1.0.0',
      type: 'module',
      exports: './index.js',
    }),
  },
  {
    fileName: '/virtual/node_modules/package-c/index.js',
    text: "export class PackageCElement extends HTMLElement { mode = 'a'; }\ncustomElements.define('x-package-c', PackageCElement);\n",
  },
];

const options = {
  mode: 'standalone',
  currentDirectory: '/virtual',
  eagerness: 'lazy',
  rootFiles: ['/virtual/app.ts', '/virtual/register.ts'],
  files,
};

const api = new API();
const configuration = new SessionConfiguration(options, '/virtual');
await configuration.read(api);
const factory = new SnapshotFactory(api, configuration, {
  id: 'probe',
  currentDirectory: '/virtual',
});

const snapshot = await factory.build({
  graphRoots: ['/virtual/app.ts'],
  indexGraphRoots: configuration.roots,
  retainProgramRoots: configuration.roots,
  overlays: new Map(),
});

const program = snapshot.project.program;
const names = await program.getSourceFileNames();
const flat = names.map((n) =>
  typeof n === 'string' ? n : (n.fileName ?? JSON.stringify(n))
);
console.log(
  'program node_modules files:',
  flat.filter((n) => n.includes('node_modules'))
);

const pkgB = await program.getSourceFile(
  '/virtual/node_modules/package-b/index.js'
);
const pkgC = await program.getSourceFile(
  '/virtual/node_modules/package-c/index.js'
);
const app = await program.getSourceFile('/virtual/app.ts');
const dep = await program.getSourceFile('/virtual/dep.ts');

console.log('app.ts in program:        ', app !== undefined);
console.log('dep.ts in program:        ', dep !== undefined);
console.log('package-b (referenced):   ', pkgB !== undefined);
console.log('package-c (unreferenced): ', pkgC !== undefined);

const pass =
  app !== undefined &&
  dep !== undefined &&
  pkgB !== undefined &&
  pkgC === undefined;
console.log(
  pass
    ? 'PASS: unreferenced package excluded from the TypeScript program'
    : 'FAIL'
);

await snapshot.snapshot.dispose();
await api.close();
process.exit(pass ? 0 : 1);
