import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';
import {API} from 'typescript/async';
import {isClassDeclaration, type ClassDeclaration} from 'typescript/ast';
import {createFileSystemWithLib} from 'typescript/fs';

import {
  createDiscoverySession,
  type DiscoveryResult,
  type DiscoverySession,
} from '../dist/index.js';
import {BaseDocumentationCache} from '../dist/discovery/base-documentation-cache.js';
import {selectDeclaration} from '../dist/semantics/collection.js';

function component(result: DiscoveryResult, name: string) {
  const found = result.components.find(
    (candidate) => candidate.declaration.name === name
  );
  assert.ok(found, `Expected component ${name}`);
  return found;
}

function eventNames(result: DiscoveryResult, name: string): string[] {
  return (component(result, name).declaration.events ?? []).map(
    (event) => event.name
  );
}

async function withSession(
  files: Readonly<Record<string, string>>,
  run: (session: DiscoverySession, result: DiscoveryResult) => Promise<void>,
  rootFile = '/virtual/index.ts'
): Promise<void> {
  const session = await createDiscoverySession({
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: [rootFile],
    files: Object.entries(files).map(([fileName, text]) => ({fileName, text})),
  });
  try {
    await run(session, await session.collect());
  } finally {
    await session.dispose();
  }
}

const siblingFiles = {
  '/virtual/base.ts': dedent`
    /** @fires {Event} base-event - Base event. */
    export class BaseElement extends HTMLElement {}
  `,
  '/virtual/comp1.ts': dedent`
    import {BaseElement} from './base.js';
    export class Comp1 extends BaseElement {}
    customElements.define('x-comp-1', Comp1);
  `,
  '/virtual/comp2.ts': dedent`
    import {BaseElement} from './base.js';
    export class Comp2 extends BaseElement {}
    customElements.define('x-comp-2', Comp2);
  `,
  '/virtual/index.ts': "import './comp1.js';\nimport './comp2.js';\n",
};

test('siblings sharing a base inherit its events through the cache', async () => {
  await withSession(siblingFiles, async (_session, result) => {
    assert.deepEqual(eventNames(result, 'Comp1'), ['base-event']);
    assert.deepEqual(eventNames(result, 'Comp2'), ['base-event']);
  });
});

test('a base file edit propagates fresh events through cached links', async () => {
  const session = await createDiscoverySession({
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: ['/virtual/index.ts'],
    files: Object.entries(siblingFiles).map(([fileName, text]) => ({
      fileName,
      text,
    })),
  });
  try {
    const first = await session.collect();
    assert.deepEqual(eventNames(first, 'Comp1'), ['base-event']);

    const updated = await session.update([
      {
        fileName: '/virtual/base.ts',
        text: dedent`
          /**
           * @fires {Event} base-event - Base event.
           * @fires {Event} base-changed - Changed event.
           */
          export class BaseElement extends HTMLElement {}
        `,
      },
    ]);
    assert.deepEqual(eventNames(updated, 'Comp1'), [
      'base-event',
      'base-changed',
    ]);
    assert.deepEqual(eventNames(updated, 'Comp2'), [
      'base-event',
      'base-changed',
    ]);
  } finally {
    await session.dispose();
  }
});

test('an unrelated file edit retains cached base documentation', async () => {
  const session = await createDiscoverySession({
    mode: 'standalone',
    currentDirectory: '/virtual',
    rootFiles: ['/virtual/index.ts'],
    files: Object.entries(siblingFiles).map(([fileName, text]) => ({
      fileName,
      text,
    })),
  });
  try {
    await session.collect();
    const updated = await session.update([
      {
        fileName: '/virtual/comp1.ts',
        text: dedent`
          import {BaseElement} from './base.js';
          export class Comp1 extends BaseElement {
            own: number = 0;
          }
          customElements.define('x-comp-1', Comp1);
        `,
      },
    ]);
    assert.deepEqual(eventNames(updated, 'Comp1'), ['base-event']);
    assert.deepEqual(eventNames(updated, 'Comp2'), ['base-event']);
  } finally {
    await session.dispose();
  }
});

test('lazy enrichment inherits base events through the cache', async () => {
  const session = await createDiscoverySession({
    mode: 'standalone',
    eagerness: 'lazy',
    currentDirectory: '/virtual',
    rootFiles: ['/virtual/index.ts'],
    files: Object.entries(siblingFiles).map(([fileName, text]) => ({
      fileName,
      text,
    })),
  });
  try {
    const scoped = await session.collectScope(['/virtual/comp1.ts']);
    const id = component(scoped, 'Comp1').declarationEvidence.id;
    const enriched = await session.enrich([id]);
    assert.deepEqual(eventNames(enriched, 'Comp1'), ['base-event']);
  } finally {
    await session.dispose();
  }
});

