/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outRoot = path.resolve(repoRoot, process.env.WIMPS_GITHUB_PAGES_OUT ?? 'dist/github-pages');
const cname = process.env.WIMPS_GITHUB_PAGES_CNAME?.trim();

function runCloudflarePackager() {
	return new Promise((resolve, reject) => {
		const child = spawn(process.execPath, ['scripts/build-wimps-cloudflare-pages.mjs'], {
			cwd: repoRoot,
			env: {
				...process.env,
				WIMPS_CLOUDFLARE_OUT: outRoot
			},
			stdio: 'inherit'
		});

		child.on('error', reject);
		child.on('exit', code => {
			if (code === 0) {
				resolve();
			} else {
				reject(new Error(`GitHub Pages artifact build failed with exit code ${code}`));
			}
		});
	});
}

async function writeGitHubPagesFiles() {
	await Promise.all([
		fs.rm(path.join(outRoot, '_headers'), { force: true }),
		fs.rm(path.join(outRoot, '_redirects'), { force: true })
	]);

	await fs.writeFile(path.join(outRoot, '.nojekyll'), '');
	await fs.copyFile(path.join(outRoot, 'index.html'), path.join(outRoot, '404.html'));

	if (cname) {
		await fs.writeFile(path.join(outRoot, 'CNAME'), `${cname}\n`);
	}
}

async function main() {
	await runCloudflarePackager();
	await writeGitHubPagesFiles();

	console.log(`GitHub Pages artifact ready: ${path.relative(repoRoot, outRoot)}`);
	if (cname) {
		console.log(`GitHub Pages custom domain: ${cname}`);
	}
}

main().catch(error => {
	console.error(error.message);
	process.exitCode = 1;
});
