import {defineConfig} from '@vscode/test-cli';
import {tmpdir} from 'node:os';
import {join} from 'node:path';

const testDataDirectory = join(tmpdir(), `ts7-lit-vscode-${process.pid}`);

export default defineConfig({
  files: '.test-dist/test/**/*.test.js',
  version: '1.140.0',
  extensionDevelopmentPath: '.',
  workspaceFolder: 'fixtures/smoke',
  launchArgs: [
    '--disable-extensions',
    `--user-data-dir=${join(testDataDirectory, 'user')}`,
    `--extensions-dir=${join(testDataDirectory, 'extensions')}`,
  ],
  download: {
    timeout: 120000,
  },
  mocha: {
    timeout: 20000,
  },
});
