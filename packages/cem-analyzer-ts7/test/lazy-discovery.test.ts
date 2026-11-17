import assert from 'node:assert/strict';
import {test} from 'node:test';

import dedent from 'ts-dedent';
import type {Snapshot} from 'typescript/async';

import {
  AnalysisCapability,
  type DiscoveryResult,
  type WebComponentRecord,
} from '../dist/contracts.js';
import {SnapshotRetention} from '../dist/session/snapshot-retention.js';
import {
  createDiscoverySession,
  type DiscoveryOptions,
  type LazyDiscoverySession,
} from '../dist/session/index.js';

const appFile = '/virtual/app.ts';
const depFile = '/virtual/dep.ts';
const registerFile = '/virtual/register.ts';
const orphanFile = '/virtual/orphan.ts';
const secondFile = '/virtual/second.ts';
const baseFile = '/virtual/base.ts';
const childFile = '/virtual/child.ts';

const appSource = dedent`
  import {DepElement} from './dep.js';
  export class AppElement extends HTMLElement {
    label = 'x';
  }
  customElements.define('x-app', AppElement);
`;
const depSource = dedent`
  export class DepElement extends HTMLElement {
    count = 0;
    increment(step: number): number {
      return this.count + step;
    }
  }
  customElements.define('x-dep', DepElement);
`;
const orphanSource = dedent`
  export class OrphanElement extends HTMLElement {
    value = 'v';
  }
`;
const registerSource = dedent`
  import {OrphanElement} from './orphan.js';
  import {PackageElement} from 'package-b';
  customElements.define('x-orphan', OrphanElement);
  customElements.define('x-package', PackageElement);
`;
const secondSource = "import {GhostElement} from './ghost.js';\n";
const baseSource = dedent`
  export class BaseElement extends HTMLElement {
    shared = 0;
  }
`;
const childSource = dedent`
  import {BaseElement} from './base.js';
  export class ChildElement extends BaseElement {
    own = 'x';
  }
  customElements.define('x-child', ChildElement);
`;

function lazyOptions(
  overrides?: Partial<DiscoveryOptions>
): DiscoveryOptions & {eagerness: 'lazy'} {
  return {
    mode: 'standalone',
    currentDirectory: '/virtual',
    eagerness: 'lazy',
    rootFiles: [appFile, depFile, registerFile, orphanFile, secondFile],
    files: [
      {fileName: appFile, text: appSource},
      {fileName: depFile, text: depSource},
      {fileName: registerFile, text: registerSource},
      {fileName: orphanFile, text: orphanSource},
      {fileName: secondFile, text: secondSource},
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
        text: dedent`
          export class PackageElement extends HTMLElement {
            flag = true;
          }
        `,
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
        text: dedent`
          export class PackageCElement extends HTMLElement {
            mode = 'a';
          }
          customElements.define('x-package-c', PackageCElement);
        `,
      },
    ],
    ...overrides,
  } as DiscoveryOptions & {eagerness: 'lazy'};
}

async function withLazySession(
  options: DiscoveryOptions & {eagerness: 'lazy'},
  run: (session: LazyDiscoverySession) => Promise<void>
): Promise<void> {
  const session = await createDiscoverySession(options);
  try {
    await run(session);
  } finally {
    await session.dispose();
  }
}

function componentNamed(
  result: DiscoveryResult,
  name: string
): WebComponentRecord {
  const component = result.components.find(
    (candidate) => candidate.declaration.name === name
  );
  assert.ok(component, `Expected component ${name}`);
  return component;
}

function assertNotCollected(component: WebComponentRecord): void {
  assert.equal(component.analysis.complete, AnalysisCapability.registration);
  assert.equal(component.analysis.incomplete, 0);
  assert.deepEqual(component.members, []);
  assert.deepEqual(component.declaration.members, []);
}

