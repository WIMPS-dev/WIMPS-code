const assert = require('assert');
const path = require('path');
const vscode = require('vscode');

const root = process.env.WIMPS_TEST_ROOT || path.resolve(__dirname, '..', '..');

function exampleUri(relativePath) {
  return vscode.Uri.file(path.join(root, relativePath));
}

async function openExample(relativePath) {
  const document = await vscode.workspace.openTextDocument(exampleUri(relativePath));
  await vscode.window.showTextDocument(document, { preview: false });
  await waitForExtensionHost();
  return document;
}

function waitForExtensionHost() {
  return new Promise(resolve => setTimeout(resolve, 150));
}

function waitForDebugSessionStart() {
  return new Promise(resolve => {
    const disposable = vscode.debug.onDidStartDebugSession(session => {
      if (session.type === 'wimps') {
        disposable.dispose();
        resolve(session);
      }
    });
  });
}

function waitForDebugSessionEnd(targetSession) {
  return new Promise(resolve => {
    const disposable = vscode.debug.onDidTerminateDebugSession(session => {
      if (session === targetSession) {
        disposable.dispose();
        resolve();
      }
    });
  });
}

suite('WIMPS extension', () => {
  suiteSetup(async () => {
    const extension = vscode.extensions.getExtension('wimps.wimps-vscode');
    assert.ok(extension, 'WIMPS extension should be installed in the Extension Host.');
    await extension.activate();
  });

  test('detects MIPS, RISC-V, and x86 file languages', async () => {
    const mips = await openExample('examples/mips/hello.asm');
    assert.strictEqual(mips.languageId, 'mips');

    const riscv = await openExample('examples/riscv/hello.riscv');
    assert.strictEqual(riscv.languageId, 'riscv');

    const x86 = await openExample('examples/x86/hello.x86');
    assert.strictEqual(x86.languageId, 'x86');
  });

  test('keeps assembly commands editor-scoped', async () => {
    const assembly = await openExample('examples/mips/hello.asm');
    await vscode.window.showTextDocument(assembly, { viewColumn: vscode.ViewColumn.One, preview: false });
    const plain = await vscode.workspace.openTextDocument({
      language: 'plaintext',
      content: 'not assembly',
    });
    await vscode.window.showTextDocument(plain, { viewColumn: vscode.ViewColumn.Two, preview: false });
    await waitForExtensionHost();

    const result = await vscode.commands.executeCommand('wimps.assembleCurrentFile');
    assert.strictEqual(result, true, 'Command palette actions should still use a visible assembly editor.');
    assert.strictEqual(vscode.window.activeTextEditor?.document.languageId, 'plaintext');
  });

  test('provides architecture-specific completions', async () => {
    const mips = await openExample('examples/mips/hello.asm');
    const mipsCompletions = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      mips.uri,
      new vscode.Position(0, 0),
    );
    const mipsLabels = new Set((mipsCompletions?.items ?? []).map(item => String(item.label)));
    assert.ok(mipsLabels.has('$v0'), 'MIPS completions should include $v0.');

    const riscv = await openExample('examples/riscv/hello.riscv');
    const riscvCompletions = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      riscv.uri,
      new vscode.Position(0, 0),
    );
    const riscvLabels = new Set((riscvCompletions?.items ?? []).map(item => String(item.label)));
    assert.ok(riscvLabels.has('a0'), 'RISC-V completions should include a0.');

    const x86 = await openExample('examples/x86/hello.x86');
    const x86Completions = await vscode.commands.executeCommand(
      'vscode.executeCompletionItemProvider',
      x86.uri,
      new vscode.Position(0, 0),
    );
    const x86Labels = new Set((x86Completions?.items ?? []).map(item => String(item.label)));
    assert.ok(x86Labels.has('rax'), 'x86 completions should include rax.');
  });

  test('provides hover, definition, and document symbols', async () => {
    const mips = await openExample('examples/mips/hello.asm');

    const hover = await vscode.commands.executeCommand(
      'vscode.executeHoverProvider',
      mips.uri,
      new vscode.Position(5, 3),
    );
    assert.ok((hover ?? []).length > 0, 'MIPS instruction hover should be available.');

    const symbols = await vscode.commands.executeCommand(
      'vscode.executeDocumentSymbolProvider',
      mips.uri,
    );
    const symbolNames = new Set((symbols ?? []).map(symbol => symbol.name));
    assert.ok(symbolNames.has('main'), 'Document symbols should include the main label.');

    const definition = await vscode.commands.executeCommand(
      'vscode.executeDefinitionProvider',
      mips.uri,
      new vscode.Position(6, 11),
    );
    assert.ok((definition ?? []).length > 0, 'Label definition should be available.');
  });

  test('assembles valid MIPS and RISC-V examples through VS Code commands', async () => {
    const mips = await openExample('examples/mips/hello.asm');
    const mipsResult = await vscode.commands.executeCommand('wimps.assembleCurrentFile');
    assert.strictEqual(mipsResult, true);
    assert.deepStrictEqual(vscode.languages.getDiagnostics(mips.uri), []);

    const riscv = await openExample('examples/riscv/loop.riscv');
    const riscvResult = await vscode.commands.executeCommand('wimps.assembleCurrentFile');
    assert.strictEqual(riscvResult, true);
    assert.deepStrictEqual(vscode.languages.getDiagnostics(riscv.uri), []);
  });

  test('reports diagnostics for invalid assembly', async () => {
    const invalid = await openExample('examples/invalid.asm');
    const result = await vscode.commands.executeCommand('wimps.assembleCurrentFile');
    assert.strictEqual(result, false);
    assert.ok(vscode.languages.getDiagnostics(invalid.uri).length > 0, 'Invalid assembly should report diagnostics.');
  });

  test('starts the WIMPS debug adapter for a MIPS file', async () => {
    const mips = await openExample('examples/mips/hello.asm');
    const started = waitForDebugSessionStart();
    const launched = await vscode.debug.startDebugging(undefined, {
      type: 'wimps',
      request: 'launch',
      name: 'WIMPS test launch',
      program: mips.uri.toString(),
    });
    assert.strictEqual(launched, true);

    const session = await started;
    assert.strictEqual(session.type, 'wimps');
    const ended = waitForDebugSessionEnd(session);
    await vscode.debug.stopDebugging(session);
    await ended;
  });
});
