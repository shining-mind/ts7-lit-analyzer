import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {test} from 'node:test';
import {dirname} from 'node:path';
import type * as tsModule from 'typescript';
import {setTypescriptModule} from 'lit-analyzer/lib/analyze/ts-module.js';

const require = createRequire(import.meta.url);
const ts = require('typescript') as typeof tsModule;

export interface TsTestContext {
  is(actual: unknown, expected: unknown, message?: string): void;
  deepEqual(actual: unknown, expected: unknown, message?: string): void;
  true(value: unknown, message?: string): void;
  log(...values: unknown[]): void;
}

type TsTestImplementation = (t: TsTestContext) => void;
type TestFunction = (
  title: string,
  implementation: TsTestImplementation
) => void;

export function getCurrentTsModule(): typeof tsModule {
  return ts;
}

export function getCurrentTsModuleDirectory(): string {
  return dirname(require.resolve('typescript'));
}

function setupTest(
  testFunction: TestFunction,
  title: string,
  cb: TsTestImplementation
): void {
  testFunction(`[ts${ts.version}] ${title}`, () => {
    setTypescriptModule(ts);

    const t: TsTestContext = {
      is: (actual, expected, message) => {
        if (message == null) assert.strictEqual(actual, expected);
        else assert.strictEqual(actual, expected, message);
      },
      deepEqual: (actual, expected, message) => {
        if (message == null) assert.deepStrictEqual(actual, expected);
        else assert.deepStrictEqual(actual, expected, message);
      },
      true: (value, message) => {
        if (message == null) assert.ok(value);
        else assert.ok(value, message);
      },
      log: (...values) => console.log(...values),
    };

    cb(t);
  });
}

function wrapNodeTest(testFunction: TestFunction): TestFunction {
  return (title, implementation) =>
    setupTest(testFunction, title, implementation);
}

const nodeTest = test as unknown as TestFunction;

export const tsTest = Object.assign(wrapNodeTest(nodeTest), {
  only: wrapNodeTest(test.only as unknown as TestFunction),
  skip: wrapNodeTest(test.skip as unknown as TestFunction),
});