test('performs no registry work before the first scoped request', async () => {
  await withLazySession(lazyOptions(), async (session) => {
    const empty = await session.collect();
    assert.deepEqual(empty.components, []);
    assert.equal(empty.snapshotId, '');
    assert.equal(empty.generation, 1);
    assert.equal(empty.containsOverlays, false);
    await assert.rejects(session.getTypeAtPosition(appFile, 0), /scope/i);

    const updated = await session.update([]);
    assert.deepEqual(updated.components, []);
    assert.ok(updated.generation > empty.generation);

    const scoped = await session.collectScope([appFile]);
    assert.ok(scoped.components.length > 0);
    assert.ok(scoped.snapshotId.length > 0);
    assert.equal(await session.collect(), scoped);
  });
});

test('discovers reached dependencies and excludes unreferenced packages', async () => {
  await withLazySession(lazyOptions(), async (session) => {
    const result = await session.collectScope([appFile]);
    const dep = componentNamed(result, 'DepElement');
    assert.equal(dep.declarationEvidence.fileName, depFile);
    assert.equal(dep.declaration.tagName, 'x-dep');
    componentNamed(result, 'AppElement');
    componentNamed(result, 'OrphanElement');
    componentNamed(result, 'PackageElement');
    assert.equal(
      result.components.some(
        (candidate) => candidate.declaration.name === 'PackageCElement'
      ),
      false
    );
  });
});

test('indexes dependencies referenced only from out-of-scope roots', async () => {
  await withLazySession(lazyOptions(), async (session) => {
    const result = await session.collectScope([appFile]);
    const pkg = componentNamed(result, 'PackageElement');
    assert.equal(pkg.declaration.tagName, 'x-package');
    assert.match(pkg.declarationEvidence.fileName, /package-b\/index\.js$/);
    assert.equal(pkg.declarationEvidence.package?.name, 'package-b');
    assertNotCollected(pkg);

    const enriched = await session.enrich([pkg.declarationEvidence.id]);
    const enrichedPkg = componentNamed(enriched, 'PackageElement');
    assert.ok(enrichedPkg.analysis.complete & AnalysisCapability.semantics);
    const query = await session.getMemberType(
      pkg.declarationEvidence.id,
      'flag'
    );
    assert.equal(query?.text, 'boolean');
  });
});

test('empty scope stays uninitialized', async () => {
  await withLazySession(lazyOptions(), async (session) => {
    const empty = await session.collectScope([]);
    assert.deepEqual(empty.components, []);
    assert.equal(empty.snapshotId, '');
    await assert.rejects(session.getTypeAtPosition(appFile, 0), /scope/i);

    const scoped = await session.collectScope([appFile]);
    assert.ok(scoped.components.length > 0);
    assert.ok(scoped.snapshotId.length > 0);
  });
});

test('indexed entries report not-collected semantics until enrichment', async () => {
  await withLazySession(lazyOptions(), async (session) => {
    const result = await session.collectScope([appFile]);
    for (const component of result.components) {
      assertNotCollected(component);
    }
  });
});

test('enriches one component on request and leaves others not-collected', async () => {
  await withLazySession(lazyOptions(), async (session) => {
    const initial = await session.collectScope([appFile]);
    const depId = componentNamed(initial, 'DepElement').declarationEvidence.id;
    const appBefore = componentNamed(initial, 'AppElement');

    const result = await session.enrich([depId]);
    const dep = componentNamed(result, 'DepElement');
    assert.ok(
      dep.analysis.complete & AnalysisCapability.semantics,
      'enriched semantics must be complete'
    );
    const count = dep.declaration.members?.find(
      (member) => member.name === 'count'
    );
    assert.ok(count?.kind === 'field');
    assert.equal(count.type, undefined);
    const semantics = dep.members.find(
      (member) => member.memberName === 'count'
    );
    assert.ok(semantics);
    assert.equal(semantics.type, undefined);
    assertNotCollected(componentNamed(result, 'AppElement'));
    assert.equal(componentNamed(result, 'AppElement'), appBefore);
    assert.equal(
      await session.getMemberType(appBefore.declarationEvidence.id, 'label'),
      undefined
    );
  });
});

