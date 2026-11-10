export default {
  input: 'src/index.ts',
  external: ['vscode'],
  output: {
    dir: 'dist',
    entryFileNames: 'index.js',
    format: 'esm',
    sourcemap: true,
    cleanDir: true,
  },
};
