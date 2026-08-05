/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { constants } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoot = path.resolve(repoRoot, process.env.WIMPS_VSCODE_WEB_SOURCE ?? '../vscode-web');
const outRoot = path.resolve(repoRoot, process.env.WIMPS_CLOUDFLARE_OUT ?? 'dist/cloudflare-pages');
const allowedFrameAncestors = (process.env.WIMPS_FRAME_ANCESTORS ?? "'self' https://wimps-vscode.pages.dev https://vscode.wimps.dev https://wimps.dev https://www.wimps.dev http://localhost:5173").trim();
const callbackRoute = process.env.WIMPS_CALLBACK_ROUTE ?? '/callback';
const assetBaseUrl = process.env.WIMPS_WEB_BASE_URL ?? '';
const workspaceFolderPath = process.env.WIMPS_WORKSPACE_FOLDER_PATH ?? '/WIMPS';
const wimpsLogoDataUri = 'data:image/svg+xml,%3Csvg width%3D%2232%22 height%3D%2232%22 viewBox%3D%220 0 32 32%22 xmlns%3D%22http%3A//www.w3.org/2000/svg%22%3E%3Crect width%3D%2232%22 height%3D%2232%22 rx%3D%227%22 fill%3D%22%230f172a%22/%3E%3Crect x%3D%229%22 y%3D%229%22 width%3D%2214%22 height%3D%2214%22 rx%3D%222%22 fill%3D%22%232563eb%22/%3E%3Crect x%3D%224%22 y%3D%2211%22 width%3D%225%22 height%3D%223%22 rx%3D%221%22 fill%3D%22%2360a5fa%22/%3E%3Crect x%3D%224%22 y%3D%2218%22 width%3D%225%22 height%3D%223%22 rx%3D%221%22 fill%3D%22%2360a5fa%22/%3E%3Crect x%3D%2223%22 y%3D%2211%22 width%3D%225%22 height%3D%223%22 rx%3D%221%22 fill%3D%22%2360a5fa%22/%3E%3Crect x%3D%2223%22 y%3D%2218%22 width%3D%225%22 height%3D%223%22 rx%3D%221%22 fill%3D%22%2360a5fa%22/%3E%3Crect x%3D%2211%22 y%3D%224%22 width%3D%223%22 height%3D%225%22 rx%3D%221%22 fill%3D%22%2360a5fa%22/%3E%3Crect x%3D%2218%22 y%3D%224%22 width%3D%223%22 height%3D%225%22 rx%3D%221%22 fill%3D%22%2360a5fa%22/%3E%3Crect x%3D%2211%22 y%3D%2223%22 width%3D%223%22 height%3D%225%22 rx%3D%221%22 fill%3D%22%2360a5fa%22/%3E%3Crect x%3D%2218%22 y%3D%2223%22 width%3D%223%22 height%3D%225%22 rx%3D%221%22 fill%3D%22%2360a5fa%22/%3E%3Crect x%3D%2213%22 y%3D%2213%22 width%3D%226%22 height%3D%226%22 rx%3D%221%22 fill%3D%22white%22 opacity%3D%220.92%22/%3E%3C/svg%3E';

