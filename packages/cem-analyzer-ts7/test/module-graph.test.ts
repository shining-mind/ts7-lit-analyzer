import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';

import {
  createDiscoverySession,
  type DiscoveryOptions,
} from '../dist/session/index.js';
import type {SemanticReference} from '../src/contracts.js';
import type {DiscoverySession} from '../src/session/index.js';

const consumerFileName = '/virtual/consumer.ts';
const consumerSource = dedent`import {PublicElement} from 'package-a';
const element = new PublicElement();
element.count = 'bad';
const stringValue = 'bad';
const numberValue = 1;
`;

async function referenceAt(
  session: DiscoverySession,
  fileName: string,
  source: string,
  needle: string,
  offset = 0
): Promise<SemanticReference> {
  const position = source.indexOf(needle);
  assert.notEqual(position, -1, `missing test position: ${needle}`);
  const reference = await session.getTypeAtPosition(
    fileName,
    position + offset
  );
  assert.ok(reference, `missing type at ${needle}`);
  return reference;
}

async function expectStringNotAssignableToCount(
  session: DiscoverySession,
  fileName: string,
  source = consumerSource
): Promise<void> {
  const sourceReference = await referenceAt(
    session,
    fileName,
    source,
    "'bad'",
    1
  );
  const targetReference = await referenceAt(
    session,
    fileName,
    source,
    'element.count',
    'element.'.length
  );
  assert.equal(
    await session.isAssignable(sourceReference, targetReference),
    false
  );
}

async function withSession(
  options: DiscoveryOptions,
  run: (
    session: Awaited<ReturnType<typeof createDiscoverySession>>
  ) => Promise<void>
): Promise<void> {
  const session = await createDiscoverySession(options);
  try {
    await run(session);
  } finally {
    await session.dispose();
  }
}

function standalone(
  files: {fileName: string; text: string}[],
  symlinks?: Record<string, {target: string}>
): DiscoveryOptions {
  return {
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: [consumerFileName],
    files: [{fileName: consumerFileName, text: consumerSource}, ...files],
    compilerOptions: {
      allowJs: false,
      checkJs: true,
      maxNodeModuleJsDepth: 99,
    },
    ...(symlinks === undefined ? {} : {symlinks}),
  };
}

test('includes a direct JavaScript package with depth 0 and derived JS options', async () => {
  await withSession(
    standalone([
      {
        fileName: '/virtual/node_modules/package-a/package.json',
        text: JSON.stringify({
          name: 'package-a',
          type: 'module',
          exports: './index.js',
        }),
      },
      {
        fileName: '/virtual/node_modules/package-a/index.js',
        text: dedent`export class PublicElement {
  count = 0;
}
`,
      },
    ]),
    async (session) => {
      await expectStringNotAssignableToCount(session, consumerFileName);
    }
  );
});

test('includes relative re-export chains and resolves a renamed export', async () => {
  await withSession(
    standalone([
      {
        fileName: '/virtual/node_modules/package-a/package.json',
        text: JSON.stringify({
          name: 'package-a',
          type: 'module',
          exports: './index.js',
        }),
      },
      {
        fileName: '/virtual/node_modules/package-a/index.js',
        text: "export {InternalElement as PublicElement} from './middle.js';\n",
      },
      {
        fileName: '/virtual/node_modules/package-a/middle.js',
        text: "export {RawElement as InternalElement} from './component.js';\n",
      },
      {
        fileName: '/virtual/node_modules/package-a/component.js',
        text: dedent`
          export class RawElement extends HTMLElement {
            count = 0;
          }
          customElements.define('x-raw', RawElement);
        `,
      },
    ]),
    async (session) => {
      await expectStringNotAssignableToCount(session, consumerFileName);
      const result = await session.collect();
      const component = result.components.find(
        (candidate) => candidate.declaration.name === 'RawElement'
      );
      assert.ok(component);
      assert.equal(component.declarationEvidence.exportName, 'PublicElement');
      assert.match(component.declarationEvidence.fileName, /component\.js$/);
    }
  );
});