test('cached inheritance keeps declaration authority for dual packages', async () => {
  await withSession(
    {
      '/virtual/consumer.ts': "export {ChildElement} from 'dep';",
      '/virtual/node_modules/dep/package.json': JSON.stringify({
        name: 'dep',
        type: 'module',
        exports: './index.js',
      }),
      '/virtual/node_modules/dep/base.d.ts':
        '/** @fires {Event} decl-event - Declaration event. */\nexport declare class BaseElement extends HTMLElement {}',
      '/virtual/node_modules/dep/base.js':
        '/** @fires {Event} impl-event - Implementation event. */\nexport class BaseElement extends HTMLElement {}',
      '/virtual/node_modules/dep/index.js': dedent`
        import {BaseElement} from './base.js';
        export class ChildElement extends BaseElement {}
        customElements.define('x-child', ChildElement);
      `,
    },
    async (_session, result) => {
      assert.deepEqual(eventNames(result, 'ChildElement'), ['decl-event']);
    },
    '/virtual/consumer.ts'
  );
});

// --- Cache-class integration: reuse, coalescing, and re-resolution ----------

interface ComponentHandle {
  declaration: ClassDeclaration;
  key: string;
}

async function withComponents(
  n: number,
  run: (project: {
    api: API;
    program: import('typescript/async').Program;
    checker: import('typescript/async').Checker;
    components: ComponentHandle[];
  }) => Promise<void>
): Promise<void> {
  const api = new API({collectTiming: true});
  try {
    const files: Record<string, string> = {
      '/virtual/shared-base.ts':
        '/** @fires {Event} base-event - Base event. */\nexport class SharedBase extends HTMLElement {}',
      '/virtual/app-base.ts':
        "import {SharedBase} from './shared-base.js';\n/** @fires {Event} app-event - App event. */\nexport class AppBase extends SharedBase {}",
    };
    const imports: string[] = [];
    for (let i = 0; i < n; i++) {
      files[`/virtual/comp${i}.ts`] =
        `import {AppBase} from './app-base.js';\nexport class Comp${i} extends AppBase {}\ncustomElements.define('x-comp-${i}', Comp${i});`;
      imports.push(`import './comp${i}.js';`);
    }
    files['/virtual/index.ts'] = imports.join('\n') + '\n';
    files['/virtual/tsconfig.json'] = JSON.stringify({
      compilerOptions: {
        target: 'esnext',
        module: 'nodenext',
        moduleResolution: 'nodenext',
        strict: true,
        skipLibCheck: true,
      },
      files: Object.keys(files).filter((f) => f.endsWith('.ts')),
    });

    const snapshot = await api.createSnapshot({
      fileSystem: createFileSystemWithLib(Object.entries(files)),
      openProjects: ['/virtual/tsconfig.json'],
      ensurePrograms: true,
    });
    const project = snapshot.getConfiguredProject('/virtual/tsconfig.json');
    assert.ok(project);
    const {program, checker} = project;

    const components: ComponentHandle[] = [];
    for (let i = 0; i < n; i++) {
      const moduleSymbol = await checker.getSymbolOfSourceFile(
        `/virtual/comp${i}.ts`
      );
      assert.ok(moduleSymbol);
      const exports = await checker.getExportsOfModule(moduleSymbol);
      const symbol = exports.find((s) => s.name === `Comp${i}`);
      assert.ok(symbol);
      const declaration = await selectDeclaration(symbol);
      assert.ok(declaration && isClassDeclaration(declaration));
      components.push({
        declaration,
        key: `/virtual/comp${i}.ts#Comp${i}`,
      });
    }
    await run({api, program, checker, components});
  } finally {
    await api.close();
  }
}

async function requestCount(api: API): Promise<number> {
  return (await api.getTimingInfo()).totals.requestCount;
}

test('warm cache walks shared bases without IPC', async () => {
  await withComponents(12, async ({api, program, checker, components}) => {
    const cache = new BaseDocumentationCache();
    const context = {program, checker, snapshotId: 'snap-a'};

    await api.resetTimingInfo();
    for (const c of components) {
      await cache.collectBaseDocumentation(c.declaration, c.key, context);
    }
    const cold = await requestCount(api);
    assert.ok(cold > 0);

    await api.resetTimingInfo();
    for (const c of components) {
      await cache.collectBaseDocumentation(c.declaration, c.key, context);
    }
    assert.equal(await requestCount(api), 0);
  });
});

test('concurrent misses coalesce below the per-component stampede bound', async () => {
  await withComponents(12, async ({api, program, checker, components}) => {
    const context = {program, checker, snapshotId: 'snap-a'};

    const single = new BaseDocumentationCache();
    await api.resetTimingInfo();
    await single.collectBaseDocumentation(
      components[0].declaration,
      components[0].key,
      context
    );
    const singleRequests = await requestCount(api);

    const cache = new BaseDocumentationCache();
    await api.resetTimingInfo();
    await Promise.all(
      components.map((c) =>
        cache.collectBaseDocumentation(c.declaration, c.key, context)
      )
    );
    const concurrent = await requestCount(api);
    assert.ok(concurrent < components.length * singleRequests);
  });
});

