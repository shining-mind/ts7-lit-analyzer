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
      await vscode.workspace.fs.writeFile(uri, Buffer.from(original));
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
