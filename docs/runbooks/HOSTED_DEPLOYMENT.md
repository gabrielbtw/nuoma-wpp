# Hosted Deployment Runbook

Runbook para subir a V2 em servidor mantendo o mesmo SQLite e a mesma sessão do
WhatsApp entre deploys, restarts e troca de máquina local.

## Premissas

- Servidor Linux com Docker Compose.
- Diretório remoto padrão: `/srv/nuoma-wpp-v2`.
- O diretório `data/` é persistente e não entra no `rsync --delete`.
- O WhatsApp Web roda por browser automation, sem API oficial da Meta.
- Em modo de teste, envio real continua restrito a `5531982066263`.

## Estrutura persistente

No servidor:

```bash
sudo mkdir -p /srv/nuoma-wpp-v2/data/chromium-profile/whatsapp
sudo mkdir -p /srv/nuoma-wpp-v2/data/tmp
sudo mkdir -p /srv/nuoma-wpp-v2/data/backups
sudo chown -R "$USER:$USER" /srv/nuoma-wpp-v2
```

Arquivos que não podem ser apagados em deploy comum:

- `/srv/nuoma-wpp-v2/data/nuoma-v2.db`
- `/srv/nuoma-wpp-v2/data/nuoma-v2.db-wal`
- `/srv/nuoma-wpp-v2/data/nuoma-v2.db-shm`
- `/srv/nuoma-wpp-v2/data/chromium-profile/whatsapp/`
- `/srv/nuoma-wpp-v2/data/media-assets/`

## Primeiro deploy

Na máquina local:

```bash
cd /Users/gabrielbraga/Projetos/nuoma-wpp-v2
export NUOMA_V2_DEPLOY_HOST=ubuntu@3.149.108.173
export NUOMA_V2_DEPLOY_PATH=/srv/nuoma-wpp-v2
export NUOMA_V2_SSH_KEY=/Users/gabrielbraga/Projetos/GabsProjects.pem
export NUOMA_V2_REMOTE_NPM_BUILD=false
infra/scripts/deploy.sh
```

No servidor:

```bash
cd /srv/nuoma-wpp-v2
cp .env.hosted.example .env
nano .env
```

Valores obrigatórios para hosted:

```bash
NODE_ENV=production
API_HOST=0.0.0.0
DATABASE_URL=/app/data/nuoma-v2.db
WORKER_BROWSER_ENABLED=true
WORKER_KEEP_BROWSER_OPEN=false
WORKER_SYNC_ENABLED=true
WORKER_SEND_REUSE_OPEN_CHAT_ENABLED=false
CHROMIUM_PROFILE_DIR=/app/data/chromium-profile/whatsapp
CHROMIUM_CDP_HOST=127.0.0.1
CHROMIUM_CDP_BIND_HOST=0.0.0.0
CHROMIUM_CDP_PORT=9223
API_SEND_POLICY_MODE=test
API_SEND_ALLOWED_PHONES=5531982066263
WA_SEND_POLICY_MODE=test
WA_SEND_ALLOWED_PHONES=5531982066263
```

Depois:

```bash
NUOMA_ENV_FILE=.env.hosted.example docker compose config >/tmp/nuoma-compose.txt
docker compose up -d --build
docker compose ps
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
curl -fsS http://127.0.0.1:8080/health
```

Em Docker hosted, `WORKER_KEEP_BROWSER_OPEN=false` é o modo recomendado: o
worker controla o ciclo do Chromium e a sessão sobrevive porque o profile fica
no volume persistido `data/chromium-profile/whatsapp`. O worker remove apenas
locks órfãos de Chromium (`Singleton*`/`DevToolsActivePort`) antes de reabrir o
profile; ele não apaga cookies, IndexedDB nem dados da sessão.

API e Web não publicam `3001`/`3002` no host em Docker hosted; o acesso externo
passa pelo Caddy em `8080`. O CDP fica publicado apenas em
`127.0.0.1:9223` para túnel SSH.

## QR inicial

O caminho mais estável é gerar a screenshot dentro do container do worker, onde
o CDP fica disponível em `127.0.0.1:9223`:

```bash
ssh -i /Users/gabrielbraga/Projetos/GabsProjects.pem ubuntu@3.149.108.173
cd /srv/nuoma-wpp-v2
docker compose exec -T worker \
  node infra/scripts/cdp-screenshot.mjs data/hosted-whatsapp-screen.png
```

Depois baixe a imagem para a máquina local:

```bash
scp -i /Users/gabrielbraga/Projetos/GabsProjects.pem \
  ubuntu@3.149.108.173:/srv/nuoma-wpp-v2/data/hosted-whatsapp-screen.png \
  /Users/gabrielbraga/Projetos/nuoma-wpp-v2/data/hosted-whatsapp-screen.png
open data/hosted-whatsapp-screen.png
```

Escaneie o QR pelo celular. Se o QR expirar, rode o comando de screenshot de
novo. Quando o login concluir, gere outra screenshot e confirme que o WhatsApp
mostra a lista de conversas, não a tela de QR.

