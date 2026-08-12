import * as vscode from 'vscode';
import 'mocha/mocha';

declare const mocha: BrowserMocha;
declare function suite(name: string, callback: () => void): void;
declare function suiteSetup(callback: () => void | Thenable<void>): void;
declare function test(name: string, callback: () => void | Thenable<void>): void;

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function assertEqual<T>(actual: T, expected: T, message: string) {
  if (actual !== expected) {
    throw new Error(`${message} Expected ${String(expected)}, got ${String(actual)}.`);
  }
}

function workspaceExampleUri(relativePath: string): vscode.Uri {
  const folder = vscode.workspace.workspaceFolders?.[0];
  assert(folder, 'Web tests need an examples workspace folder.');
  return vscode.Uri.joinPath(folder.uri, relativePath);
}

async function openExample(relativePath: string): Promise<vscode.TextDocument> {
  const document = await vscode.workspace.openTextDocument(workspaceExampleUri(relativePath));
  await vscode.window.showTextDocument(document, { preview: false });
  await waitForExtensionHost();
  return document;
}

function waitForExtensionHost(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 150));
}

function waitForDebugSessionStart(): Promise<vscode.DebugSession> {
  return new Promise(resolve => {
    const disposable = vscode.debug.onDidStartDebugSession(session => {
      if (session.type === 'wimps') {
        disposable.dispose();
        resolve(session);
      }
    });
  });
}

function waitForDebugSessionEnd(targetSession: vscode.DebugSession): Promise<void> {
  return new Promise(resolve => {
    const disposable = vscode.debug.onDidTerminateDebugSession(session => {
      if (session === targetSession) {
        disposable.dispose();
        resolve();
      }
    });
  });
}