function asHtmlAttributeJson(value) {
	return JSON.stringify(value).replace(/"/g, '&quot;');
}

function withWimpsBranding(indexHtml) {
	const style = `
	<style id="wimps-code-branding">
		.monaco-workbench .part.titlebar > .titlebar-container > .titlebar-left > .window-appicon:not(.codicon) {
			align-items: center;
			background-image: url("${wimpsLogoDataUri}") !important;
			background-position: 8px center !important;
			background-repeat: no-repeat !important;
			background-size: 18px 18px !important;
			color: var(--vscode-titleBar-activeForeground);
			display: inline-flex;
			font-size: 12px;
			font-weight: 800;
			height: 100%;
			line-height: 1;
			width: 84px;
		}

		.monaco-workbench .part.titlebar.inactive > .titlebar-container > .titlebar-left > .window-appicon:not(.codicon) {
			color: var(--vscode-titleBar-inactiveForeground);
		}

		.monaco-workbench .part.titlebar > .titlebar-container > .titlebar-left > .window-appicon:not(.codicon)::after {
			content: "WIMPS";
			margin-left: 32px;
		}
	</style>`;

	return indexHtml.replace('</head>', `${style}\n</head>`);
}

async function assertReadable(filePath, message) {
	try {
		await fs.access(filePath, constants.R_OK);
	} catch (error) {
		throw new Error(`${message}: ${filePath}\nRun 'npm run gulp vscode-web-min-ci' first.`, { cause: error });
	}
}

async function readWimpsColorTheme() {
	const themePath = path.join(repoRoot, 'extensions/wimps-vscode/themes/wimps-dark-color-theme.json');
	try {
		const theme = JSON.parse(await fs.readFile(themePath, 'utf8'));
		return theme.colors ?? {};
	} catch {
		return {};
	}
}

async function writeCloudflareFiles() {
	const headers = [
		'/*',
		`  Content-Security-Policy: frame-ancestors ${allowedFrameAncestors}`,
		'  X-Content-Type-Options: nosniff',
		'  Referrer-Policy: strict-origin-when-cross-origin',
		'',
	].join('\n');

	const redirects = [
		'/node_modules/vscode-oniguruma/* /vendor/vscode-oniguruma/:splat 200',
		'/node_modules/vscode-textmate/* /vendor/vscode-textmate/:splat 200',
		'/callback /callback.html 200',
		'/* /index.html 200',
		'',
	].join('\n');

	await fs.writeFile(path.join(outRoot, '_headers'), headers);
	await fs.writeFile(path.join(outRoot, '_redirects'), redirects);
}

async function writeLicenseNotices() {
	const noticeFiles = [
		'LICENSE.txt',
		'ThirdPartyNotices.txt',
	];

	for (const file of noticeFiles) {
		await fs.copyFile(path.join(repoRoot, file), path.join(outRoot, file));
	}
}

async function copyPreparedWimpsExtension() {
	const source = path.join(repoRoot, 'extensions/wimps-vscode');
	const destination = path.join(outRoot, 'extensions/wimps-vscode');
	const runtimeEntries = [
		'package.json',
		'LICENSE',
		'resources',
		'syntaxes',
		'themes',
		'examples',
	];
	const runtimeOutFiles = [
		'extension.js',
		'extension-web.js',
		'extension.js.map',
		'extension-web.js.map',
	];

	await assertReadable(path.join(source, 'package.json'), 'Missing prepared WIMPS built-in extension');
	await fs.rm(destination, { recursive: true, force: true });
	await fs.mkdir(destination, { recursive: true });

	for (const entry of runtimeEntries) {
		const sourceEntry = path.join(source, entry);
		const destinationEntry = path.join(destination, entry);
		try {
			await fs.access(sourceEntry, constants.R_OK);
		} catch {
			continue;
		}
		await fs.cp(sourceEntry, destinationEntry, { recursive: true, dereference: true });
	}

	await fs.mkdir(path.join(destination, 'out'), { recursive: true });
	for (const file of runtimeOutFiles) {
		const sourceFile = path.join(source, 'out', file);
		try {
			await fs.access(sourceFile, constants.R_OK);
		} catch {
			continue;
		}
		await fs.copyFile(sourceFile, path.join(destination, 'out', file));
	}

	const manifestPath = path.join(destination, 'package.json');
	const manifest = JSON.parse(await fs.readFile(manifestPath, 'utf8'));
	delete manifest.private;
	delete manifest.scripts;
	delete manifest.devDependencies;
	delete manifest.dependencies;
	await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function copyTextMateRuntimeAssets() {
	const vendorRoot = path.join(outRoot, 'vendor');
	const assets = [
		['node_modules/vscode-oniguruma/release/main.js', 'vendor/vscode-oniguruma/release/main.js'],
		['node_modules/vscode-oniguruma/release/onig.wasm', 'vendor/vscode-oniguruma/release/onig.wasm'],
		['node_modules/vscode-textmate/release/main.js', 'vendor/vscode-textmate/release/main.js'],
	];

	await fs.mkdir(vendorRoot, { recursive: true });
	for (const [source, target] of assets) {
		const sourcePath = path.join(outRoot, source);
		const targetPath = path.join(outRoot, target);
		await assertReadable(sourcePath, 'Missing TextMate runtime asset');
		await fs.mkdir(path.dirname(targetPath), { recursive: true });
		await fs.copyFile(sourcePath, targetPath);
	}
}

async function patchTextMateRuntimePaths() {
	const replacements = [
		['../node_modules/vscode-oniguruma/release/main.js', '../vendor/vscode-oniguruma/release/main.js'],
		['../node_modules/vscode-textmate/release/main.js', '../vendor/vscode-textmate/release/main.js'],
		['../node_modules/vscode-oniguruma/release/onig.wasm', '../vendor/vscode-oniguruma/release/onig.wasm'],
		['/node_modules/vscode-oniguruma/release/onig.wasm', '/vendor/vscode-oniguruma/release/onig.wasm'],
		['node_modules/vscode-oniguruma/release/onig.wasm', 'vendor/vscode-oniguruma/release/onig.wasm'],
	];

	const candidates = [
		path.join(outRoot, 'out/vs/code/browser/workbench/workbench.js'),
		path.join(outRoot, 'out/vs/workbench/workbench.web.main.internal.js'),
		path.join(outRoot, 'out/vs/workbench/services/textMate/browser/backgroundTokenization/worker/textMateTokenizationWorker.workerMain.js'),
	];

	for (const file of candidates) {
		try {
			let content = await fs.readFile(file, 'utf8');
			const original = content;
			for (const [from, to] of replacements) {
				content = content.split(from).join(to);
			}
			if (content !== original) {
				await fs.writeFile(file, content);
			}
		} catch {
			// Some builds do not emit every candidate file.
		}
	}
}

async function writeStaticWorkbench() {
	const workbenchTemplatePath = path.join(outRoot, 'out/vs/code/browser/workbench/workbench.html');
	const callbackPath = path.join(outRoot, 'out/vs/code/browser/workbench/callback.html');
	const workbenchShellScriptPath = path.join(outRoot, 'out/vs/code/browser/workbench/workbench.js');
	const workbenchShellStylePath = path.join(outRoot, 'out/vs/code/browser/workbench/workbench.css');

	await assertReadable(workbenchTemplatePath, 'Missing web workbench template');

	const wimpsThemeColors = await readWimpsColorTheme();
	const workbenchWebConfiguration = {
		callbackRoute,
		enableWorkspaceTrust: false,
		folderUri: {
			scheme: 'vscode-userdata',
			authority: '',
			path: workspaceFolderPath,
			query: '',
			fragment: ''
		},
		configurationDefaults: {
			'chat.agentFilesLocations': {
				'.github/agents': false,
				'.claude/agents': false,
				'~/.copilot/agents': false,
				'~/.claude/agents': false
			},
			'chat.agentSkillsLocations': {
				'.agents/skills': false,
				'.github/skills': false,
				'.claude/skills': false,
				'~/.agents/skills': false,
				'~/.copilot/skills': false,
				'~/.claude/skills': false
			},
			'chat.hookFilesLocations': {
				'.github/hooks': false,
				'.claude/settings.local.json': false,
				'.claude/settings.json': false,
				'~/.copilot/hooks': false,
				'~/.claude/settings.json': false
			},
			'chat.instructionsFilesLocations': {
				'.github/instructions': false,
				'.claude/rules': false,
				'~/.copilot/instructions': false,
				'~/.claude/rules': false
			},
			'workbench.colorTheme': 'WIMPS Dark',
			'workbench.iconTheme': 'wimps-assembly-icons',
			'workbench.startupEditor': 'none',
			'explorer.compactFolders': false,
			'window.title': '${activeEditorShort}${separator}WIMPS Code',
			'window.titleSeparator': ' - '
		},
		initialColorTheme: {
			themeType: 'dark',
			colors: wimpsThemeColors
		},
		developmentOptions: {},
		productConfiguration: {
			nameShort: 'WIMPS Code',
			nameLong: 'WIMPS Code',
			applicationName: 'wimps-code',
			extensionsGallery: undefined,
			settingsSyncUrl: undefined,
			updateUrl: undefined,
			enableTelemetry: false
		}
	};

	const replacements = new Map([
		['WORKBENCH_WEB_CONFIGURATION', asHtmlAttributeJson(workbenchWebConfiguration)],
		['WORKBENCH_AUTH_SESSION', ''],
		['WORKBENCH_WEB_BASE_URL', assetBaseUrl],
		['WORKBENCH_NLS_URL', ''],
		['WORKBENCH_NLS_FALLBACK_URL', `${assetBaseUrl}/out/nls.messages.js`.replace(/^\/\//, '/')]
	]);

	const template = await fs.readFile(workbenchTemplatePath, 'utf8');
	let indexHtml = template
		.replace(/\{\{([^}]+)\}\}/g, (match, key) => replacements.get(key) ?? match)
		.replace('/resources/server/code-192.png', '/code-192.png')
		.replace('/resources/server/favicon.ico', '/favicon.ico')
		.replace('/resources/server/manifest.json', '/manifest.json');

	try {
		await Promise.all([
			fs.access(workbenchShellScriptPath, constants.R_OK),
			fs.access(workbenchShellStylePath, constants.R_OK)
		]);
	} catch {
		indexHtml = indexHtml
			.replace('/out/vs/code/browser/workbench/workbench.css', '/out/vs/workbench/workbench.web.main.internal.css')
			.replace('/out/vs/code/browser/workbench/workbench.js', '/out/vs/workbench/workbench.web.main.internal.js');
	}

	indexHtml = withWimpsBranding(indexHtml);

	await fs.writeFile(path.join(outRoot, 'index.html'), indexHtml);

	try {
		await fs.copyFile(callbackPath, path.join(outRoot, 'callback.html'));
	} catch {
		// Callback support is optional for the current WIMPS embed flow.
	}
}

async function main() {
	await assertReadable(sourceRoot, 'Missing VS Code web package');

	await fs.rm(outRoot, { recursive: true, force: true });
	await fs.mkdir(path.dirname(outRoot), { recursive: true });
	await fs.cp(sourceRoot, outRoot, { recursive: true, dereference: true });

	await copyPreparedWimpsExtension();
	await copyTextMateRuntimeAssets();
	await patchTextMateRuntimePaths();
	await writeStaticWorkbench();
	await writeCloudflareFiles();
	await writeLicenseNotices();

	console.log(`Cloudflare Pages artifact ready: ${path.relative(repoRoot, outRoot)}`);
	console.log(`Allowed frame ancestors: ${allowedFrameAncestors}`);
}

main().catch(error => {
	console.error(error.message);
	process.exitCode = 1;
});
