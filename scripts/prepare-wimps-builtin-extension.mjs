/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import cp from 'node:child_process';
import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const extensionRoot = path.join(repoRoot, 'extensions/wimps-vscode');

async function assertReadable(filePath, message) {
	try {
		await fs.access(filePath, constants.R_OK);
	} catch (error) {
		throw new Error(`${message}: ${filePath}`, { cause: error });
	}
}

function run(command, args, cwd) {
	cp.execFileSync(command, args, { cwd, stdio: 'inherit' });
}

async function main() {
	await assertReadable(path.join(extensionRoot, 'package.json'), 'Missing WIMPS built-in extension package');

	if (process.env.WIMPS_SKIP_EXTENSION_BUILD !== '1') {
		await assertReadable(path.join(extensionRoot, 'package-lock.json'), 'Missing WIMPS built-in extension package lock');
		run('npm', ['ci', '--ignore-scripts'], extensionRoot);
		run('npm', ['run', 'build'], extensionRoot);
	}

	await assertReadable(path.join(extensionRoot, 'out/extension.js'), 'Missing compiled WIMPS desktop extension');
	await assertReadable(path.join(extensionRoot, 'out/extension-web.js'), 'Missing compiled WIMPS web extension');

	console.log(`Prepared WIMPS built-in extension: ${path.relative(repoRoot, extensionRoot)}`);
}

main().catch(error => {
	console.error(error.message);
	process.exitCode = 1;
});
