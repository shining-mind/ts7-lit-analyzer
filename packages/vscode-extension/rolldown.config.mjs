export default {
  input: 'src/index.ts',
  external: (id) =>
    id === 'vscode' ||
    id.startsWith('@ts7-lit-analyzer/') ||
    id === 'typescript' ||
    id.startsWith('typescript/') ||
    id.startsWith('node:'),
  output: {
    dir: 'dist',
    entryFileNames: 'index.js',
    format: 'esm',
    sourcemap: true,
    cleanDir: true,
  },
};
