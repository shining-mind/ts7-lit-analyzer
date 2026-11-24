import assert from 'node:assert/strict';
import * as vscode from 'vscode';

import {DocumentTracker, type TrackedDocument} from '../host/documents.js';
import {SpawnedProjectRouter} from '../host/project-router.js';

function fixtureUri(folder: string, ...segments: string[]): vscode.Uri {
  const workspaceFolder = vscode.workspace.workspaceFolders?.find(
    (candidate) => candidate.name === folder
  );
  assert.ok(workspaceFolder, `Missing workspace folder ${folder}`);
  return vscode.Uri.joinPath(workspaceFolder.uri, ...segments);
}

async function waitFor(
  condition: () => boolean,
  description: string
): Promise<void> {
  const deadline = Date.now() + 5000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function closeEditor(): Promise<void> {
  const tabs = vscode.window.tabGroups.all.flatMap((group) => group.tabs);
  if (tabs.length > 0) {
    await vscode.window.tabGroups.close(tabs);
  }
}

async function restoreFile(uri: vscode.Uri, original: string): Promise<void> {
  await vscode.workspace.fs.writeFile(uri, Buffer.from(original));
  const document = await vscode.workspace.openTextDocument(uri);
  await waitFor(
    () => document.getText() === original && !document.isDirty,
    `restore ${uri.toString(true)}`
  );
}

function visibleTabs(uri: vscode.Uri): vscode.Tab[] {
  const key = uri.toString(true);
  return vscode.window.tabGroups.all
    .flatMap((group) => group.tabs)
    .filter(
      (tab) =>
        tab.input instanceof vscode.TabInputText &&
        tab.input.uri.toString(true) === key
    );
}

function lifecycleTracker(events: string[]): DocumentTracker {
  return new DocumentTracker({
    opened(document) {
      events.push(`opened:${document.uri}`);
    },
    changed() {},
    saved() {},
    closed(document) {
      events.push(`closed:${document.uri}`);
    },
  });
}

suite('Editor document tracking and routing', () => {
  test('tracks open, dirty, save, and close with URI versions', async () => {
    const uri = fixtureUri('app', 'index.ts');
    const original = Buffer.from(
      await vscode.workspace.fs.readFile(uri)
    ).toString();
    const events: string[] = [];
    let latest: TrackedDocument | undefined;
    const tracker = new DocumentTracker({
      opened(document) {
        events.push(`opened:${document.uri}`);
        latest = document;
      },
      changed(document) {
        events.push(`changed:${document.version}:${document.isDirty}`);
        latest = document;
      },
      saved(document) {
        events.push(`saved:${document.isDirty}`);
        latest = document;
      },
      closed(document) {
        events.push(`closed:${document.uri}`);
        latest = document;
      },
    });
    tracker.initialize();
    try {
      const document = await vscode.workspace.openTextDocument(uri);
      const editor = await vscode.window.showTextDocument(document);
      await waitFor(
        () => events.some((event) => event === `opened:${uri.toString(true)}`),
        `open event: ${events.join(', ')}`
      );

      const initialVersion = document.version;
      assert.equal(
        await editor.edit((edit) => {
          edit.insert(new vscode.Position(0, 0), '// unsaved\n');
        }),
        true
      );
      await waitFor(
        () => latest?.isDirty === true,
        `dirty event: ${events.join(', ')}`
      );
      const dirtyVersion = latest!.version;
      assert.ok(dirtyVersion > initialVersion);
      assert.equal(
        tracker.dirtyDocuments()[0]?.text.includes('// unsaved'),
        true
      );

      await document.save();
      await waitFor(
        () => events.includes('saved:false'),
        `save event: ${events.join(', ')}`
      );
      assert.equal(tracker.dirtyDocuments().length, 0);

      await vscode.window.showTextDocument(document);
      await vscode.commands.executeCommand(
        'workbench.action.revertAndCloseActiveEditor'
      );
      await waitFor(
        () => events.includes(`closed:${uri.toString(true)}`),
        `close event: ${events.join(', ')}; remaining=${vscode.workspace.textDocuments.map((document) => document.uri.toString(true)).join(',')}; tabs=${vscode.window.tabGroups.all.flatMap((group) => group.tabs.map((tab) => tab.label)).join(',')}`
      );
      assert.equal(tracker.get(uri), undefined);
    } finally {
      tracker.dispose();
      await closeEditor();
      await restoreFile(uri, original);
    }
  });

  test('tracks only visible documents during initialization and background model opens', async () => {
    await closeEditor();
    const backgroundUri = fixtureUri('app', 'index.ts');
    const otherBackgroundUri = fixtureUri('inferred', 'index.ts');
    const visibleUri = fixtureUri('second', 'index.ts');
    await vscode.workspace.openTextDocument(backgroundUri);
    await vscode.window.showTextDocument(
      await vscode.workspace.openTextDocument(visibleUri),
      {preview: false}
    );
    const events: string[] = [];
    const tracker = lifecycleTracker(events);
    try {
      tracker.initialize();
      await waitFor(
        () => tracker.get(visibleUri) !== undefined,
        'visible document initialization'
      );
      assert.equal(tracker.get(backgroundUri), undefined);
      assert.deepEqual(
        tracker.documents().map((document) => document.uri),
        [visibleUri.toString(true)]
      );

      await vscode.workspace.openTextDocument(otherBackgroundUri);
      assert.equal(tracker.get(otherBackgroundUri), undefined);
      assert.equal(events.length, 1);
    } finally {
      tracker.dispose();
      await closeEditor();
    }
  });

  test('resumes tracking when a retained model is reopened', async () => {
    await closeEditor();
    const uri = fixtureUri('app', 'index.ts');
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {preview: false});
    const events: string[] = [];
    const tracker = lifecycleTracker(events);
    try {
      tracker.initialize();
      await waitFor(
        () =>
          events.filter((event) => event.startsWith('opened:')).length === 1,
        'initial open'
      );

      await vscode.window.tabGroups.close(visibleTabs(uri));
      await waitFor(
        () => tracker.get(uri) === undefined,
        'close before reopen'
      );
      assert.equal(vscode.workspace.textDocuments.includes(document), true);

      await vscode.window.showTextDocument(document, {preview: false});
      await waitFor(
        () =>
          events.filter((event) => event.startsWith('opened:')).length === 2,
        'retained model reopen'
      );
      assert.equal(tracker.get(uri)?.text, document.getText());
      assert.equal(tracker.get(uri)?.version, document.version);
    } finally {
      tracker.dispose();
      await closeEditor();
    }
  });

  test('keeps a document tracked until the last split tab closes', async () => {
    await closeEditor();
    const uri = fixtureUri('app', 'index.ts');
    const document = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(document, {preview: false});
    const events: string[] = [];
    const tracker = lifecycleTracker(events);
    try {
      tracker.initialize();
      await waitFor(() => tracker.get(uri) !== undefined, 'initial split open');
      await vscode.commands.executeCommand('workbench.action.splitEditor');
      await waitFor(() => visibleTabs(uri).length === 2, 'split editor');
      assert.equal(
        events.filter((event) => event.startsWith('opened:')).length,
        1
      );

      await vscode.window.tabGroups.close(visibleTabs(uri)[0]);
      await waitFor(() => visibleTabs(uri).length === 1, 'close one split');
      assert.equal(tracker.get(uri) !== undefined, true);
      assert.equal(
        events.filter((event) => event.startsWith('closed:')).length,
        0
      );

      await vscode.window.tabGroups.close(visibleTabs(uri)[0]);
      await waitFor(() => tracker.get(uri) === undefined, 'close last split');
      assert.equal(
        events.filter((event) => event.startsWith('closed:')).length,
        1
      );
    } finally {
      tracker.dispose();
      await closeEditor();
    }
  });

  test('routes separate configured projects and inferred fallback', async () => {
    const router = await SpawnedProjectRouter.create();
    const appUri = fixtureUri('app', 'index.ts');
    const secondUri = fixtureUri('second', 'index.ts');
    const inferredUri = fixtureUri('inferred', 'index.ts');
    const tracked = (uri: vscode.Uri): TrackedDocument => ({
      uri: uri.toString(true),
      fileName: uri.fsPath,
      version: 1,
      text: '',
      isDirty: false,
      ...(vscode.workspace.getWorkspaceFolder(uri)
        ? {
            workspaceFolder: vscode.workspace
              .getWorkspaceFolder(uri)!
              .uri.toString(true),
          }
        : {}),
    });

    const app = await router.associate(tracked(appUri));
    const second = await router.associate(tracked(secondUri));
    const inferred = await router.associate(tracked(inferredUri));
    assert.equal(app.kind, 'configured');
    assert.equal(second.kind, 'configured');
    assert.notEqual(app.key, second.key);
    assert.equal(app.configFileName, fixtureUri('app', 'tsconfig.json').fsPath);
    assert.equal(
      second.configFileName,
      fixtureUri('second', 'tsconfig.json').fsPath
    );
    assert.equal(inferred.kind, 'inferred');
    assert.equal(inferred.configFileName, undefined);
    assert.match(inferred.key, /^inferred:/);
  });
});
