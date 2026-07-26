# WIMPS Cloudflare Deploy

This fork builds the VS Code web workbench for `vscode.wimps.dev`, so the main WIMPS app can iframe it from `https://wimps.dev/ide`.

## Local Build

Use the Node version from `.nvmrc`:

```bash
nvm use
npm run install:wimps-cloudflare
npm run package:wimps-cloudflare
```

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
Content-Security-Policy: frame-ancestors https://wimps.dev https://www.wimps.dev http://localhost:5173
```

Override allowed parents with:

```bash
WIMPS_FRAME_ANCESTORS="https://wimps.dev https://preview.wimps.dev" npm run prepare:wimps-cloudflare
```

Do not add `X-Frame-Options: DENY` or `X-Frame-Options: SAMEORIGIN` on Cloudflare.

## Current Limits

This artifact is iframe-ready, but it is not yet WIMPS-account-aware.

Current storage:

- VS Code settings and user data use IndexedDB on `vscode.wimps.dev`.
- Browser file access uses the browser File System Access API when available.
- WIMPS account sync needs a custom file-system provider backed by IndexedDB and the WIMPS backend.

Next work:

1. Bundle `~/projects/WIMPS-extension` as a built-in web extension.
2. Add a `wimps://` file-system provider.
3. Bridge WIMPS auth into the iframe with `postMessage` and short-lived API tokens.
