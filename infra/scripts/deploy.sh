#!/usr/bin/env bash
set -euo pipefail

: "${NUOMA_V2_DEPLOY_HOST:?Set NUOMA_V2_DEPLOY_HOST, for example user@host}"
: "${NUOMA_V2_DEPLOY_PATH:=/srv/nuoma-wpp-v2}"
: "${NUOMA_V2_REMOTE_NPM_BUILD:=false}"

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
SSH_ARGS=()
if [[ -n "${NUOMA_V2_SSH_KEY:-}" ]]; then
  SSH_ARGS=(-i "$NUOMA_V2_SSH_KEY")
fi
SSH_CMD=(ssh "${SSH_ARGS[@]}")
RSYNC_RSH="ssh"
if [[ ${#SSH_ARGS[@]} -gt 0 ]]; then
  RSYNC_RSH="ssh ${SSH_ARGS[*]}"
fi

cd "$ROOT_DIR"
npm ci
npm run typecheck
npm run build

"${SSH_CMD[@]}" "$NUOMA_V2_DEPLOY_HOST" "sudo mkdir -p '$NUOMA_V2_DEPLOY_PATH/data' && sudo chown -R \"\$USER:\$USER\" '$NUOMA_V2_DEPLOY_PATH'"

rsync -az --delete \
  -e "$RSYNC_RSH" \
  --exclude node_modules \
  --exclude .git \
  --exclude .env \
  --exclude data \
  --exclude .turbo \
  "$ROOT_DIR/" "$NUOMA_V2_DEPLOY_HOST:$NUOMA_V2_DEPLOY_PATH/"

if [[ "$NUOMA_V2_REMOTE_NPM_BUILD" == "true" ]]; then
  "${SSH_CMD[@]}" "$NUOMA_V2_DEPLOY_HOST" "cd '$NUOMA_V2_DEPLOY_PATH' && npm ci && npm run build"
fi
