# WIMPS GitHub Pages Deploy

This fork can publish the VS Code web workbench as a GitHub Pages static site for a custom subdomain.

## Local Build

Use the Node version from `.nvmrc`:

```bash
nvm use
npm run install:wimps-cloudflare
WIMPS_GITHUB_PAGES_CNAME="vscode.example.edu" npm run package:wimps-github-pages
```

The GitHub Pages artifact is written to:

```txt
dist/github-pages
```

If `../vscode-web` already exists, regenerate only the GitHub Pages wrapper:

```bash
WIMPS_GITHUB_PAGES_CNAME="vscode.example.edu" npm run prepare:wimps-github-pages
```

`npm run package:wimps-github-pages` copies `~/projects/WIMPS-extension` into the VS Code fork as a generated built-in web extension before packaging. Override the extension source with:

```bash
WIMPS_EXTENSION_DIR="/path/to/WIMPS-extension" WIMPS_GITHUB_PAGES_CNAME="vscode.example.edu" npm run package:wimps-github-pages
```

## GitHub Pages Settings

Use GitHub Pages with a GitHub Actions artifact or publish the contents of:

```txt
dist/github-pages
```

The artifact includes:

- `.nojekyll`, so GitHub Pages serves VS Code's underscored files and nested static assets directly.
- `404.html`, copied from `index.html`, so deep links fall back to the workbench shell.
- `CNAME`, when `WIMPS_GITHUB_PAGES_CNAME` is set.

Do not set a base path when using a custom subdomain. The generated workbench uses root-relative asset URLs and expects to be served from the domain root.

## Custom Domain

Set `WIMPS_GITHUB_PAGES_CNAME` to the subdomain your professor gave you:

```bash
WIMPS_GITHUB_PAGES_CNAME="vscode.example.edu" npm run prepare:wimps-github-pages
```

Then configure DNS for that subdomain according to the GitHub Pages custom domain instructions for your organization.

## Iframe Policy

GitHub Pages does not support Cloudflare-style `_headers`, so this deployment path cannot set a `Content-Security-Policy: frame-ancestors ...` response header from this repo.

That is acceptable when the site is opened directly from the subdomain. If the main site must iframe the workbench and requires a restrictive `frame-ancestors` policy, use a host that can set custom response headers.