test('resolves member types on demand from the current snapshot', async () => {
  await withLazySession(lazyOptions(), async (session) => {
    const initial = await session.collectScope([appFile]);
    const depId = componentNamed(initial, 'DepElement').declarationEvidence.id;
    const orphanId = componentNamed(initial, 'OrphanElement')
      .declarationEvidence.id;
    await session.enrich([depId, orphanId]);
    const beforeDep = await session.getMemberType(depId, 'count');
    const beforeOrphan = await session.getMemberType(orphanId, 'value');
    assert.ok(beforeDep);
    assert.ok(beforeOrphan);
    assert.equal(beforeDep.text, 'number');
    assert.equal(beforeDep.reference.snapshotId, initial.snapshotId);

    const updated = await session.update([
      {
        fileName: depFile,
        text: depSource.replace('count = 0', "count = 'zero'"),
      },
    ]);
    assertNotCollected(componentNamed(updated, 'DepElement'));
    await session.enrich([depId]);
    const afterDep = await session.getMemberType(depId, 'count');
    assert.ok(afterDep);
    assert.equal(afterDep.text, 'string');
    assert.notEqual(
      afterDep.reference.snapshotId,
      beforeDep.reference.snapshotId
    );
    await assert.rejects(
      session.isAssignable(beforeDep.reference, afterDep.reference),
      /project|snapshot/i
    );

    const afterOrphan = await session.getMemberType(orphanId, 'value');
    assert.ok(afterOrphan);
    assert.equal(
      await session.isAssignable(beforeOrphan.reference, afterOrphan.reference),
      true
    );
  });
});

test('rejects semantic references from another project', async () => {
  await withLazySession(lazyOptions(), async (first) => {
    await withLazySession(lazyOptions(), async (second) => {
      const firstResult = await first.collectScope([appFile]);
      const secondResult = await second.collectScope([appFile]);
      const firstId = componentNamed(firstResult, 'DepElement')
        .declarationEvidence.id;
      const secondId = componentNamed(secondResult, 'DepElement')
        .declarationEvidence.id;
      await first.enrich([firstId]);
      await second.enrich([secondId]);
      const firstQuery = await first.getMemberType(firstId, 'count');
      const secondQuery = await second.getMemberType(secondId, 'count');
      assert.ok(firstQuery);
      assert.ok(secondQuery);
      await assert.rejects(
        first.isAssignable(firstQuery.reference, secondQuery.reference),
        /project|snapshot/i
      );
    });
  });
});

test('materializes type text at serialization time', async () => {
  await withLazySession(lazyOptions(), async (session) => {
    const initial = await session.collectScope([appFile]);
    const depId = componentNamed(initial, 'DepElement').declarationEvidence.id;
    const enriched = await session.enrich([depId]);
    const before = componentNamed(enriched, 'DepElement');
    const method = before.declaration.members?.find(
      (member) => member.name === 'increment'
    );
    assert.ok(method?.kind === 'method');
    assert.equal(method.return, undefined);

    const result = await session.materializeTypes();
    const dep = componentNamed(result, 'DepElement');
    const count = dep.declaration.members?.find(
      (member) => member.name === 'count'
    );
    assert.ok(count?.kind === 'field');
    assert.equal(count.type?.text, 'number');
    const materializedMethod = dep.declaration.members?.find(
      (member) => member.name === 'increment'
    );
    assert.ok(materializedMethod?.kind === 'method');
    assert.equal(materializedMethod.return?.type?.text, 'number');
    assert.equal(materializedMethod.parameters?.[0]?.type?.text, 'number');
    assertNotCollected(componentNamed(result, 'AppElement'));
  });
});