function defineTests() {
  suite('WIMPS web extension', () => {
    suiteSetup(async () => {
      const extension = vscode.extensions.getExtension('wimps.wimps-vscode');
      assert(extension, 'WIMPS extension should be installed in the web Extension Host.');
      await extension.activate();
    });

    test('detects MIPS, RISC-V, and x86 files in the web Extension Host', async () => {
      const mips = await openExample('mips/hello.asm');
      assertEqual(mips.languageId, 'mips', 'MIPS example should use the mips language.');

      const riscv = await openExample('riscv/hello.riscv');
      assertEqual(riscv.languageId, 'riscv', 'RISC-V example should use the riscv language.');

      const x86 = await openExample('x86/hello.x86');
      assertEqual(x86.languageId, 'x86', 'x86 example should use the x86 language.');
    });

    test('keeps assembly commands available when assembly editor is visible', async () => {
      const assembly = await openExample('mips/hello.asm');
      await vscode.window.showTextDocument(assembly, { viewColumn: vscode.ViewColumn.One, preview: false });
      const plain = await vscode.workspace.openTextDocument({
        language: 'plaintext',
        content: 'not assembly',
      });
      await vscode.window.showTextDocument(plain, { viewColumn: vscode.ViewColumn.Two, preview: false });
      await waitForExtensionHost();

      const result = await vscode.commands.executeCommand('wimps.assembleCurrentFile');
      assertEqual(result, true, 'Command palette actions should still use a visible assembly editor.');
      assertEqual(vscode.window.activeTextEditor?.document.languageId, 'plaintext', 'Plaintext editor should remain active.');
    });

    test('provides architecture-specific completions in the web Extension Host', async () => {
      const mips = await openExample('mips/hello.asm');
      const mipsCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        mips.uri,
        new vscode.Position(0, 0),
      );
      const mipsLabels = new Set((mipsCompletions?.items ?? []).map(item => String(item.label)));
      assert(mipsLabels.has('$v0'), 'MIPS completions should include $v0.');

      const riscv = await openExample('riscv/hello.riscv');
      const riscvCompletions = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        riscv.uri,
        new vscode.Position(0, 0),
      );
      const riscvLabels = new Set((riscvCompletions?.items ?? []).map(item => String(item.label)));
      assert(riscvLabels.has('a0'), 'RISC-V completions should include a0.');

      const x86 = await openExample('x86/hello.x86');
      const x86Completions = await vscode.commands.executeCommand<vscode.CompletionList>(
        'vscode.executeCompletionItemProvider',
        x86.uri,
        new vscode.Position(0, 0),
      );
      const x86Labels = new Set((x86Completions?.items ?? []).map(item => String(item.label)));
      assert(x86Labels.has('rax'), 'x86 completions should include rax.');
    });

    test('provides hover, definition, and document symbols in the web Extension Host', async () => {
      const mips = await openExample('mips/hello.asm');

      const hover = await vscode.commands.executeCommand<vscode.Hover[]>(
        'vscode.executeHoverProvider',
        mips.uri,
        new vscode.Position(5, 3),
      );
      assert((hover ?? []).length > 0, 'MIPS instruction hover should be available.');

      const symbols = await vscode.commands.executeCommand<vscode.DocumentSymbol[]>(
        'vscode.executeDocumentSymbolProvider',
        mips.uri,
      );
      const symbolNames = new Set((symbols ?? []).map(symbol => symbol.name));
      assert(symbolNames.has('main'), 'Document symbols should include the main label.');

      const definition = await vscode.commands.executeCommand<vscode.Location[]>(
        'vscode.executeDefinitionProvider',
        mips.uri,
        new vscode.Position(6, 11),
      );
      assert((definition ?? []).length > 0, 'Label definition should be available.');
    });

    test('assembles MIPS and RISC-V examples in the web Extension Host', async () => {
      const mips = await openExample('mips/hello.asm');
      const mipsResult = await vscode.commands.executeCommand('wimps.assembleCurrentFile');
      assertEqual(mipsResult, true, 'MIPS assemble command should succeed.');
      assertEqual(vscode.languages.getDiagnostics(mips.uri).length, 0, 'MIPS example should not report diagnostics.');

      const riscv = await openExample('riscv/loop.riscv');
      const riscvResult = await vscode.commands.executeCommand('wimps.assembleCurrentFile');
      assertEqual(riscvResult, true, 'RISC-V assemble command should succeed.');
      assertEqual(vscode.languages.getDiagnostics(riscv.uri).length, 0, 'RISC-V example should not report diagnostics.');
    });

    test('reports diagnostics for invalid assembly in the web Extension Host', async () => {
      const invalid = await openExample('invalid.asm');
      const result = await vscode.commands.executeCommand('wimps.assembleCurrentFile');
      assertEqual(result, false, 'Invalid assembly should fail to assemble.');
      assert(vscode.languages.getDiagnostics(invalid.uri).length > 0, 'Invalid assembly should report diagnostics.');
    });

    test('starts the WIMPS debug adapter in the web Extension Host', async () => {
      const mips = await openExample('mips/hello.asm');
      const started = waitForDebugSessionStart();
      const launched = await vscode.debug.startDebugging(undefined, {
        type: 'wimps',
        request: 'launch',
        name: 'WIMPS web test launch',
        program: mips.uri.toString(),
      });
      assertEqual(launched, true, 'WIMPS debug session should launch.');

      const session = await started;
      assertEqual(session.type, 'wimps', 'Debug session should use WIMPS adapter.');
      const ended = waitForDebugSessionEnd(session);
      await vscode.debug.stopDebugging(session);
      await ended;
    });
  });
}

export function run(): Promise<void> {
  return new Promise((resolve, reject) => {
    mocha.setup({
      ui: 'tdd',
      reporter: undefined,
      timeout: 20000,
    });

    defineTests();

    mocha.run(failures => {
      if (failures > 0) {
        reject(new Error(`${failures} web Extension Host test(s) failed.`));
      } else {
        resolve();
      }
    });
  });
}
