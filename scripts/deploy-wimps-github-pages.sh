#!/usr/bin/env bash
set -euo pipefail

DOMAIN="${WIMPS_GITHUB_PAGES_CNAME:-code.wimps.dev}"
NODE_VERSION="${WIMPS_NODE_VERSION:-24.18.0}"

cd "$(dirname "$0")/.."

if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
	# shellcheck source=/dev/null
	source "${HOME}/.nvm/nvm.sh"
	nvm use "${NODE_VERSION}"
fi

npm run install:wimps
WIMPS_GITHUB_PAGES_CNAME="${DOMAIN}" npm run package:wimps-github-pages

deploy_dir="$(mktemp -d)"
cleanup() {
	git worktree remove --force "${deploy_dir}" >/dev/null 2>&1 || true
}
trap cleanup EXIT

git fetch origin gh-pages
git worktree add --detach "${deploy_dir}" origin/gh-pages
rsync -a --delete --exclude .git dist/github-pages/ "${deploy_dir}/"

git -C "${deploy_dir}" add -A
if git -C "${deploy_dir}" diff --cached --quiet; then
	echo "GitHub Pages artifact is already up to date."
	exit 0
fi

git -C "${deploy_dir}" commit -m "Deploy Github Pages"
git -C "${deploy_dir}" push origin HEAD:gh-pages --force-with-lease