test('extends scope with newly reached components and reuses records', async () => {
  await withLazySession(lazyOptions(), async (session) => {
    const initial = await session.collectScope([appFile]);
    const depId = componentNamed(initial, 'DepElement').declarationEvidence.id;
    const enriched = await session.enrich([depId]);
    const depBefore = componentNamed(enriched, 'DepElement');
    const appBefore = componentNamed(enriched, 'AppElement');

    assert.deepEqual(initial.issues, []);
    const extended = await session.collectScope([secondFile]);
    assert.ok(extended.generation > enriched.generation);
    assert.ok(
      extended.issues.some(
        (issue) =>
          issue.code === 'unresolved-module' && issue.fileName === secondFile
      )
    );
    assert.equal(componentNamed(extended, 'DepElement'), depBefore);
    assert.equal(componentNamed(extended, 'AppElement'), appBefore);
  });
});

test('refreshes the registration index on overlays', async () => {
  await withLazySession(lazyOptions(), async (session) => {
    const initial = await session.collectScope([appFile]);
    componentNamed(initial, 'OrphanElement');

    const added = await session.update([
      {
        fileName: registerFile,
        text:
          registerSource +
          '\n' +
          dedent`
            export class ExtraElement extends HTMLElement {}
            customElements.define('x-extra', ExtraElement);
          `,
      },
    ]);
    componentNamed(added, 'ExtraElement');
    componentNamed(added, 'OrphanElement');

    const removed = await session.update([
      {
        fileName: registerFile,
        text: dedent`
          export class ExtraElement extends HTMLElement {}
          customElements.define('x-extra', ExtraElement);
        `,
      },
    ]);
    assert.equal(
      removed.components.some(
        (candidate) => candidate.declaration.name === 'OrphanElement'
      ),
      false
    );
    componentNamed(removed, 'ExtraElement');
  });
});

test('scoped updates invalidate affected records and reuse unaffected ones', async () => {
  await withLazySession(lazyOptions(), async (session) => {
    const initial = await session.collectScope([appFile]);
    const ids = initial.components.map(
      (component) => component.declarationEvidence.id
    );
    const enriched = await session.enrich(ids);
    const orphanBefore = componentNamed(enriched, 'OrphanElement');

    const updated = await session.update([
      {
        fileName: depFile,
        text: depSource.replace('count = 0', "count = 'zero'"),
      },
    ]);
    assertNotCollected(componentNamed(updated, 'DepElement'));
    assertNotCollected(componentNamed(updated, 'AppElement'));
    assert.equal(componentNamed(updated, 'OrphanElement'), orphanBefore);
  });
});

test('out-of-scope base-class overlay invalidates the dependent component', async () => {
  const options = lazyOptions({
    rootFiles: [
      appFile,
      depFile,
      registerFile,
      orphanFile,
      secondFile,
      baseFile,
      childFile,
    ],
    files: [
      ...(lazyOptions().files ?? []),
      {fileName: baseFile, text: baseSource},
      {fileName: childFile, text: childSource},
    ],
  });
  await withLazySession(options, async (session) => {
    const initial = await session.collectScope([childFile, appFile]);
    const childId = componentNamed(initial, 'ChildElement').declarationEvidence
      .id;
    const enriched = await session.enrich([
      childId,
      componentNamed(initial, 'AppElement').declarationEvidence.id,
    ]);
    const appBefore = componentNamed(enriched, 'AppElement');
    const shared = await session.getMemberType(childId, 'shared');
    assert.equal(shared?.text, 'number');

    const updated = await session.update([
      {
        fileName: baseFile,
        text: baseSource.replace('shared = 0', "shared = 's'"),
      },
    ]);
    assertNotCollected(componentNamed(updated, 'ChildElement'));
    assert.equal(componentNamed(updated, 'AppElement'), appBefore);
    await session.enrich([childId]);
    const after = await session.getMemberType(childId, 'shared');
    assert.equal(after?.text, 'string');
  });
});

