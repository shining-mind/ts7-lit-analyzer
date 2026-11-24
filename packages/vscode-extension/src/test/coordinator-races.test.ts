import assert from 'node:assert/strict';
import {
  createRegistryView,
  type DiscoveryOperationOptions,
  type DiscoveryOptions,
  type LazyRegistrySession,
  type RegistryView,
} from '@ts7-lit-analyzer/analyzer-core';
import * as vscode from 'vscode';

import {EditorAnalysisCoordinator} from '../host/coordinator.js';
import type {
  HostProjectAssociation,
  ProjectRouter,
} from '../host/project-router.js';

interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return {promise, resolve};
}

function fixtureUri(folder: string, ...segments: string[]): vscode.Uri {
  const workspaceFolder = vscode.workspace.workspaceFolders?.find(
    (candidate) => candidate.name === folder
  );
  assert.ok(workspaceFolder, `Missing workspace folder ${folder}`);
  return vscode.Uri.joinPath(workspaceFolder.uri, ...segments);
}

function association(fileName: string): HostProjectAssociation {
  const configFileName = fileName.includes('/second/')
    ? fixtureUri('second', 'tsconfig.json').fsPath
    : fixtureUri('app', 'tsconfig.json').fsPath;
  return {
    key: `configured:${configFileName}`,
    kind: 'configured',
    currentDirectory: fileName.includes('/second/')
      ? fixtureUri('second').fsPath
      : fixtureUri('app').fsPath,
    configFileName,
  };
}

const router: ProjectRouter = {
  async associate(document) {
    return association(document.fileName);
  },
};

function view(
  fileName: string,
  generation: number,
  overlays: readonly {fileName: string; text: string}[] = []
): RegistryView {
  const project = {
    id: fileName,
    currentDirectory: fileName.includes('/second/')
      ? fixtureUri('second').fsPath
      : fixtureUri('app').fsPath,
    configFileName: association(fileName).configFileName!,
  };
  return createRegistryView({
    project,
    snapshotId: `snapshot-${generation}`,
    generation,
    components: [],
    issues: [],
    containsOverlays: overlays.length > 0,
    overlayFiles: overlays.map((overlay) => overlay.fileName).sort(),
  });
}

interface ControlledSession extends LazyRegistrySession {
  disposed: boolean;
  scopeCalls: number;
  activeScopeCalls: number;
  scopeGate?: Deferred<unknown>;
  failNextScope?: Error;
}

function controlledSession(fileName: string): ControlledSession {
  let generation = 0;
  let current = view(fileName, generation);
  const scope = (options?: DiscoveryOperationOptions) => {
    options?.signal?.throwIfAborted();
    current = view(fileName, ++generation);
    return current;
  };
  const session: ControlledSession = {
    disposed: false,
    scopeCalls: 0,
    activeScopeCalls: 0,
    async collect() {
      return current;
    },
    async update(overlays, options) {
      options?.signal?.throwIfAborted();
      current = createRegistryView({
        project: current.project,
        snapshotId: `snapshot-${++generation}`,
        generation,
        components: [],
        issues: [],
        containsOverlays: overlays.length > 0,
        overlayFiles: overlays.map((overlay) => overlay.fileName).sort(),
      });
      return current;
    },
    async removeOverlays(_fileNames, options) {
      options?.signal?.throwIfAborted();
      current = view(fileName, ++generation);
      return current;
    },
    async collectScope(_files, options) {
      session.scopeCalls += 1;
      session.activeScopeCalls += 1;
      if (session.scopeGate) {
        await session.scopeGate.promise;
      }
      session.activeScopeCalls -= 1;
      if (session.failNextScope) {
        throw session.failNextScope;
      }
      return scope(options);
    },
    async enrich(_ids, options) {
      return scope(options);
    },
    async materializeTypes(options) {
      return scope(options);
    },
    async memberType() {
      return undefined;
    },
    async isAssignable() {
      return false;
    },
    async isAssignableToMember() {
      return false;
    },
    async getTimingInfo() {
      return {
        enabled: false,
        totals: {
          requestCount: 0,
          roundTripMs: 0,
          bytesSent: 0,
          bytesReceived: 0,
          serverTimeMs: 0,
          transportOverheadMs: 0,
          nodesMaterialized: 0,
          sourceFilesFetched: 0,
          nodesFetched: 0,
        },
        recentRequests: [],
      };
    },
    async resetTimingInfo() {},
    current() {
      return current;
    },
    async dispose() {
      session.disposed = true;
    },
  };
  return session;
}

function settings(maxResidentProjects = 1) {
  return {
    trigger: 'onType' as const,
    debounceMs: 20,
    maxWaitMs: 40,
    maxResidentProjects,
    collectTiming: false,
  };
}

async function waitFor(
  condition: () => boolean,
  description: string
): Promise<void> {
  const deadline = Date.now() + 3000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

async function closeEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

async function restoreFile(uri: vscode.Uri, original: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(original));
  const document = await vscode.workspace.openTextDocument(uri);
  await waitFor(
    () => document.getText() === original && !document.isDirty,
    `restore ${uri.toString(true)}`
  );
}

