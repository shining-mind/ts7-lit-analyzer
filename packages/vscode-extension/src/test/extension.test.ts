import assert from 'node:assert/strict';
import * as vscode from 'vscode';

suite('Extension activation', () => {
  test('activates in an isolated Extension Development Host', async () => {
    const extension = vscode.extensions.getExtension(
      'ts7-lit-analyzer.ts7-lit-extension'
    );

    if (extension === undefined) {
      throw new Error('The extension is not installed in the test host');
    }
    const api = await extension.activate();
    assert.equal(extension.isActive, true);
    assert.equal(api.analyzerVersion, '0.0.0');
    assert.equal(typeof api.orchestration.snapshot, 'function');
    assert.equal(typeof api.orchestration.idle, 'function');
    assert.equal(Array.isArray(api.orchestration.snapshot().documents), true);
    assert.equal(Array.isArray(api.orchestration.snapshot().runtimes), true);
  });
});