## Smoke sem envio

No servidor:

```bash
cd /srv/nuoma-wpp-v2
curl -fsS http://127.0.0.1:8080/health
sqlite3 data/nuoma-v2.db \
  "select worker_id,status,browser_connected,last_error from worker_state order by worker_id;"
sqlite3 data/nuoma-v2.db \
  "select status,count(*) from jobs where status in ('queued','claimed','running') group by status;"
```

Resultado esperado:

- API com `ok:true`.
- Worker `idle` ou `busy`.
- `browser_connected=1`.
- Sem `last_error`.
- Sem fila ativa inesperada.

## Smoke com envio controlado

Só execute quando quiser validar envio real no hosted. Antes, confirme:

```bash
grep -E '^(API_SEND_POLICY_MODE|API_SEND_ALLOWED_PHONES|WA_SEND_POLICY_MODE|WA_SEND_ALLOWED_PHONES)=' .env
```

Em modo teste, os dois allowlists precisam conter apenas o número canário:

```bash
API_SEND_POLICY_MODE=test
API_SEND_ALLOWED_PHONES=5531982066263
WA_SEND_POLICY_MODE=test
WA_SEND_ALLOWED_PHONES=5531982066263
```

Para campanhas automáticas no hosted, use a Opção A confirmada: o scheduler
roda dentro da API. Ative somente quando quiser que campanhas `running` ou
`scheduled` gerem jobs periodicamente:

```bash
API_CAMPAIGN_SCHEDULER_ENABLED=true
API_CAMPAIGN_SCHEDULER_INTERVAL_MS=30000
API_CAMPAIGN_SCHEDULER_USER_ID=1
```

Depois crie ou dispare um job pelo painel/API usando somente
`5531982066263`. Nunca use um número diferente para smoke hosted.

## Deploys seguintes

Na máquina local:

```bash
cd /Users/gabrielbraga/Projetos/nuoma-wpp-v2
NUOMA_V2_DEPLOY_HOST=ubuntu@3.149.108.173 \
NUOMA_V2_DEPLOY_PATH=/srv/nuoma-wpp-v2 \
NUOMA_V2_SSH_KEY=/Users/gabrielbraga/Projetos/GabsProjects.pem \
NUOMA_V2_REMOTE_NPM_BUILD=false \
  infra/scripts/deploy.sh
```

No servidor:

```bash
cd /srv/nuoma-wpp-v2
docker compose ps --format 'table {{.Name}}\t{{.Status}}'
curl -fsS http://127.0.0.1:8080/health
docker compose logs --tail=100 api worker
```

O deploy não apaga `data/`; a sessão do WhatsApp deve sobreviver porque o
perfil fica em `/srv/nuoma-wpp-v2/data/chromium-profile/whatsapp`.

`infra/scripts/deploy.sh` executa `npm ci`, `npm run typecheck`, `npm test`,
`npm run build`, sincroniza o código, sobe `docker compose up -d --build` por
padrão e valida `http://127.0.0.1:8080/health` por até 60 segundos. Para apenas
sincronizar arquivos sem subir o Compose, use:

```bash
NUOMA_V2_REMOTE_COMPOSE_UP=false infra/scripts/deploy.sh
```

Se o health check pós-deploy falhar, o script imprime `docker compose ps` e os
últimos logs de `api`, `web`, `worker` e `caddy`, sem apagar `data/`.

## Backup e restore

Backup consistente do SQLite no servidor:

```bash
cd /srv/nuoma-wpp-v2
mkdir -p data/backups
sqlite3 data/nuoma-v2.db \
  ".backup 'data/backups/nuoma-v2-$(date +%Y%m%d-%H%M%S).db'"
tar -czf "data/backups/chromium-profile-$(date +%Y%m%d-%H%M%S).tar.gz" \
  -C data chromium-profile/whatsapp
```

Restore:

```bash
cd /srv/nuoma-wpp-v2
docker compose stop api worker
cp data/backups/nuoma-v2-YYYYMMDD-HHMMSS.db data/nuoma-v2.db
tar -xzf data/backups/chromium-profile-YYYYMMDD-HHMMSS.tar.gz -C data
docker compose up -d api worker
```

## Recuperação de sessão

Se o WhatsApp pedir QR de novo:

1. Não apague `data/chromium-profile/whatsapp`.
2. Faça backup de `data/nuoma-v2.db` e do profile atual.
3. Reinicie só o worker:

```bash
docker compose restart worker
```

4. Gere screenshot pelo CDP e veja se voltou para QR ou para a lista de
   conversas.
5. Se continuar em QR, escaneie novamente. O banco não precisa ser recriado.

## Comandos proibidos em operação normal

Não rode estes comandos sem backup e intenção explícita de recriar sessão:

```bash
rm -rf /srv/nuoma-wpp-v2/data
rm -rf /srv/nuoma-wpp-v2/data/chromium-profile/whatsapp
docker compose down -v
```

`docker compose down` sem `-v` é aceitável, mas `docker compose stop` ou
`docker compose restart` são preferíveis para manutenção comum.