test('includes transitive package re-exports without scanning package roots', async () => {
  await withSession(
    standalone([
      {
        fileName: '/virtual/node_modules/package-a/package.json',
        text: JSON.stringify({
          name: 'package-a',
          type: 'module',
          exports: './index.js',
        }),
      },
      {
        fileName: '/virtual/node_modules/package-a/index.js',
        text: "export {RawElement as PublicElement} from 'package-b';\n",
      },
      {
        fileName: '/virtual/node_modules/package-b/package.json',
        text: JSON.stringify({
          name: 'package-b',
          type: 'module',
          exports: './index.js',
        }),
      },
      {
        fileName: '/virtual/node_modules/package-b/index.js',
        text: dedent`export class RawElement {
  count = 0;
}
`,
      },
      {
        fileName: '/virtual/node_modules/unreferenced/package.json',
        text: JSON.stringify({name: 'unreferenced', main: 'index.js'}),
      },
      {
        fileName: '/virtual/node_modules/unreferenced/index.js',
        text: "throw new Error('must not be loaded');\n",
      },
    ]),
    async (session) => {
      await expectStringNotAssignableToCount(session, consumerFileName);
    }
  );
});

test('resolves package main and CommonJS named exports', async () => {
  await withSession(
    standalone([
      {
        fileName: '/virtual/node_modules/package-a/package.json',
        text: JSON.stringify({name: 'package-a', main: 'main.cjs'}),
      },
      {
        fileName: '/virtual/node_modules/package-a/main.cjs',
        text: dedent`class RawElement {
  count = 0;
}
exports.PublicElement = RawElement;
`,
      },
    ]),
    async (session) => {
      await expectStringNotAssignableToCount(session, consumerFileName);
    }
  );
});

test('resolves pnpm-style symlinks to their real semantic source', async () => {
  const realPackage = '/virtual/.pnpm/package-a@1.0.0/node_modules/package-a';
  await withSession(
    standalone(
      [
        {
          fileName: `${realPackage}/package.json`,
          text: JSON.stringify({
            name: 'package-a',
            version: '1.0.0',
            type: 'module',
            exports: './index.js',
          }),
        },
        {
          fileName: `${realPackage}/index.js`,
          text: dedent`
            export class PublicElement extends HTMLElement {
              count = 0;
            }
            customElements.define('x-public', PublicElement);
          `,
        },
      ],
      {
        '/virtual/node_modules/package-a': {
          target: '../.pnpm/package-a@1.0.0/node_modules/package-a',
        },
      }
    ),
    async (session) => {
      await expectStringNotAssignableToCount(session, consumerFileName);
      const result = await session.collect();
      const component = result.components.find(
        (candidate) => candidate.declaration.name === 'PublicElement'
      );
      assert.ok(component);
      assert.equal(
        component.declarationEvidence.fileName,
        `${realPackage}/index.js`
      );
      assert.equal(
        component.declarationEvidence.package?.realPath,
        realPackage
      );
      assert.equal(component.declarationEvidence.package?.version, '1.0.0');
    }
  );
});

test('includes export-star chains', async () => {
  await withSession(
    standalone([
      {
        fileName: '/virtual/node_modules/package-a/package.json',
        text: JSON.stringify({
          name: 'package-a',
          type: 'module',
          exports: './index.js',
        }),
      },
      {
        fileName: '/virtual/node_modules/package-a/index.js',
        text: "export * from './component.js';\n",
      },
      {
        fileName: '/virtual/node_modules/package-a/component.js',
        text: dedent`
          export class PublicElement extends HTMLElement {
            count = 0;
          }
          customElements.define('x-public', PublicElement);
        `,
      },
    ]),
    async (session) => {
      await expectStringNotAssignableToCount(session, consumerFileName);
      assert.ok(
        (await session.collect()).components.some(
          (component) => component.declaration.name === 'PublicElement'
        )
      );
    }
  );
});

