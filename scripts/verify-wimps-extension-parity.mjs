/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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

async function assertManifest() {
	const manifestPath = path.join(extensionRoot, 'package.json');
	const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
	if (manifest.name !== 'wimps-vscode') {
		throw new Error('WIMPS built-in extension package name must be wimps-vscode.');
	}
	if (manifest.browser !== './out/extension-web.js') {
		throw new Error('WIMPS built-in extension must define browser entry ./out/extension-web.js.');
	}
}

async function main() {
	await assertReadable(path.join(extensionRoot, 'package.json'), 'Missing WIMPS built-in extension package');
	await assertReadable(path.join(extensionRoot, 'LICENSE'), 'Missing WIMPS built-in extension license');
	await assertReadable(path.join(extensionRoot, 'out/extension.js'), 'Missing compiled WIMPS desktop extension');
	await assertReadable(path.join(extensionRoot, 'out/extension-web.js'), 'Missing compiled WIMPS web extension');
	await assertReadable(path.join(extensionRoot, 'themes/wimps-dark-color-theme.json'), 'Missing WIMPS color theme');
	await assertReadable(path.join(extensionRoot, 'themes/wimps-file-icon-theme.json'), 'Missing WIMPS file icon theme');
	await assertManifest();

	console.log('WIMPS built-in extension is ready.');
}

main().catch(error => {
	console.error(error.message);
	process.exitCode = 1;
});
