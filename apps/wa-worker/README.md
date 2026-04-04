# WA Worker

Camada responsavel pelo runtime browser-based do WhatsApp Web.

## Papel

- manter um Chromium persistente para autenticacao e execucao
- sincronizar inbox do WhatsApp
- consumir jobs de envio gerados pelo sistema
- publicar heartbeat, estado e falhas operacionais

## Entrypoints

- [`src/index.ts`](/Users/gabrielbraga/Projetos/nuoma-wpp/apps/wa-worker/src/index.ts)
- [`src/worker.ts`](/Users/gabrielbraga/Projetos/nuoma-wpp/apps/wa-worker/src/worker.ts)

## Comandos

```bash
npm run dev --workspace @nuoma/wa-worker
npm run start --workspace @nuoma/wa-worker
npm run build --workspace @nuoma/wa-worker
npm run typecheck --workspace @nuoma/wa-worker
```

## Dependencias operacionais

- `Playwright` com Chromium persistente
- perfil local em [`storage/chromium-profile/whatsapp`](/Users/gabrielbraga/Projetos/nuoma-wpp/storage/chromium-profile/whatsapp)
- screenshots e artefatos em [`storage/screenshots`](/Users/gabrielbraga/Projetos/nuoma-wpp/storage/screenshots)

## Limites da camada

- nao definir schema, contrato publico, rota HTTP ou regra de negocio compartilhada
- consumir jobs e estados definidos por `@nuoma/core`
- nesta rodada, nao alterar fluxo funcional de autenticacao, sync ou envio

## Observacao da rodada atual

So entram ajustes operacionais claramente seguros, como higiene local e encerramento gracioso do processo. Mudancas em seletores, integracoes ou comportamento de envio ficam fora do escopo.
