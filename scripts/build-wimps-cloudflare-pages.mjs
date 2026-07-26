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
const allowedFrameAncestors = (process.env.WIMPS_FRAME_ANCESTORS ?? 'https://wimps.dev https://www.wimps.dev http://localhost:5173').trim();
const callbackRoute = process.env.WIMPS_CALLBACK_ROUTE ?? '/callback';
const assetBaseUrl = process.env.WIMPS_WEB_BASE_URL ?? '';

function asHtmlAttributeJson(value) {
	return JSON.stringify(value).replace(/"/g, '&quot;');
}

async function assertReadable(filePath, message) {
	try {
		await fs.access(filePath, constants.R_OK);
	} catch (error) {
		throw new Error(`${message}: ${filePath}\nRun 'npm run gulp vscode-web-min-ci' first.`, { cause: error });
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
		'/callback /callback.html 200',
		'/* /index.html 200',
		'',
	].join('\n');

	await fs.writeFile(path.join(outRoot, '_headers'), headers);
	await fs.writeFile(path.join(outRoot, '_redirects'), redirects);
}

async function writeStaticWorkbench() {
	const workbenchTemplatePath = path.join(outRoot, 'out/vs/code/browser/workbench/workbench.html');
	const callbackPath = path.join(outRoot, 'out/vs/code/browser/workbench/callback.html');
	const workbenchShellScriptPath = path.join(outRoot, 'out/vs/code/browser/workbench/workbench.js');
	const workbenchShellStylePath = path.join(outRoot, 'out/vs/code/browser/workbench/workbench.css');

	await assertReadable(workbenchTemplatePath, 'Missing web workbench template');

	const workbenchWebConfiguration = {
		callbackRoute,
		enableWorkspaceTrust: false,
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
			}
		},
		developmentOptions: {},
		productConfiguration: {
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

	await writeStaticWorkbench();
	await writeCloudflareFiles();

	console.log(`Cloudflare Pages artifact ready: ${path.relative(repoRoot, outRoot)}`);
	console.log(`Allowed frame ancestors: ${allowedFrameAncestors}`);
}

main().catch(error => {
	console.error(error.message);
	process.exitCode = 1;
});