test('generations increase across successive updates in both modes', async () => {
  const eager = await createDiscoverySession({
    ...lazyOptions(),
    eagerness: 'eager',
  });
  try {
    const first = await eager.collect();
    const second = await eager.update([]);
    const third = await eager.update([]);
    assert.equal(first.generation, 1);
    assert.ok(second.generation > first.generation);
    assert.ok(third.generation > second.generation);
  } finally {
    await eager.dispose();
  }

  await withLazySession(lazyOptions(), async (session) => {
    const first = await session.collectScope([appFile]);
    const second = await session.update([]);
    const third = await session.update([]);
    assert.ok(second.generation > first.generation);
    assert.ok(third.generation > second.generation);
  });
});

test('retention bound evicts and disposes the oldest snapshots', async () => {
  const disposed: number[] = [];
  const stubSnapshot = (id: number): Snapshot =>
    ({
      dispose: async () => {
        disposed.push(id);
      },
    }) as unknown as Snapshot;

  const bounded = new SnapshotRetention(2);
  for (let id = 1; id <= 5; id++) {
    await bounded.retain(stubSnapshot(id));
  }
  assert.deepEqual(disposed, [1, 2, 3]);
  await bounded.disposeAll();
  assert.deepEqual(disposed, [1, 2, 3, 4, 5]);

  const zero = new SnapshotRetention(0);
  await zero.retain(stubSnapshot(6));
  assert.deepEqual(disposed, [1, 2, 3, 4, 5, 6]);

  const unbounded = new SnapshotRetention();
  await unbounded.retain(stubSnapshot(7));
  await unbounded.retain(stubSnapshot(8));
  assert.deepEqual(disposed, [1, 2, 3, 4, 5, 6]);
  await unbounded.disposeAll();
  assert.deepEqual(disposed, [1, 2, 3, 4, 5, 6, 7, 8]);
});

test('bounded lazy sessions keep reused-record queries valid and dispose cleanly', async (t) => {
  const session = await createDiscoverySession(
    lazyOptions({retentionBound: 1})
  );
  t.after(() => session.dispose());
  const initial = await session.collectScope([appFile]);
  const depId = componentNamed(initial, 'DepElement').declarationEvidence.id;
  const orphanId = componentNamed(initial, 'OrphanElement').declarationEvidence
    .id;
  await session.enrich([depId, orphanId]);
  const beforeDep = await session.getMemberType(depId, 'count');
  const beforeOrphan = await session.getMemberType(orphanId, 'value');
  assert.ok(beforeDep);
  assert.ok(beforeOrphan);
  for (let index = 0; index < 3; index++) {
    await session.update([
      {
        fileName: depFile,
        text: depSource.replace('count = 0', `count = ${index}`),
      },
    ]);
    await session.enrich([depId]);
  }
  const afterDep = await session.getMemberType(depId, 'count');
  const afterOrphan = await session.getMemberType(orphanId, 'value');
  assert.ok(afterDep);
  assert.ok(afterOrphan);
  await assert.rejects(
    session.isAssignable(beforeDep.reference, afterDep.reference),
    /project|snapshot/i
  );
  assert.equal(
    await session.isAssignable(beforeOrphan.reference, afterOrphan.reference),
    true
  );
  await session.dispose();
  await session.dispose();
  await assert.rejects(session.collect(), /disposed/i);
});

test('eager sessions reject lazy-only operations', async () => {
  const session = await createDiscoverySession({
    ...lazyOptions(),
    eagerness: 'eager',
  });
  try {
    const lazy = session as unknown as LazyDiscoverySession;
    await assert.rejects(lazy.collectScope([appFile]), /lazy/i);
    await assert.rejects(lazy.enrich([]), /lazy/i);
    await assert.rejects(lazy.materializeTypes(), /lazy/i);
  } finally {
    await session.dispose();
  }
});

test('rejects invalid retention bounds', async () => {
  await assert.rejects(
    createDiscoverySession(lazyOptions({retentionBound: -1})),
    /retentionBound/i
  );
  await assert.rejects(
    createDiscoverySession(lazyOptions({retentionBound: 1.5})),
    /retentionBound/i
  );
});
