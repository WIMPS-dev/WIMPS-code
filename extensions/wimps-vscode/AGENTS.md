# Repository Guidelines

## Project Structure & Module Organization

This repository contains the native VS Code extension for WIMPS. Core extension logic lives in `src/extension.ts`, including simulator integration, commands, webview view providers, diagnostics, and the debug adapter. Extension contribution metadata is declared in `package.json`. MIPS syntax highlighting lives in `syntaxes/mips.tmLanguage.json`, the bundled theme in `themes/wimps-dark-color-theme.json`, and command/view icons in `resources/`. Compiled output goes to `out/` and must stay generated.

## Build, Test, and Development Commands

- `npm install`: install extension dependencies.
- `npm run compile`: compile TypeScript into `out/`.
- `npm run watch`: run TypeScript in watch mode during extension development.
- `npm run build`: same as compile; intended prepackage check.

For manual testing, open this folder in VS Code and launch **Run WIMPS Extension** from `.vscode/launch.json`. Test with `.asm` or `.s` files.

## Coding Style & Naming Conventions

Use TypeScript with strict mode from `tsconfig.json`. Keep code in `src/extension.ts` organized by responsibility: simulator state, command handlers, debug adapter, view providers, render helpers. Use two-space indentation. Prefer explicit union types for simulator states and command modes, for example `InputKind` or `RunResult`. VS Code command IDs use the `wimps.*` prefix.

## Testing Guidelines

There is no automated test suite yet. Validation is manual plus `npm run compile`. For behavior changes, test assemble, run, continue, step, reset, diagnostics, debug launch, breakpoints, input syscalls, and side views for registers, memory, bitmap, program, and analysis. Include at least one valid `.asm`, one invalid assembly file, and one non-assembly file when checking activation/context behavior.

## Commit & Pull Request Guidelines

No local git history is available yet, so use conventional commits like `fix: handle read syscalls`. Never co-author commits or list yourself as a contributor, all commits should be under the user's name.

## Security & Configuration Tips

Do not commit `node_modules/`, `out/`, `.vsix` packages, logs, or `.env` files. Keep generated files out of review unless packaging specifically requires them. If `@specy/mips` behavior diverges from the browser WIMPS app, compare dependency versions and any patches used by the main WIMPS repo.
