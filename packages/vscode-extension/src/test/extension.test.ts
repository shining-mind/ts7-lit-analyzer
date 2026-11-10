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
    await extension.activate();
    assert.equal(extension.isActive, true);
  });
});
