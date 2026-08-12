const fs = require('fs');
const path = require('path');
const { MIPS } = require('@specy/mips');
const { RISCV } = require('@specy/risc-v');

const root = path.resolve(__dirname, '..');

function readText(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8');
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function assembleExample({ architecture, file, expectErrors = false }) {
  const source = readText(file);
  const simulator = architecture === 'riscv'
    ? RISCV.makeRiscVFromSource(source)
    : MIPS.makeMipsFromSource(source);
  const result = simulator.assemble();

  if (expectErrors) {
    assert(result.hasErrors, `${file} should report assembly errors.`);
    return;
  }

  assert(!result.hasErrors, `${file} failed to assemble:\n${result.report}`);
  assert(simulator.getCompiledStatements().length > 0, `${file} assembled without compiled statements.`);
}

function verifyAssemblyTokenColors({ themeName, file }) {
  const colorTheme = JSON.parse(readText(file));
  const tokenScopes = new Set((colorTheme.tokenColors ?? []).flatMap(rule => Array.isArray(rule.scope) ? rule.scope : [rule.scope]));
  for (const scope of [
    'keyword.mnemonic.instruction.riscv',
    'variable.other.register.riscv',
    'keyword.control.directive.riscv',
    'comment.line.number-sign.riscv',
    'entity.name.label.riscv',
  ]) {
    assert(tokenScopes.has(scope), `${themeName} should color ${scope}.`);
  }
}

function verifyManifestAndBundles() {
  const manifest = JSON.parse(readText('package.json'));
  assert(manifest.main === './out/extension.js', 'Desktop entry should stay at ./out/extension.js.');
  assert(manifest.browser === './out/extension-web.js', 'Browser entry should point at ./out/extension-web.js.');
  assert(!(manifest.activationEvents ?? []).includes('onStartupFinished'), 'WIMPS should not activate on every VS Code startup.');
  const commands = manifest.contributes?.commands ?? [];
  for (const [command, lightIcon] of [
    ['wimps.continueCurrentFile', 'resources/action-continue-light.svg'],
    ['wimps.stepCurrentFile', 'resources/action-step-light.svg'],
    ['wimps.resetSimulator', 'resources/action-reset-light.svg'],
  ]) {
    const contribution = commands.find(item => item.command === command);
    assert(contribution?.icon?.light === lightIcon, `${command} should use a visible light-theme action icon.`);
    assert(fs.existsSync(path.join(root, lightIcon)), `${lightIcon} should be packaged.`);
  }
  const riscvLanguage = (manifest.contributes?.languages ?? []).find(language => language.id === 'riscv');
  assert(riscvLanguage, 'RISC-V language contribution is missing.');
  for (const extension of ['.riscv', '.rv', '.rvasm']) {
    assert(riscvLanguage.extensions?.includes(extension), `RISC-V language should include ${extension}.`);
  }
  const x86Language = (manifest.contributes?.languages ?? []).find(language => language.id === 'x86');
  assert(x86Language, 'x86 language contribution is missing.');
  assert(x86Language.extensions?.includes('.x86'), 'x86 language should include .x86.');
  const iconTheme = (manifest.contributes?.iconThemes ?? []).find(theme => theme.id === 'wimps-assembly-icons');
  assert(iconTheme?.path === './themes/wimps-file-icon-theme.json', 'WIMPS assembly file icon theme is missing.');
  assert(fs.existsSync(path.join(root, manifest.main)), `${manifest.main} is missing. Run npm run compile.`);
  assert(fs.existsSync(path.join(root, manifest.browser)), `${manifest.browser} is missing. Run npm run compile.`);
  const fileIconTheme = JSON.parse(readText('themes/wimps-file-icon-theme.json'));
  for (const extension of ['asm', 's', 'riscv', 'rv', 'rvasm', 'x86']) {
    assert(fileIconTheme.fileExtensions?.[extension] === '_assembly', `File icon theme should map .${extension} to the assembly icon.`);
  }
  assert(fileIconTheme.iconDefinitions?._assembly?.iconPath === '../resources/file-assembly.svg', 'Assembly icon should use a direct SVG asset.');
  assert(fileIconTheme.iconDefinitions?._assembly_light?.iconPath === '../resources/file-assembly-light.svg', 'Light assembly icon should use a direct SVG asset.');
  assert(fileIconTheme.languageIds?.mips === '_assembly', 'File icon theme should map the mips language to the assembly icon.');
  assert(fileIconTheme.languageIds?.riscv === '_assembly', 'File icon theme should map the riscv language to the assembly icon.');
  assert(fileIconTheme.languageIds?.x86 === '_assembly', 'File icon theme should map the x86 language to the assembly icon.');
  assert(fs.existsSync(path.join(root, 'resources/file-assembly.svg')), 'Assembly SVG icon should be packaged.');
  assert(fs.existsSync(path.join(root, 'resources/file-assembly-light.svg')), 'Light assembly SVG icon should be packaged.');
  const themes = manifest.contributes?.themes ?? [];
  const darkTheme = themes.find(theme => theme.label === 'WIMPS Dark');
  const lightTheme = themes.find(theme => theme.label === 'WIMPS Light');
  assert(darkTheme?.uiTheme === 'vs-dark', 'WIMPS Dark theme should be registered as a dark theme.');
  assert(darkTheme?.path === './themes/wimps-dark-color-theme.json', 'WIMPS Dark theme path is wrong.');
  assert(lightTheme?.uiTheme === 'vs', 'WIMPS Light theme should be registered as a light theme.');
  assert(lightTheme?.path === './themes/wimps-light-color-theme.json', 'WIMPS Light theme path is wrong.');
  verifyAssemblyTokenColors({ themeName: 'WIMPS Dark', file: 'themes/wimps-dark-color-theme.json' });
  verifyAssemblyTokenColors({ themeName: 'WIMPS Light', file: 'themes/wimps-light-color-theme.json' });

  const desktopBundle = readText(manifest.main);
  const webBundle = readText(manifest.browser);
  assert(fs.existsSync(path.join(root, 'out/test-web.js')), 'Web Extension Host test bundle is missing. Run npm run compile.');
  assert(!desktopBundle.includes('require("@specy/mips")'), 'Desktop bundle still externalizes @specy/mips.');
  assert(!desktopBundle.includes('require("@specy/risc-v")'), 'Desktop bundle still externalizes @specy/risc-v.');
  assert(!desktopBundle.includes('require("@specy/x86")'), 'Desktop bundle still externalizes @specy/x86.');
  assert(!webBundle.includes('require("@specy/mips")'), 'Web bundle still externalizes @specy/mips.');
  assert(!webBundle.includes('require("@specy/risc-v")'), 'Web bundle still externalizes @specy/risc-v.');
  assert(!webBundle.includes('require("@specy/x86")'), 'Web bundle still externalizes @specy/x86.');

  const editorMenus = [
    ...(manifest.contributes?.menus?.['editor/title'] ?? []),
    ...(manifest.contributes?.menus?.['editor/context'] ?? []),
    ...(manifest.contributes?.keybindings ?? []),
    ...(manifest.contributes?.menus?.commandPalette ?? []).filter(item => item.when !== 'false'),
  ];
  assert(editorMenus.every(item => !String(item.when ?? '').includes('resourceExtname')), 'Editor UI should use WIMPS context keys, not repeated resourceExtname checks.');
  assert(editorMenus.every(item => String(item.when ?? '').includes('wimps.activeEditorIsAssembly')), 'Editor UI should be guarded by wimps.activeEditorIsAssembly.');
  assert(editorMenus.every(item => !String(item.when ?? '').includes('wimps.hasAssemblyFile')), 'Editor UI should not stay visible for inactive assembly files.');
  const viewMenus = [
    ...(manifest.contributes?.menus?.['view/title'] ?? []),
    ...(manifest.contributes?.menus?.['view/item/context'] ?? []),
  ];
  assert(viewMenus.every(item => String(item.when ?? '').includes('wimps.hasAssemblyFile')), 'WIMPS view tools should stay available while an assembly file is visible.');

  const palette = manifest.contributes?.menus?.commandPalette ?? [];
  for (const command of ['wimps.editMemoryWordAtItem', 'wimps.setRegisterValueAtItem']) {
    const item = palette.find(entry => entry.command === command);
    assert(item?.when === 'false', `${command} should be hidden from the command palette.`);
  }

  const containers = manifest.contributes?.viewsContainers?.activitybar ?? [];
  const expectedContainers = new Map([
    ['wimpsRegisters', { viewId: 'wimps.registers', title: 'WIMPS Registers', type: 'webview' }],
    ['wimpsMemory', { viewId: 'wimps.memory', title: 'WIMPS Memory', type: 'webview' }],
    ['wimpsBitmap', { viewId: 'wimps.bitmap', title: 'WIMPS Bitmap', type: 'webview' }],
    ['wimpsProgram', { viewId: 'wimps.program', title: 'WIMPS Program', type: 'webview' }],
    ['wimpsAnalysis', { viewId: 'wimps.analysis', title: 'WIMPS Analysis', type: 'webview' }],
  ]);
  for (const [containerId, expected] of expectedContainers) {
    const container = containers.find(item => item.id === containerId);
    assert(container, `${containerId} activity bar container is missing.`);
    assert(container.title === expected.title, `${containerId} should use a clear WIMPS-prefixed title.`);
    const views = manifest.contributes?.views?.[containerId] ?? [];
    assert(views.length === 1, `${containerId} should contain exactly one WIMPS view.`);
    assert(views[0]?.id === expected.viewId, `${containerId} should contain ${expected.viewId}.`);
    assert(views[0]?.contextualTitle === expected.title, `${expected.viewId} should use a clear contextual title.`);
    assert(views[0]?.type === expected.type, `${expected.viewId} should use responsive webview content.`);
    assert(views[0]?.when === 'wimps.hasAssemblyFile', `${expected.viewId} should stay visible while an assembly file is visible.`);
  }
  assert(!manifest.contributes?.views?.wimps, 'WIMPS tools should be split into separate activity bar containers.');
  assert(!manifest.contributes?.viewsWelcome, 'WIMPS views should disappear for non-assembly editors instead of showing welcome content.');
}

verifyManifestAndBundles();
assembleExample({ architecture: 'mips', file: 'examples/mips/hello.asm' });
assembleExample({ architecture: 'mips', file: 'examples/mips/bitmap.asm' });
assembleExample({ architecture: 'riscv', file: 'examples/riscv/hello.riscv' });
assembleExample({ architecture: 'riscv', file: 'examples/riscv/loop.riscv' });
assembleExample({ architecture: 'mips', file: 'examples/invalid.asm', expectErrors: true });

console.log('WIMPS extension smoke checks passed.');
