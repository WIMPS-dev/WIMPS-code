#!/usr/bin/env bash
set -euo pipefail

PROJECT_NAME="${WIMPS_CLOUDFLARE_PROJECT:-wimps-vscode}"
NODE_VERSION="${WIMPS_NODE_VERSION:-24.18.0}"

cd "$(dirname "$0")/.."

if [[ -s "${HOME}/.nvm/nvm.sh" ]]; then
	# shellcheck source=/dev/null
	source "${HOME}/.nvm/nvm.sh"
	nvm use "${NODE_VERSION}"
else
	echo "Missing nvm at ${HOME}/.nvm/nvm.sh"
	echo "Install/use Node ${NODE_VERSION}, then rerun this script."
	exit 1
fi

npm run package:wimps-cloudflare

if ! npx wrangler whoami >/dev/null 2>&1; then
	npx wrangler login
fi

npx wrangler pages deploy dist/cloudflare-pages --project-name="${PROJECT_NAME}"