suite('Coordinator deferred races', () => {
  test('disposes superseded session creation before admitting the next project', async () => {
    const appSession = deferred<ControlledSession>();
    const second = controlledSession(fixtureUri('second', 'index.ts').fsPath);
    let appCreated = false;
    const coordinator = new EditorAnalysisCoordinator({
      router,
      settings: settings(),
      createSession(options: DiscoveryOptions & {eagerness: 'lazy'}) {
        if (options.currentDirectory === fixtureUri('app').fsPath) {
          appCreated = true;
          return appSession.promise;
        }
        return Promise.resolve(second);
      },
    });
    coordinator.initialize();
    try {
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(fixtureUri('app', 'index.ts')),
        {preview: false}
      );
      await waitFor(() => appCreated, 'app session creation');
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(
          fixtureUri('second', 'index.ts')
        ),
        {preview: false}
      );
      appSession.resolve(
        controlledSession(fixtureUri('app', 'index.ts').fsPath)
      );
      await waitFor(
        () =>
          [...coordinator['runtimes'].values()].find(
            (runtime) =>
              runtime.association.configFileName ===
              fixtureUri('second', 'tsconfig.json').fsPath
          )?.view !== undefined,
        `second project admission: ${JSON.stringify(coordinator.snapshot())}`
      );
      const app = await appSession.promise;
      assert.equal(app.disposed, true);
      assert.equal(second.disposed, false);
    } finally {
      await coordinator.dispose();
      await closeEditors();
    }
  });

  test('keeps the last good view stale when the current operation fails', async () => {
    const appUri = fixtureUri('app', 'index.ts');
    const original = Buffer.from(
      await vscode.workspace.fs.readFile(appUri)
    ).toString();
    const session = controlledSession(appUri.fsPath);
    const coordinator = new EditorAnalysisCoordinator({
      router,
      settings: settings(2),
      createSession: () => Promise.resolve(session),
    });
    coordinator.initialize();
    try {
      const document = await vscode.workspace.openTextDocument(appUri);
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
      });
      await waitFor(
        () => [...coordinator['runtimes'].values()][0]?.view !== undefined,
        `initial good view: ${JSON.stringify(coordinator.snapshot())}`
      );
      const accepted = [...coordinator['runtimes'].values()][0].view;
      session.failNextScope = new Error('current failure');
      await editor.edit((edit) => {
        edit.insert(new vscode.Position(0, 0), '// failure\n');
      });
      await waitFor(
        () =>
          [...coordinator['runtimes'].values()][0].error === 'current failure',
        'current failure state'
      );
      const runtime = [...coordinator['runtimes'].values()][0];
      assert.strictEqual(runtime.view, accepted);
      assert.equal(runtime.stale, true);
    } finally {
      await coordinator.dispose();
      await closeEditors();
      await restoreFile(appUri, original);
    }
  });

  test('deactivation disposes pending creation and prevents publication', async () => {
    const created = deferred<ControlledSession>();
    const coordinator = new EditorAnalysisCoordinator({
      router,
      settings: settings(2),
      createSession: () => created.promise,
    });
    coordinator.initialize();
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(fixtureUri('app', 'index.ts')),
      {preview: false}
    );
    const disposing = coordinator.dispose();
    created.resolve(controlledSession(fixtureUri('app', 'index.ts').fsPath));
    await disposing;
    const session = await created.promise;
    assert.equal(session.disposed, true);
    assert.equal(
      [...coordinator['runtimes'].values()].every(
        (runtime) => runtime.session === undefined && runtime.view === undefined
      ),
      true
    );
    await closeEditors();
  });

  test('maxWait queues one latest successor without concurrent scope mutations', async () => {
    const session = controlledSession(fixtureUri('app', 'index.ts').fsPath);
    const gate = deferred<unknown>();
    const successorGate = deferred<unknown>();
    session.scopeGate = gate;
    const coordinator = new EditorAnalysisCoordinator({
      router,
      settings: settings(2),
      createSession: () => Promise.resolve(session),
    });
    coordinator.initialize();
    try {
      const document = await vscode.workspace.openTextDocument(
        fixtureUri('app', 'index.ts')
      );
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
      });
      await waitFor(() => session.scopeCalls === 1, 'first unsettled scope');
      gate.resolve(undefined);
      await coordinator.idle();
      session.scopeCalls = 0;
      session.scopeGate = successorGate;
      await editor.edit((edit) => {
        edit.insert(new vscode.Position(0, 0), '// first\n');
      });
      await waitFor(
        () => session.activeScopeCalls === 1,
        'first change scope is unsettled'
      );
      await editor.edit((edit) => {
        edit.insert(new vscode.Position(0, 0), '// second\n');
      });
      await waitFor(
        () =>
          coordinator.snapshot().executing && session.activeScopeCalls === 1,
        'maxWait while first scope is unsettled'
      );
      successorGate.resolve(undefined);
      await waitFor(() => session.scopeCalls === 2, 'latest successor scope');
      assert.equal(session.activeScopeCalls, 0);
      assert.ok(session.current()!.generation > 0);
    } finally {
      gate.resolve(undefined);
      successorGate.resolve(undefined);
      await coordinator.dispose();
      await closeEditors();
    }
  });
});