test('resolves a default-exported component class', async () => {
  const options = standalone([
    {
      fileName: '/virtual/node_modules/package-a/package.json',
      text: JSON.stringify({
        name: 'package-a',
        type: 'module',
        exports: './index.js',
      }),
    },
    {
      fileName: '/virtual/node_modules/package-a/index.js',
      text: dedent`
        export default class DefaultElement extends HTMLElement {
          count = 0;
        }
        customElements.define('x-default', DefaultElement);
      `,
    },
  ]);
  assert.ok(options.files);
  options.files = options.files.map((file) =>
    file.fileName === consumerFileName
      ? {
          ...file,
          text: file.text.replace(
            "import {PublicElement} from 'package-a'",
            "import PublicElement from 'package-a'"
          ),
        }
      : file
  );

  await withSession(options, async (session) => {
    await expectStringNotAssignableToCount(session, consumerFileName);
    const component = (await session.collect()).components.find(
      (candidate) => candidate.declaration.name === 'DefaultElement'
    );
    assert.ok(component);
    assert.equal(component.declarationEvidence.exportName, 'default');
    assert.equal(component.declaration.tagName, 'x-default');
  });
});

test('consumer mode derives dependency roots only from actual project imports', async () => {
  const configFileName = '/virtual/tsconfig.json';
  const unusedFileName = '/virtual/node_modules/unreferenced/index.ts';
  const unusedSource = "export const unused = 'not included';\n";
  const options: DiscoveryOptions = {
    mode: 'consumer',
    currentDirectory: '/virtual',
    configFileName,
    files: [
      {
        fileName: configFileName,
        text: JSON.stringify({
          compilerOptions: {
            allowJs: false,
            checkJs: true,
            maxNodeModuleJsDepth: 99,
            strict: true,
            target: 'esnext',
            module: 'nodenext',
            moduleResolution: 'nodenext',
            types: [],
          },
          files: ['./consumer.ts'],
        }),
      },
      {fileName: consumerFileName, text: consumerSource},
      {
        fileName: '/virtual/node_modules/package-a/package.json',
        text: JSON.stringify({name: 'package-a', main: 'index.js'}),
      },
      {
        fileName: '/virtual/node_modules/package-a/index.js',
        text: dedent`export class PublicElement {
  count = 0;
}
`,
      },
      {fileName: unusedFileName, text: unusedSource},
    ],
  };

  await withSession(options, async (session) => {
    await expectStringNotAssignableToCount(session, consumerFileName);
    const unusedPosition = unusedSource.indexOf("'not included'") + 1;
    assert.equal(
      await session.getTypeAtPosition(unusedFileName, unusedPosition),
      undefined
    );
    const result = await session.collect();
    assert.equal(result.project.configFileName, configFileName);
  });
});

test('initial overlays affect dependency semantics without exposing their text', async () => {
  const dependencyFileName = '/virtual/node_modules/package-a/index.js';
  const overlayText = dedent`export class PublicElement {
  count = 'zero';
}
`;
  const options = standalone([
    {
      fileName: '/virtual/node_modules/package-a/package.json',
      text: JSON.stringify({name: 'package-a', main: 'index.js'}),
    },
    {
      fileName: dependencyFileName,
      text: dedent`export class PublicElement {
  count = 0;
}
`,
    },
  ]);
  options.overlays = [{fileName: dependencyFileName, text: overlayText}];

  await withSession(options, async (session) => {
    const numberReference = await referenceAt(
      session,
      consumerFileName,
      consumerSource,
      '1'
    );
    const targetReference = await referenceAt(
      session,
      consumerFileName,
      consumerSource,
      'element.count',
      'element.'.length
    );
    assert.equal(
      await session.isAssignable(numberReference, targetReference),
      false
    );
    const result = await session.collect();
    assert.equal(result.containsOverlays, true);
    assert.deepEqual(result.overlayFiles, [dependencyFileName]);
    assert.equal(JSON.stringify(result).includes(overlayText), false);
  });
});
