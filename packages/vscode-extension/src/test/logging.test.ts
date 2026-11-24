import assert from 'node:assert/strict';
import type {LogOutputChannel} from 'vscode';
import * as vscode from 'vscode';

import {EditorAnalysisCoordinator} from '../host/coordinator.js';
import {ExtensionLogger} from '../host/logging.js';
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

suite('Diagnostic logging', () => {
  test('normal is quiet while debug enables timing and scoped memory', async () => {
    const entries: string[] = [];
    const channel = {
      info(message: string) {
        entries.push(message);
      },
      error(message: string) {
        entries.push(message);
      },
      dispose() {},
    } as unknown as LogOutputChannel;
    const logger = new ExtensionLogger('normal', channel);
    const appUri = fixtureUri('app', 'index.ts');
    const original = Buffer.from(
      await vscode.workspace.fs.readFile(appUri)
    ).toString();
    const settings = {
      trigger: 'onType' as const,
      debounceMs: 10,
      maxWaitMs: 50,
      maxResidentProjects: 2,
      collectTiming: false,
    };
    const coordinator = new EditorAnalysisCoordinator({
      router: await SpawnedProjectRouter.create(),
      settings,
      logger,
    });
    coordinator.initialize();
    try {
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(fixtureUri('app', 'index.ts')),
        {preview: false}
      );
      await waitFor(
        () =>
          [...coordinator['runtimes'].values()].some((runtime) => runtime.view),
        'normal analysis'
      );
      assert.equal(
        entries.some((entry) => entry.includes('analysis.resources')),
        false
      );
      const normalSession = [...coordinator['runtimes'].values()].find(
        (runtime) => runtime.session
      )!.session!;
      assert.equal((await normalSession.getTimingInfo()).enabled, false);
      assert.equal(
        'moduleResolutionFallbackCount' in normalSession.current()!,
        false
      );

      logger.setLevel('verbose');
      coordinator.updateSettings({...settings, collectTiming: true});
      await waitFor(
        () => entries.some((entry) => entry.includes('analysis.resources')),
        'verbose resource output'
      );
      assert.equal(
        entries.some((entry) => entry.includes('analysis.timing')),
        false
      );
      const accepted = entries.find(
        (entry) =>
          entry.includes('analysis.accepted') &&
          entry.includes('moduleResolutionFallbackCount')
      );
      assert.ok(accepted);
      assert.match(accepted, /"moduleResolutionFallbackCount":[1-9]/);
      assert.equal(accepted.includes('../lib/dist/counter.js'), false);
      assert.equal(accepted.includes('export {CounterElement}'), false);

      logger.setLevel('debug');
      coordinator.updateSettings({...settings, collectTiming: true});
      const appDocument = vscode.workspace.textDocuments.find(
        (document) =>
          document.uri.fsPath === fixtureUri('app', 'index.ts').fsPath
      )!;
      const editor = await vscode.window.showTextDocument(appDocument, {
        preview: false,
      });
      await editor.edit((edit) => {
        edit.insert(new vscode.Position(0, 0), '// debug timing\n');
      });
      await waitFor(
        () => entries.some((entry) => entry.includes('analysis.timing')),
        'debug timing output'
      );
      const resources = entries.find((entry) =>
        entry.includes('analysis.resources')
      );
      assert.ok(resources);
      assert.match(resources, /durationMs/);
      assert.match(resources, /sharedExtensionHostHeapUsed/);
      assert.match(resources, /sharedExtensionHostRss/);
      assert.match(resources, /overlayBytes/);
      assert.equal(resources.includes('export {CounterElement}'), false);
      assert.equal(resources.includes('AST'), false);
    } finally {
      await coordinator.dispose();
      logger.dispose();
      await vscode.commands.executeCommand('workbench.action.closeAllEditors');
      await vscode.workspace.fs.writeFile(appUri, Buffer.from(original));
    }
  });
});