test('invalidate forces re-resolution of the changed base', async () => {
  await withComponents(6, async ({api, program, checker, components}) => {
    const cache = new BaseDocumentationCache();
    const context = {program, checker, snapshotId: 'snap-a'};
    for (const c of components) {
      await cache.collectBaseDocumentation(c.declaration, c.key, context);
    }

    await api.resetTimingInfo();
    await cache.collectBaseDocumentation(
      components[0].declaration,
      components[0].key,
      context
    );
    assert.equal(await requestCount(api), 0);

    cache.invalidate(['/virtual/shared-base.ts']);
    await api.resetTimingInfo();
    const fragments = await cache.collectBaseDocumentation(
      components[0].declaration,
      components[0].key,
      context
    );
    assert.ok((await requestCount(api)) > 0);
    assert.ok(
      fragments.some((f) => f.events?.some((e) => e.name === 'base-event'))
    );
  });
});

test('a miss after a snapshot change re-resolves from the live component', async () => {
  await withComponents(6, async ({api, program, checker, components}) => {
    const cache = new BaseDocumentationCache();
    const contextA = {program, checker, snapshotId: 'snap-a'};
    for (const c of components) {
      await cache.collectBaseDocumentation(c.declaration, c.key, contextA);
    }

    cache.invalidate(['/virtual/shared-base.ts']);
    const contextB = {program, checker, snapshotId: 'snap-b'};
    await api.resetTimingInfo();
    const fragments = await cache.collectBaseDocumentation(
      components[0].declaration,
      components[0].key,
      contextB
    );
    assert.ok((await requestCount(api)) > 0);
    assert.ok(
      fragments.some((f) => f.events?.some((e) => e.name === 'base-event'))
    );
  });
});

async function openBaseProject(eventName: string) {
  const api = new API();
  const files: Record<string, string> = {
    '/virtual/shared-base.ts': `/** @fires {Event} ${eventName} - Event. */\nexport class SharedBase extends HTMLElement {}`,
    '/virtual/comp.ts':
      "import {SharedBase} from './shared-base.js';\nexport class Comp extends SharedBase {}\ncustomElements.define('x-comp', Comp);",
    '/virtual/index.ts': "import './comp.js';",
    '/virtual/tsconfig.json': JSON.stringify({
      compilerOptions: {
        target: 'esnext',
        module: 'nodenext',
        moduleResolution: 'nodenext',
        strict: true,
        skipLibCheck: true,
      },
      files: [
        '/virtual/shared-base.ts',
        '/virtual/comp.ts',
        '/virtual/index.ts',
      ],
    }),
  };
  const snapshot = await api.createSnapshot({
    fileSystem: createFileSystemWithLib(Object.entries(files)),
    openProjects: ['/virtual/tsconfig.json'],
    ensurePrograms: true,
  });
  const project = snapshot.getConfiguredProject('/virtual/tsconfig.json');
  assert.ok(project);
  const moduleSymbol =
    await project.checker.getSymbolOfSourceFile('/virtual/comp.ts');
  assert.ok(moduleSymbol);
  const exports = await project.checker.getExportsOfModule(moduleSymbol);
  const symbol = exports.find((s) => s.name === 'Comp');
  assert.ok(symbol);
  const comp = await selectDeclaration(symbol);
  assert.ok(comp && isClassDeclaration(comp));
  return {api, program: project.program, checker: project.checker, comp};
}

test('a stale resolution completing after a snapshot change serves fresh data next', async () => {
  const oldProject = await openBaseProject('old-event');
  const newProject = await openBaseProject('new-event');
  try {
    const cache = new BaseDocumentationCache();
    const key = '/virtual/comp.ts#Comp';

    const staleWalk = cache.collectBaseDocumentation(oldProject.comp, key, {
      program: oldProject.program,
      checker: oldProject.checker,
      snapshotId: 'snap-a',
    });
    cache.alignSnapshot('snap-b');
    const stale = await staleWalk;
    assert.ok(stale.some((f) => f.events?.some((e) => e.name === 'old-event')));

    const fresh = await cache.collectBaseDocumentation(newProject.comp, key, {
      program: newProject.program,
      checker: newProject.checker,
      snapshotId: 'snap-b',
    });
    const names = fresh.flatMap((f) => f.events?.map((e) => e.name) ?? []);
    assert.ok(names.includes('new-event'));
    assert.ok(!names.includes('old-event'));
  } finally {
    await oldProject.api.close();
    await newProject.api.close();
  }
});
