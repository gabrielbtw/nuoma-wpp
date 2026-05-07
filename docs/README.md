# Nuoma WPP V2 Docs

Este arquivo e a porta de entrada para a documentacao versionada da V2. Ele evita
que o estado do produto fique espalhado sem dono claro.

## Fontes Canonicas

| Tema | Documento | Uso |
| --- | --- | --- |
| Plano operacional | [`IMPLEMENTATION_PLAN.md`](IMPLEMENTATION_PLAN.md) | Proxima acao, criterio de aceite e regra de versao/hotfix. |
| Status vivo | [`IMPLEMENTATION_STATUS.md`](IMPLEMENTATION_STATUS.md) | Fonte do painel `/implementation`, versoes fechadas, parciais, faltas e pendencia atual. |
| Checkpoint executivo | [`CHECKPOINT_V2_BASE.md`](CHECKPOINT_V2_BASE.md) | Snapshot curto de decisao e prioridade; deve ser atualizado quando o roadmap mudar de direcao. |
| Onboarding local | [`V2_DEVELOPMENT.md`](V2_DEVELOPMENT.md) | Comandos locais, portas, defaults de worker e regras de camada. |
| Deploy | [`V2_DEPLOYMENT.md`](V2_DEPLOYMENT.md) | Resumo curto; o detalhe operacional fica no runbook hosted. |
| Runbook hosted | [`runbooks/HOSTED_DEPLOYMENT.md`](runbooks/HOSTED_DEPLOYMENT.md) | Procedimento operacional de servidor, QR, backup, restore e smoke. |
| API | [`api/V2_TRPC_PROCEDURES.md`](api/V2_TRPC_PROCEDURES.md) | Routers, seguranca e cobertura dos contratos tRPC/API. |
| Arquitetura profunda | [`architecture/`](architecture/) | Auth, data model, job queue e sync engine. |
| Design system | [`design-system/`](design-system/) | Tokens, inventario, motion, tipografia e regras visuais. |
| Decisoes arquiteturais | [`adr/`](adr/) | Registro historico das decisoes de stack/estrutura. |

## O Que Da Para Limpar

- `CHECKPOINT_V2_BASE.md` pode virar uma secao curta dentro de
  `IMPLEMENTATION_STATUS.md` quando nao for mais necessario manter snapshot
  separado.
- `IMPLEMENTATION_STATUS.md` nao deve voltar a ser diario de execucao; detalhes
  antigos ficam no git.
- `M<n>.<m>` deve entrar como hotfix/subversao no README/status quando for
  correcao pontual; versao nova `V2.x.y` fica para entrega de produto.
- Melhorias futuras devem ficar no `IMPLEMENTATION_PLAN.md` quando forem a
  proxima acao, nao espalhadas em docs de arquitetura.
- A numeracao `V2.15` fica reservada para migracao/cutover V1 -> V2. O
  preflight e o apply operacional estao implementados; o apply real exige
  `V215_CONFIRM_CUTOVER=SIM` e evidencia operacional antes/depois.

## O Que Nao Deve Ser Unificado Agora

- `runbooks/HOSTED_DEPLOYMENT.md`: e operacional e precisa continuar detalhado.
- `architecture/V2_SYNC_ENGINE.md` e `architecture/V2_JOB_QUEUE.md`: sao longos e
  tecnicos; resumir demais reduziria utilidade para debug.
- ADRs: devem permanecer append-only/historicos.
- Design system: melhor separado para nao poluir status de produto.

## Regra De Manutencao

Ao fechar uma versao ou marco:

1. Atualize `IMPLEMENTATION_STATUS.md`.
2. Atualize `IMPLEMENTATION_PLAN.md` se mudou a proxima acao ou criterio de
   aceite.
3. Atualize o README raiz quando houver nova versao, hotfix ou subversao `M`.
4. Atualize `CHECKPOINT_V2_BASE.md` se a prioridade ou versao seguinte mudou.
5. Atualize o doc tecnico especifico apenas se contrato, setup, operacao ou
   arquitetura mudaram.
