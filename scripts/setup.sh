#!/usr/bin/env bash
# One-step setup for Linux, macOS and WSL. Safe to run again.
set -euo pipefail
cd "$(dirname "$0")/.."

need_major=20; need_minor=19
if ! command -v node >/dev/null; then echo "Node.js is not installed. Install Node 22 (https://nodejs.org or nvm), then rerun."; exit 1; fi
IFS=. read -r major minor _ <<<"$(node -p 'process.versions.node')"
if (( major < need_major || (major == need_major && minor < need_minor) )); then
  echo "Node $(node -v) is too old; Scriptorium needs 20.19 or newer (nvm install 22)."; exit 1
fi

npm ci
if [ ! -d .venv ]; then python3 -m venv .venv; fi
./.venv/bin/python -m pip install --quiet -r requirements.txt
npm run demo
echo
echo "Done. Equation checks: npm run test:equations"
