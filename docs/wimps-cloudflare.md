# WIMPS Cloudflare Deploy

This fork builds the VS Code web workbench for `vscode.wimps.dev`, so the main WIMPS app can iframe it from `https://wimps.dev/ide`.

## Local Build

Use the Node version from `.nvmrc`:

```bash
nvm use
npm run install:wimps-cloudflare
npm run package:wimps-cloudflare
```

`npm run package:wimps-cloudflare` builds the vendored WIMPS extension in `extensions/wimps-vscode` before packaging it as a built-in web extension.

The Cloudflare Pages artifact is written to:

```txt
dist/cloudflare-pages
```

If `../vscode-web` already exists, regenerate only the Cloudflare wrapper:

```bash
npm run prepare:wimps-cloudflare
```

## Cloudflare Pages

Set the Pages build command:

```bash
npm run package:wimps-cloudflare
```

Set the Pages install command:

```bash
npm run install:wimps-cloudflare
```

Set the output directory:

```txt
dist/cloudflare-pages
```

`wrangler.toml` already points at this directory, so manual deploy also works:

```bash
npx wrangler pages deploy dist/cloudflare-pages
```

Point the custom domain at:

```txt
vscode.wimps.dev
```

Then set WIMPS frontend env:

```txt
VITE_VSCODE_WEB_URL=https://vscode.wimps.dev/
```

## Iframe Policy

The build writes `_headers` with:

```http
Content-Security-Policy: frame-ancestors 'self' https://wimps-vscode.pages.dev https://vscode.wimps.dev https://wimps.dev https://www.wimps.dev http://localhost:5173
```

Override allowed parents with:

```bash
WIMPS_FRAME_ANCESTORS="'self' https://vscode.wimps.dev https://wimps.dev https://preview.wimps.dev" npm run prepare:wimps-cloudflare
```

Keep `'self'` in the list. VS Code Web starts its browser extension host inside an internal iframe on the VS Code origin; without `'self'`, commands can hang on `Activating Extensions...`.

Do not add `X-Frame-Options: DENY` or `X-Frame-Options: SAMEORIGIN` on Cloudflare.

## Current Limits

This artifact is iframe-ready and preloads the WIMPS web extension plus its `WIMPS Dark` color theme and `wimps-assembly-icons` file icon theme. It is not yet WIMPS-account-aware.

Current storage:

- The default workspace opens at `vscode-userdata:/workspace`, backed by IndexedDB on `vscode.wimps.dev`.
- VS Code settings and user data use IndexedDB on `vscode.wimps.dev`.
- Browser file access uses the browser File System Access API when available.
- WIMPS account sync needs a custom file-system provider backed by IndexedDB and the WIMPS backend.

Override the default browser workspace path with:

```bash
WIMPS_WORKSPACE_FOLDER_PATH="/workspace" npm run prepare:wimps-cloudflare
```

Next work:

1. Add a `wimps://` file-system provider.
2. Bridge WIMPS auth into the iframe with `postMessage` and short-lived API tokens.
