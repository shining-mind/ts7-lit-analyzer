import assert from 'node:assert/strict';
import {findProperty, type RegistryView} from '@ts7-lit-analyzer/analyzer-core';
import * as vscode from 'vscode';

import {EditorAnalysisCoordinator} from '../host/coordinator.js';
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
  const deadline = Date.now() + 10000;
  while (!condition()) {
    if (Date.now() > deadline) {
      throw new Error(`Timed out waiting for ${description}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

function viewFor(
  coordinator: EditorAnalysisCoordinator,
  config: vscode.Uri
): RegistryView | undefined {
  return [...coordinator['runtimes'].values()].find(
    (runtime) => runtime.association.configFileName === config.fsPath
  )?.view;
}

function countText(view: RegistryView | undefined): string | undefined {
  return view?.byTagName('x-counter')
    ? findProperty(view.byTagName('x-counter')!, 'count')?.type?.text
    : undefined;
}

async function replaceCount(
  document: vscode.TextDocument,
  value: string
): Promise<void> {
  const editor = await vscode.window.showTextDocument(document, {
    preview: false,
  });
  const original = document.getText();
  assert.equal(
    await editor.edit((edit) => {
      edit.replace(
        new vscode.Range(
          document.positionAt(0),
          document.positionAt(original.length)
        ),
        original.replace(/count: [^=]+= [^;]+;/, value)
      );
    }),
    true
  );
}

async function closeAllEditors(): Promise<void> {
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

suite('Editor analysis coordinator', () => {
  const appConfig = fixtureUri('app', 'tsconfig.json');
  const libConfig = fixtureUri('lib', 'tsconfig.json');
  const libSource = fixtureUri('lib', 'src', 'counter.ts');

  test('propagates unsaved referenced changes and saved overlays', async () => {
    const original = Buffer.from(
      await vscode.workspace.fs.readFile(libSource)
    ).toString();
    const filesConfiguration = vscode.workspace.getConfiguration('files');
    const previousAutoSave = filesConfiguration.get<string>('autoSave');
    await filesConfiguration.update(
      'autoSave',
      'off',
      vscode.ConfigurationTarget.Workspace
    );
    const coordinator = new EditorAnalysisCoordinator({
      router: await SpawnedProjectRouter.create(),
      settings: {
        trigger: 'onType',
        debounceMs: 10,
        maxWaitMs: 50,
        maxResidentProjects: 2,
        collectTiming: false,
      },
    });
    coordinator.initialize();
    try {
      const app = await vscode.workspace.openTextDocument(
        fixtureUri('app', 'index.ts')
      );
      await vscode.window.showTextDocument(app, {preview: false});
      const lib = await vscode.workspace.openTextDocument(libSource);
      await vscode.window.showTextDocument(lib, {preview: false});
      await waitFor(
        () => countText(viewFor(coordinator, appConfig)) === 'number',
        `initial app analysis: ${JSON.stringify(coordinator.snapshot())}`
      );

      await replaceCount(lib, "count: string = 'zero';");
      await waitFor(
        () => countText(viewFor(coordinator, appConfig)) === 'string',
        'unsaved referenced update'
      );
      await lib.save();
      await waitFor(
        () =>
          !coordinator
            .snapshot()
            .documents.some(
              (document) =>
                document.uri === lib.uri.toString(true) && document.isDirty
            ) && countText(viewFor(coordinator, appConfig)) === 'string',
        'saved referenced update'
      );

      await replaceCount(lib, 'count: boolean = true;');
      await waitFor(
        () => countText(viewFor(coordinator, appConfig)) === 'boolean',
        'unsaved state before close'
      );
      const libTab = vscode.window.tabGroups.all
        .flatMap((group) => group.tabs)
        .find(
          (tab) =>
            tab.input instanceof vscode.TabInputText &&
            tab.input.uri.toString(true) === lib.uri.toString(true)
        );
      assert.ok(libTab);
      await vscode.window.tabGroups.close(libTab);
      await coordinator.idle();
      await waitFor(
        () =>
          countText(viewFor(coordinator, appConfig)) === 'string' &&
          [...coordinator['runtimes'].values()].find(
            (runtime) => runtime.association.configFileName === appConfig.fsPath
          )?.appliedOverlays.size === 0 &&
          [...coordinator['runtimes'].values()].find(
            (runtime) => runtime.association.configFileName === libConfig.fsPath
          )?.openFiles.size === 0,
        `close overlay removal: count=${countText(viewFor(coordinator, appConfig))}; ${JSON.stringify(coordinator.snapshot())}`
      );
    } finally {
      await coordinator.dispose();
      await closeAllEditors();
      await vscode.workspace.fs.writeFile(libSource, Buffer.from(original));
      await filesConfiguration.update(
        'autoSave',
        previousAutoSave,
        vscode.ConfigurationTarget.Workspace
      );
    }
  });

  test('defers onSave and bounds continuous onType changes with maxWait', async () => {
    const original = Buffer.from(
      await vscode.workspace.fs.readFile(libSource)
    ).toString();
    const coordinator = new EditorAnalysisCoordinator({
      router: await SpawnedProjectRouter.create(),
      settings: {
        trigger: 'onSave',
        debounceMs: 1000,
        maxWaitMs: 60,
        maxResidentProjects: 2,
        collectTiming: false,
      },
    });
    coordinator.initialize();
    try {
      const app = await vscode.workspace.openTextDocument(
        fixtureUri('app', 'index.ts')
      );
      await vscode.window.showTextDocument(app, {preview: false});
      const lib = await vscode.workspace.openTextDocument(libSource);
      await vscode.window.showTextDocument(lib, {preview: false});
      await waitFor(
        () => countText(viewFor(coordinator, appConfig)) === 'number',
        `initial onSave analysis: ${JSON.stringify(coordinator.snapshot())}`
      );

      await replaceCount(lib, "count: string = 'zero';");
      await coordinator.idle();
      assert.equal(countText(viewFor(coordinator, appConfig)), 'number');
      await lib.save();
      await waitFor(
        () => countText(viewFor(coordinator, appConfig)) === 'string',
        `onSave analysis: count=${countText(viewFor(coordinator, appConfig))}; ${JSON.stringify(coordinator.snapshot())}`
      );

      coordinator.updateSettings({
        trigger: 'onType',
        debounceMs: 1000,
        maxWaitMs: 60,
        maxResidentProjects: 2,
        collectTiming: false,
      });
      await replaceCount(lib, 'count: boolean = true;');
      await replaceCount(lib, 'count: number = 1;');
      await waitFor(
        () => countText(viewFor(coordinator, appConfig)) === 'number',
        'maxWait analysis'
      );
    } finally {
      await coordinator.dispose();
      await closeAllEditors();
      await vscode.workspace.fs.writeFile(libSource, Buffer.from(original));
    }
  });

  test('creates an isolated inferred registry session', async () => {
    const coordinator = new EditorAnalysisCoordinator({
      router: await SpawnedProjectRouter.create(),
      settings: {
        trigger: 'onType',
        debounceMs: 10,
        maxWaitMs: 50,
        maxResidentProjects: 2,
        collectTiming: false,
      },
    });
    coordinator.initialize();
    try {
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(
          fixtureUri('inferred', 'index.ts')
        ),
        {preview: false}
      );
      await waitFor(
        () =>
          [...coordinator['runtimes'].values()]
            .find((runtime) => runtime.association.kind === 'inferred')
            ?.view?.byTagName('x-inferred') !== undefined,
        'inferred registry analysis'
      );
      const inferred = [...coordinator['runtimes'].values()].find(
        (runtime) => runtime.association.kind === 'inferred'
      )!;
      assert.equal(inferred.association.configFileName, undefined);
      assert.equal(
        findProperty(inferred.view!.byTagName('x-inferred')!, 'enabled')?.type
          ?.text,
        'boolean'
      );
      await vscode.window.showTextDocument(
        await vscode.workspace.openTextDocument(fixtureUri('app', 'index.ts')),
        {preview: false}
      );
      await waitFor(
        () =>
          countText(
            viewFor(coordinator, fixtureUri('app', 'tsconfig.json'))
          ) === 'number',
        'configured analysis beside inferred'
      );
      assert.equal(
        [...coordinator['runtimes'].values()].some(
          (runtime) => runtime.association.kind === 'configured'
        ),
        true
      );
      assert.notEqual(
        inferred.association.key,
        [...coordinator['runtimes'].values()].find(
          (runtime) => runtime.association.kind === 'configured'
        )!.association.key
      );
    } finally {
      await coordinator.dispose();
      await closeAllEditors();
    }
  });

  test('evicts LRU projects and recreates them with dirty state', async () => {
    const secondSource = fixtureUri('second', 'index.ts');
    const secondConfig = fixtureUri('second', 'tsconfig.json');
    const original = Buffer.from(
      await vscode.workspace.fs.readFile(secondSource)
    ).toString();
    const coordinator = new EditorAnalysisCoordinator({
      router: await SpawnedProjectRouter.create(),
      settings: {
        trigger: 'onType',
        debounceMs: 10,
        maxWaitMs: 50,
        maxResidentProjects: 1,
        collectTiming: false,
      },
    });
    coordinator.initialize();
    try {
      const app = await vscode.workspace.openTextDocument(
        fixtureUri('app', 'index.ts')
      );
      await vscode.window.showTextDocument(app, {preview: false});
      await waitFor(
        () => countText(viewFor(coordinator, appConfig)) === 'number',
        `resident app: ${JSON.stringify(coordinator.snapshot())}`
      );

      const second = await vscode.workspace.openTextDocument(secondSource);
      const editor = await vscode.window.showTextDocument(second, {
        preview: false,
      });
      await editor.edit((edit) => {
        edit.insert(new vscode.Position(0, 0), '// dirty second\n');
      });
      await waitFor(
        () => viewFor(coordinator, secondConfig)?.components().length === 1,
        'second project eviction'
      );
      assert.equal(
        [...coordinator['runtimes'].values()].find(
          (runtime) => runtime.association.configFileName === appConfig.fsPath
        )?.resident,
        false
      );

      await vscode.window.showTextDocument(app, {preview: false});
      await waitFor(
        () => countText(viewFor(coordinator, appConfig)) === 'number',
        'app recovery'
      );
      await vscode.window.showTextDocument(second, {preview: false});
      await waitFor(
        () =>
          [...coordinator['runtimes'].values()].find(
            (runtime) =>
              runtime.association.configFileName === secondConfig.fsPath
          )?.view?.containsOverlays === true,
        'dirty second recovery'
      );
    } finally {
      await coordinator.dispose();
      await closeAllEditors();
      await vscode.workspace.fs.writeFile(secondSource, Buffer.from(original));
    }
  });
});
