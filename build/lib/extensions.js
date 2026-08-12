/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import fs from 'fs';
import path from 'path';

export function isWebExtension(manifest) {
	if (Boolean(manifest.browser)) {
		return true;
	}
	if (Boolean(manifest.main)) {
		return false;
	}
	if (typeof manifest.extensionKind !== 'undefined') {
		const extensionKind = Array.isArray(manifest.extensionKind) ? manifest.extensionKind : [manifest.extensionKind];
		if (extensionKind.indexOf('web') >= 0) {
			return true;
		}
	}
	if (typeof manifest.contributes !== 'undefined') {
		for (const id of ['debuggers', 'terminal', 'typescriptServerPlugins']) {
			if (Object.prototype.hasOwnProperty.call(manifest.contributes, id)) {
				return false;
			}
		}
	}
	return true;
}

export function scanBuiltinExtensions(extensionsRoot, exclude = []) {
	const scannedExtensions = [];
	try {
		const extensionsFolders = fs.readdirSync(extensionsRoot);
		for (const extensionFolder of extensionsFolders) {
			if (exclude.indexOf(extensionFolder) >= 0) {
				continue;
			}
			const packageJSONPath = path.join(extensionsRoot, extensionFolder, 'package.json');
			if (!fs.existsSync(packageJSONPath)) {
				continue;
			}
			const packageJSON = JSON.parse(fs.readFileSync(packageJSONPath).toString('utf8'));
			if (!isWebExtension(packageJSON)) {
				continue;
			}
			const children = fs.readdirSync(path.join(extensionsRoot, extensionFolder));
			const packageNLSPath = children.filter(child => child === 'package.nls.json')[0];
			const packageNLS = packageNLSPath ? JSON.parse(fs.readFileSync(path.join(extensionsRoot, extensionFolder, packageNLSPath)).toString()) : undefined;
			const readme = children.filter(child => /^readme(\.txt|\.md|)$/i.test(child))[0];
			const changelog = children.filter(child => /^changelog(\.txt|\.md|)$/i.test(child))[0];
			scannedExtensions.push({
				extensionPath: extensionFolder,
				packageJSON,
				packageNLS,
				readmePath: readme ? path.join(extensionFolder, readme) : undefined,
				changelogPath: changelog ? path.join(extensionFolder, changelog) : undefined,
			});
		}
		return scannedExtensions;
	} catch {
		return scannedExtensions;
	}
}
