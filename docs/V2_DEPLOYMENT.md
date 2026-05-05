# V2 Deployment

## Current scope

Deployment now has a concrete hosted runbook, but production sends should stay
behind the configured canary policy until a hosted smoke is explicitly approved.

## Local Docker

```bash
cp .env.example .env
docker compose up --build
```

Expected Docker surface:

- Caddy local proxy: `http://127.0.0.1:8080`
- API health through Caddy: `http://127.0.0.1:8080/health`
- Web shell through Caddy: `http://127.0.0.1:8080`

## SSH skeleton

`infra/scripts/deploy.sh` expects:

```bash
export NUOMA_V2_DEPLOY_HOST=user@host
export NUOMA_V2_DEPLOY_PATH=/srv/nuoma-wpp-v2
infra/scripts/deploy.sh
```

Hosted WhatsApp automation remains gated by the Spike 3 hosted-send procedure
from the V1 repo before the worker is allowed to own production sends.

## Hosted runbook

Use [`docs/runbooks/HOSTED_DEPLOYMENT.md`](runbooks/HOSTED_DEPLOYMENT.md) for:

- server directory layout;
- persistent SQLite and Chromium profile volumes;
- `.env.hosted.example`;
- initial QR through CDP screenshot + SSH tunnel;
- smoke checks;
- backup, restore and session recovery.
