# Runbook Operacional - worker e PM2

## Quando usar

Use este runbook quando o `wa-worker` parar de sincronizar, entrar em estado degradado, perder autenticacao ou reiniciar em loop.

## Sinais comuns

- fila de campanhas sem progresso
- inbox sem sincronizacao recente
- status do worker em `disconnected`, `degraded`, `error` ou `restarting`
- watchdog do scheduler acionado

## Checagens rapidas

Verificar processos:

```bash
pm2 status
```

Ver logs recentes:

```bash
pm2 logs wa-worker --lines 200
pm2 logs scheduler --lines 200
pm2 logs web-app --lines 200
```

Verificar endpoints e sinais do painel:

- `http://127.0.0.1:3000/health`
- `http://127.0.0.1:3000/#/health`
- `http://127.0.0.1:3000/#/logs`

Verificar artefatos locais:

- logs em [`storage/logs`](/Users/gabrielbraga/Projetos/nuoma-wpp/storage/logs)
- screenshots em [`storage/screenshots`](/Users/gabrielbraga/Projetos/nuoma-wpp/storage/screenshots)
- perfil persistente em [`storage/chromium-profile/whatsapp`](/Users/gabrielbraga/Projetos/nuoma-wpp/storage/chromium-profile/whatsapp)

## Recuperacao segura

1. Confirmar se o `web-app` e o `scheduler` estao online.
2. Reiniciar apenas o worker:

```bash
pm2 restart wa-worker
```

3. Se a autenticacao cair, subir o worker com navegador visivel:

```bash
CHROMIUM_HEADLESS=false npm run start --workspace @nuoma/wa-worker
```

4. Escanear novamente o QR code do WhatsApp Web, se necessario.
5. Confirmar que o painel voltou a reportar `authenticated` e que a fila retomou o consumo.

## O que nao fazer nesta rodada

- nao limpar o perfil persistente sem necessidade real
- nao trocar seletores, logica de sync ou fluxo de envio durante incidente rotineiro
- nao mexer em integracoes de Instagram e WhatsApp sem iniciativa dedicada

## Escalada

Escalar para investigacao tecnica quando ocorrer um destes casos:

- falhas repetidas apos restart simples
- screenshots mostram quebra estrutural de seletor
- scheduler aciona o watchdog continuamente
- ha divergencia entre fila no banco e estado real do worker
