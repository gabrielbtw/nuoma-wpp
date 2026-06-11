# Cutover Rollback Runbook

Use este runbook somente para rollback V1 <- V2 durante ou logo apos o cutover V2.15.

## Quando executar

Executar rollback se qualquer condicao critica ocorrer depois do apply:

- Worker V2 nao autentica no WhatsApp.
- Mensagens inbound nao aparecem no V2.
- Envio real falha para canario permitido.
- Audio nativo regressa.
- Campanha pequena cria/envia jobs errados.
- Corrupcao ou perda de dados detectada por `migration:v215:validate`.

Nao executar rollback por warnings menores de UI ou por dados historicos nao criticos ja documentados no relatorio.

## Decisao por fase

| Fase | Estado | Acao |
|---|---|---|
| Antes do apply | V2 sem dados migrados | Corrigir e repetir preflight/dry-run. |
| Depois do apply, antes do QR V2 | V1 ainda dono da sessao | Restaurar backup V2 se necessario; V1 continua ativo/read-only ou volta a ativo. |
| Depois do QR V2, antes de envio real | Sessao mudou | Desvincular V2, reativar V1 e validar QR/sessao. |
| Depois de envio real | V2 tocou producao | Rollback apenas com causa critica, registrar RCA obrigatoria. |

## Passos

1. Parar V2:

```bash
docker compose stop api web worker
```

2. Restaurar o DB V2 se o apply precisa ser desfeito:

```bash
cp data/backups/pre-v215-cutover-*.db data/nuoma-v2.db
```

3. Desvincular o WhatsApp Web do V2 no aparelho primario.

4. Subir V1:

```bash
pm2 start wa-worker
pm2 start scheduler
pm2 status
```

5. Reautenticar V1 se o QR tiver sido invalidado.

6. Smoke V1:

- Receber mensagem inbound no canario.
- Enviar texto para o canario.
- Se audio estava no escopo, enviar audio nativo.
- Registrar print/evidencia visual.
- Registrar `IG nao aplicavel` se Instagram nao for testado.

7. Registrar incidente:

- Horario do rollback.
- Fase em que falhou.
- Relatorio V2.15 usado.
- Backup restaurado.
- Evidencias visuais.
- RCA obrigatoria antes de nova tentativa.

## Comandos uteis

```bash
npm run migration:v215:preflight
npm run migration:v215:validate
npm run test:v215-cutover-preflight
npm run test:v215-cutover-apply
```

## Criterio para tentar de novo

Nova tentativa so pode ocorrer depois de:

- RCA concluida.
- Fix implementado e validado em clone.
- Apply idempotente em clone.
- Smokes V2.15 passando.
- Backup novo confirmado.
