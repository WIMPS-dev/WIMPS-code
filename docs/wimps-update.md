# WIMPS Code Update Checklist

Use this checklist whenever source code changes in `wimps-dev/wimps-code`.

## One-Time Repository Settings

GitHub Pages should serve `gh-pages` from the repository root with the custom domain:

```txt
code.wimps.dev
```

No separate WIMPS extension checkout is required. The built-in extension source lives in `extensions/wimps-vscode`.

## Every Update

```bash
git fetch origin
git pull --ff-only origin main
npm run deploy:wimps-github-pages
```

This builds the VS Code web artifact, builds the vendored WIMPS extension, writes `dist/github-pages`, and pushes the generated site to `gh-pages`.

## Before Pushing Source

Do not commit `dist/` or generated `extensions/**/out/` files. Do commit source changes that are required to reproduce the artifact, including build scripts, docs, `extensions/wimps-vscode/`, and built-in extension sources such as `extensions/riscv/`.
