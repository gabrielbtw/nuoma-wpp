# Web App

Camada responsavel pela API HTTP e pela interface React usada pela operacao interna.

## Papel

- servir a UI local do CRM
- expor rotas HTTP para contatos, conversas, campanhas, automacoes, uploads e saude do sistema
- registrar erros de request e publicar estado do processo

## Entrypoints

- [`src/server/index.ts`](/Users/gabrielbraga/Projetos/nuoma-wpp/apps/web-app/src/server/index.ts)
- [`src/server/app.ts`](/Users/gabrielbraga/Projetos/nuoma-wpp/apps/web-app/src/server/app.ts)
- [`src/server/routes/index.ts`](/Users/gabrielbraga/Projetos/nuoma-wpp/apps/web-app/src/server/routes/index.ts)
- [`src/client/app.tsx`](/Users/gabrielbraga/Projetos/nuoma-wpp/apps/web-app/src/client/app.tsx)

## Comandos

```bash
npm run dev --workspace @nuoma/web-app
npm run start --workspace @nuoma/web-app
npm run build --workspace @nuoma/web-app
npm run typecheck --workspace @nuoma/web-app
```

## Limites da camada

- contratos e regras de negocio compartilhadas devem vir de `@nuoma/core`
- esta camada nao deve redefinir schema, DTO ou acesso direto ao banco
- nesta rodada, o visual e os fluxos de integracao ficam congelados

## Pastas importantes

- `src/client`: paginas, componentes e utilitarios de UI
- `src/server/routes`: superficie HTTP
- `src/server/lib`: adaptadores locais e codigo de suporte do servidor

## Observacao da rodada atual

Mudancas aceitas aqui sao apenas de limpeza segura, consolidacao de duplicacoes simples e documentacao. Alteracoes de UX, de contrato ou de integracao ficam fora do escopo.
