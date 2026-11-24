import {
  TabInputText,
  window,
  workspace,
  type Disposable,
  type Tab,
  type TextDocument,
  type Uri,
} from 'vscode';

export interface TrackedDocument {
  uri: string;
  fileName: string;
  version: number;
  text: string;
  isDirty: boolean;
  workspaceFolder?: string;
}

export interface DocumentTrackerListener {
  opened(document: TrackedDocument): void;
  changed(document: TrackedDocument): void;
  saved(document: TrackedDocument): void;
  closed(document: TrackedDocument): void;
}

/**
 * Tracks editor documents and dirty state. Tab groups define editor close because
 * VS Code may retain opened text models after their tabs close
 * (microsoft/vscode#199282 and microsoft/vscode#291739).
 */
export class DocumentTracker implements Disposable {
  private readonly open = new Map<string, TrackedDocument>();
  private readonly dirty = new Map<string, TrackedDocument>();
  private readonly openTabs = new Map<string, Set<Tab>>();
  private readonly subscriptions: Disposable[] = [];
  private readonly listener: DocumentTrackerListener;
  private disposed = false;

  constructor(listener: DocumentTrackerListener) {
    this.listener = listener;
    this.subscriptions.push(
      workspace.onDidOpenTextDocument((document) =>
        this.openDocument(document)
      ),
      workspace.onDidChangeTextDocument((event) => {
        if (event.contentChanges.length > 0) {
          this.changeDocument(event.document);
        }
      }),
      workspace.onDidSaveTextDocument((document) =>
        this.saveDocument(document)
      ),
      window.tabGroups.onDidChangeTabs((event) => {
        for (const tab of event.opened) {
          if (tab.input instanceof TabInputText) {
            void this.openTab(tab);
          }
        }
        for (const tab of event.closed) {
          if (tab.input instanceof TabInputText) {
            this.closeTab(tab);
          }
        }
      })
    );
  }

  initialize(): void {
    for (const group of window.tabGroups.all) {
      for (const tab of group.tabs) {
        if (tab.input instanceof TabInputText) {
          void this.openTab(tab);
        }
      }
    }
  }

  documents(): readonly TrackedDocument[] {
    return [...this.open.values()];
  }

  dirtyDocuments(): readonly TrackedDocument[] {
    return [...this.dirty.values()];
  }

  get(uri: Uri): TrackedDocument | undefined {
    return this.open.get(uri.toString(true));
  }

  dispose(): void {
    this.disposed = true;
    for (const subscription of this.subscriptions.splice(0)) {
      subscription.dispose();
    }
    this.open.clear();
    this.dirty.clear();
    this.openTabs.clear();
  }

  private openDocument(document: TextDocument): void {
    const wasOpen = this.open.has(document.uri.toString(true));
    const tracked = this.track(document);
    if (tracked && !wasOpen) {
      this.listener.opened(tracked);
    }
  }

  private changeDocument(document: TextDocument): void {
    const tracked = this.track(document);
    if (tracked) {
      tracked.isDirty = true;
      this.open.set(tracked.uri, tracked);
      this.dirty.set(tracked.uri, tracked);
      this.listener.changed(tracked);
    }
  }

  private saveDocument(document: TextDocument): void {
    const tracked = this.track(document);
    if (tracked) {
      this.listener.saved(tracked);
    }
  }

  private async openTab(tab: Tab): Promise<void> {
    if (!(tab.input instanceof TabInputText)) {
      return;
    }
    const key = tab.input.uri.toString(true);
    const tabs = this.openTabs.get(key) ?? new Set<Tab>();
    tabs.add(tab);
    this.openTabs.set(key, tabs);

    const existing = workspace.textDocuments.find(
      (document) => document.uri.toString(true) === key
    );
    if (existing) {
      this.openDocument(existing);
      return;
    }

    try {
      const document = await workspace.openTextDocument(tab.input.uri);
      if (!this.disposed && this.openTabs.has(key)) {
        this.openDocument(document);
      }
    } catch {
      return;
    }
  }

  private closeTab(tab: Tab): void {
    if (!(tab.input instanceof TabInputText)) {
      return;
    }
    const key = tab.input.uri.toString(true);
    const tabs = this.openTabs.get(key);
    if (!tabs?.delete(tab) || tabs.size > 0) {
      return;
    }
    this.openTabs.delete(key);
    this.closeUri(tab.input.uri);
  }

  private closeUri(uri: Uri): void {
    const key = uri.toString(true);
    const visible = window.tabGroups.all.some((group) =>
      group.tabs.some(
        (tab) =>
          tab.input instanceof TabInputText &&
          tab.input.uri.toString(true) === key
      )
    );
    if (visible) {
      return;
    }
    const previous = this.open.get(key);
    this.open.delete(key);
    this.dirty.delete(key);
    if (previous && !this.disposed) {
      this.listener.closed(previous);
    }
  }

  private track(document: TextDocument): TrackedDocument | undefined {
    const key = document.uri.toString(true);
    if (this.disposed || !this.openTabs.has(key) || !isSupported(document)) {
      return undefined;
    }
    const tracked: TrackedDocument = {
      uri: key,
      fileName: document.fileName,
      version: document.version,
      text: document.getText(),
      isDirty: document.isDirty,
      ...(workspace.getWorkspaceFolder(document.uri)
        ? {
            workspaceFolder: workspace
              .getWorkspaceFolder(document.uri)!
              .uri.toString(true),
          }
        : {}),
    };
    this.open.set(key, tracked);
    if (tracked.isDirty) {
      this.dirty.set(key, tracked);
    } else {
      this.dirty.delete(key);
    }
    return tracked;
  }
}

function isSupported(document: TextDocument): boolean {
  return (
    document.uri.scheme === 'file' &&
    ['typescript', 'typescriptreact', 'javascript', 'javascriptreact'].includes(
      document.languageId
    )
  );
}
