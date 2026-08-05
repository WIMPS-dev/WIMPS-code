const fs = require('fs');
const path = require('path');
const { runTests } = require('@vscode/test-electron');

async function main() {
  const extensionDevelopmentPath = path.resolve(__dirname, '..');
  const extensionTestsPath = path.resolve(__dirname, 'suite', 'index.js');
  const defaultExecutable = '/usr/bin/code';
  const vscodeExecutablePath = process.env.VSCODE_EXECUTABLE_PATH
    || (fs.existsSync(defaultExecutable) ? defaultExecutable : undefined);

  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath,
    extensionTestsEnv: {
      WIMPS_TEST_ROOT: extensionDevelopmentPath,
    },
    launchArgs: [
      path.join(extensionDevelopmentPath, 'examples'),
      '--disable-workspace-trust',
    ],
  });
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
