import assert from 'node:assert/strict';
import {
  createRegistryView,
  type DiscoveryOperationOptions,
  type DiscoveryOptions,
  type LazyRegistrySession,
  type RegistryView,
} from '@ts7-lit-analyzer/analyzer-core';
import * as vscode from 'vscode';

import {AnalysisScheduler} from '../host/analysis-scheduler.js';
import {EditorAnalysisCoordinator} from '../host/coordinator.js';
import type {TrackedDocument} from '../host/documents.js';
import {ProjectRuntime} from '../host/project-runtime.js';
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
  const currentDirectory = fileName.slice(0, fileName.lastIndexOf('/'));
  const configFileName = `${currentDirectory}/tsconfig.json`;
  return {
    key: `configured:${configFileName}`,
    kind: 'configured',
    currentDirectory,
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
  completeAfterAbort?: boolean;
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
      return session.completeAfterAbort ? scope() : scope(options);
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

function openFakeDocument(
  coordinator: EditorAnalysisCoordinator,
  fileName: string
): TrackedDocument {
  const document: TrackedDocument = {
    uri: `file://${fileName}`,
    fileName,
    version: 1,
    text: '',
    isDirty: false,
  };
  coordinator['tracker']['open'].set(document.uri, document);
  void coordinator['opened'](document);
  return document;
}

function runtimeForFile(
  coordinator: EditorAnalysisCoordinator,
  fileName: string
) {
  const configFileName = association(fileName).configFileName;
  return [...coordinator['runtimes'].values()].find(
    (runtime) => runtime.association.configFileName === configFileName
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

  test('admits the ninth project by evicting the oldest resident', async () => {
    const sessions = new Map<string, ControlledSession>();
    const coordinator = new EditorAnalysisCoordinator({
      router,
      settings: settings(8),
      createSession(options) {
        const session = controlledSession(options.currentDirectory!);
        sessions.set(options.currentDirectory!, session);
        return Promise.resolve(session);
      },
    });
    coordinator.initialize();
    try {
      for (let index = 0; index < 8; index += 1) {
        openFakeDocument(coordinator, `/virtual/project-${index}/index.ts`);
      }
      await waitFor(
        () =>
          coordinator['runtimes'].size === 8 &&
          coordinator['runtimes']
            .values()
            .every((runtime) => runtime.view !== undefined),
        'eight accepted projects'
      );

      const ninthDocument = openFakeDocument(
        coordinator,
        '/virtual/project-8/index.ts'
      );
      await coordinator['activate'](ninthDocument);
      await waitFor(
        () =>
          runtimeForFile(coordinator, '/virtual/project-8/index.ts')?.view !==
          undefined,
        `ninth project accepted: ${JSON.stringify(coordinator.snapshot())}`
      );

      const first = runtimeForFile(coordinator, '/virtual/project-0/index.ts');
      const ninth = runtimeForFile(coordinator, '/virtual/project-8/index.ts');
      assert.equal(
        first?.resident,
        false,
        `first project eviction: ${JSON.stringify(coordinator.snapshot())}`
      );
      assert.equal(first?.session, undefined);
      assert.equal(sessions.get('/virtual/project-0')?.disposed, true);
      assert.ok(ninth?.view);
    } finally {
      await coordinator.dispose();
    }
  });

  test('save during debounce applies disk state without reintroducing an overlay', async () => {
    const appUri = fixtureUri('app', 'index.ts');
    const original = Buffer.from(
      await vscode.workspace.fs.readFile(appUri)
    ).toString();
    const session = controlledSession(appUri.fsPath);
    const coordinator = new EditorAnalysisCoordinator({
      router,
      settings: {...settings(2), debounceMs: 1000, maxWaitMs: 5000},
      createSession: () => Promise.resolve(session),
    });
    coordinator.initialize();
    try {
      const document = await vscode.workspace.openTextDocument(appUri);
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
      });
      await waitFor(
        () => runtimeForFile(coordinator, appUri.fsPath)?.view !== undefined,
        'initial view before save'
      );
      await editor.edit((edit) => {
        edit.insert(new vscode.Position(0, 0), '// pending save\n');
      });
      await waitFor(
        () => runtimeForFile(coordinator, appUri.fsPath)?.pending === true,
        'pending debounce'
      );

      await document.save();
      await coordinator.idle();
      const runtime = runtimeForFile(coordinator, appUri.fsPath)!;
      assert.equal(runtime.appliedOverlays.size, 0);
      assert.equal(runtime.stale, false);
      assert.equal(document.isDirty, false);
    } finally {
      await coordinator.dispose();
      await closeEditors();
      await restoreFile(appUri, original);
    }
  });

  test('rejects an old completion after a newer revision', async () => {
    const appUri = fixtureUri('app', 'index.ts');
    const session = controlledSession(appUri.fsPath);
    const gate = deferred<unknown>();
    const rejections: Readonly<Record<string, unknown>>[] = [];
    const coordinator = new EditorAnalysisCoordinator({
      router,
      settings: settings(2),
      logger: {
        normal() {},
        verbose() {},
        debug(event, fields = {}) {
          if (event === 'analysis.rejected') {
            rejections.push(fields);
          }
        },
        error() {},
      },
      createSession: () => Promise.resolve(session),
    });
    coordinator.initialize();
    try {
      const document = await vscode.workspace.openTextDocument(appUri);
      const editor = await vscode.window.showTextDocument(document, {
        preview: false,
      });
      await waitFor(
        () => runtimeForFile(coordinator, appUri.fsPath)?.view !== undefined,
        'initial accepted view'
      );
      session.scopeGate = gate;
      session.completeAfterAbort = true;
      await editor.edit((edit) => {
        edit.insert(new vscode.Position(0, 0), '// old revision\n');
      });
      await waitFor(() => session.activeScopeCalls === 1, 'old run in flight');
      await editor.edit((edit) => {
        edit.insert(new vscode.Position(0, 0), '// new revision\n');
      });
      gate.resolve(undefined);
      const runtime = runtimeForFile(coordinator, appUri.fsPath)!;
      await waitFor(
        () => runtime.acceptedRevision === runtime.revision,
        `latest revision accepted: ${JSON.stringify(coordinator.snapshot())}`
      );
      assert.equal(runtime.stale, false);
      const rejection = rejections.find(
        (fields) => fields.runtimeRevision !== fields.revision
      );
      assert.ok(rejection);
      assert.equal(rejection.projectKey, association(appUri.fsPath).key);
      assert.equal(typeof rejection.viewGeneration, 'number');
      assert.ok(rejection.capturedVersions);
      assert.ok(rejection.currentVersions);
    } finally {
      gate.resolve(undefined);
      await coordinator.dispose();
      await closeEditors();
      await restoreFile(
        appUri,
        Buffer.from(await vscode.workspace.fs.readFile(appUri)).toString()
      );
    }
  });

  test('evicts an in-flight project before admitting the next project', async () => {
    const appUri = fixtureUri('app', 'index.ts');
    const secondUri = fixtureUri('second', 'index.ts');
    const appSession = controlledSession(appUri.fsPath);
    const secondSession = controlledSession(secondUri.fsPath);
    const gate = deferred<unknown>();
    appSession.scopeGate = gate;
    const coordinator = new EditorAnalysisCoordinator({
      router,
      settings: settings(1),
      createSession(options) {
        return Promise.resolve(
          options.currentDirectory === fixtureUri('app').fsPath
            ? appSession
            : secondSession
        );
      },
    });
    coordinator.initialize();
    try {
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(appUri),
        {preview: false}
      );
      await waitFor(() => appSession.activeScopeCalls === 1, 'app in flight');
      assert.strictEqual(
        runtimeForFile(coordinator, appUri.fsPath)?.session,
        appSession
      );
      const secondDocument = await vscode.workspace.openTextDocument(secondUri);
      await vscode.window.showTextDocument(secondDocument, {preview: false});
      await waitFor(
        () => coordinator['tracker'].get(secondUri) !== undefined,
        'second tracked document'
      );
      await coordinator['activate'](coordinator['tracker'].get(secondUri)!);
      const evicted = runtimeForFile(coordinator, appUri.fsPath)!;
      await waitFor(
        () => evicted.controller?.signal.aborted === true,
        'in-flight project cancellation'
      );
      gate.resolve(undefined);
      await waitFor(
        () => runtimeForFile(coordinator, secondUri.fsPath)?.view !== undefined,
        `second project admitted: ${JSON.stringify(coordinator.snapshot())}`
      );

      assert.equal(evicted.resident, false);
      assert.equal(evicted.acceptedRevision, 0);
      assert.equal(appSession.disposed, true);
    } finally {
      gate.resolve(undefined);
      await coordinator.dispose();
      await closeEditors();
    }
  });

  test('does not recreate an evicted project for background updates and restores cross-project overlays on reactivation', async () => {
    const appUri = fixtureUri('app', 'index.ts');
    const secondUri = fixtureUri('second', 'index.ts');
    const original = Buffer.from(
      await vscode.workspace.fs.readFile(secondUri)
    ).toString();
    const appSessions: ControlledSession[] = [];
    const coordinator = new EditorAnalysisCoordinator({
      router,
      settings: settings(1),
      createSession(options) {
        const session = controlledSession(options.currentDirectory!);
        if (options.currentDirectory === fixtureUri('app').fsPath) {
          appSessions.push(session);
        }
        return Promise.resolve(session);
      },
    });
    coordinator.initialize();
    try {
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(appUri),
        {preview: false}
      );
      await waitFor(
        () => runtimeForFile(coordinator, appUri.fsPath)?.view !== undefined,
        'initial app view'
      );
      const secondDocument = await vscode.workspace.openTextDocument(secondUri);
      const secondEditor = await vscode.window.showTextDocument(
        secondDocument,
        {preview: false}
      );
      await waitFor(
        () => runtimeForFile(coordinator, secondUri.fsPath)?.view !== undefined,
        'second project view'
      );
      assert.equal(appSessions.length, 1);
      assert.equal(runtimeForFile(coordinator, appUri.fsPath)?.resident, false);

      await secondEditor.edit((edit) => {
        edit.insert(new vscode.Position(0, 0), '// cross-project overlay\n');
      });
      await coordinator.idle();
      assert.equal(appSessions.length, 1);
      assert.equal(
        runtimeForFile(coordinator, appUri.fsPath)?.session,
        undefined
      );

      await vscode.window.showTextDocument(appUri, {preview: false});
      await waitFor(
        () =>
          runtimeForFile(coordinator, appUri.fsPath)?.appliedOverlays.has(
            secondUri.fsPath
          ) === true,
        'cross-project overlay restored'
      );
      assert.equal(appSessions.length, 2);
      assert.equal(
        runtimeForFile(coordinator, appUri.fsPath)?.appliedOverlays.get(
          secondUri.fsPath
        ),
        secondDocument.getText()
      );
    } finally {
      await coordinator.dispose();
      await closeEditors();
      await restoreFile(secondUri, original);
    }
  });

  test('continues the mutation queue after a disposal failure', async () => {
    const appUri = fixtureUri('app', 'index.ts');
    const failing = controlledSession(appUri.fsPath);
    failing.dispose = async () => {
      throw new Error('close failed');
    };
    const replacement = controlledSession(appUri.fsPath);
    const sessions = [failing, replacement];
    const errors: string[] = [];
    const coordinator = new EditorAnalysisCoordinator({
      router,
      settings: settings(1),
      logger: {
        normal() {},
        verbose() {},
        debug() {},
        error(event) {
          errors.push(event);
        },
      },
      createSession: () => Promise.resolve(sessions.shift()!),
    });
    coordinator.initialize();
    try {
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(appUri),
        {preview: false}
      );
      await waitFor(
        () => runtimeForFile(coordinator, appUri.fsPath)?.view !== undefined,
        'initial session before disposal failure'
      );
      coordinator.updateSettings({...settings(1), collectTiming: true});
      await waitFor(
        () =>
          runtimeForFile(coordinator, appUri.fsPath)?.session === replacement &&
          runtimeForFile(coordinator, appUri.fsPath)?.view !== undefined,
        'replacement session accepted'
      );
      assert.ok(errors.includes('scheduler.mutationFailed'));
      assert.equal(replacement.disposed, false);
    } finally {
      await coordinator.dispose();
    }
  });

  test('idle returns immediately after disposal', async () => {
    const scheduler = new AnalysisScheduler({
      settings: () => settings(),
      isDisposed: () => true,
      execute: () => Promise.resolve(),
      logger: {normal() {}, verbose() {}, debug() {}, error() {}},
    });
    const runtime = new ProjectRuntime(
      association(fixtureUri('app', 'index.ts').fsPath)
    );
    runtime.pending = true;

    await scheduler.idle(new Map([['app', runtime]]));
    assert.equal(runtime.pending, true);
  });

  test('ignores an association that completes after its document closes', async () => {
    const pending = deferred<HostProjectAssociation>();
    let started = false;
    const coordinator = new EditorAnalysisCoordinator({
      router: {
        associate(_document) {
          started = true;
          return pending.promise;
        },
      },
      settings: settings(1),
    });
    coordinator.initialize();
    try {
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(fixtureUri('app', 'index.ts')),
        {preview: false}
      );
      await waitFor(() => started, 'association started');
      await closeEditors();
      pending.resolve(association(fixtureUri('app', 'index.ts').fsPath));
      await coordinator.idle();
      assert.equal(coordinator['associations'].size, 0);
      assert.equal(coordinator['runtimes'].size, 0);
    } finally {
      await coordinator.dispose();
    }
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
