#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "$0")"

if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
	# shellcheck source=/dev/null
	source "${HOME}/.nvm/nvm.sh"
	nvm use
fi

npm run install:wimps
WIMPS_GITHUB_PAGES_CNAME="${WIMPS_GITHUB_PAGES_CNAME:-code.wimps.dev}" npm run package:wimps-github-pages
