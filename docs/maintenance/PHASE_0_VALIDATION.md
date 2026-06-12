# Phase 0 Validation Gate

Objetivo: validar workspace, lockfile, docs e build sem executar envio real,
Sora live, Safari real, Data Lake remoto ou qualquer integracao com custo.

## Comandos obrigatorios

Executar na raiz do repo:

```bash
npm ci
npm run format:check
npm run lint
npm run typecheck
npm run build
npm test
npm run test:artifact-retention
npm run test:product-confidence
```

## Criterio de aceite

- Todos os comandos passam, ou cada falha fica documentada com causa, impacto e
  dono responsavel.
- `npm ci` confirma que `apps/migration` e `package-lock.json` estao
  sincronizados.
- Nenhum smoke real de WhatsApp, Instagram, Sora, Safari, hosted canary ou
  Data Lake OpenAI e executado nesta fase.
- Nenhum arquivo de `data/`, `storage/`, `dist/`, `.turbo`, screenshots ou
  artefatos de build entra no commit.

## Verificacoes documentais

```bash
rg -n '<legacy-script>|<legacy-env>|<old-v1-absolute-path>' README.md docs AGENTS.md .claude
git status --short --ignored
git ls-files data storage '**/dist/**' '**/.turbo/**'
```

Resultados esperados:

- Referencias antigas devem estar corrigidas ou marcadas como historicas.
- Caminhos absolutos para o repo V1 so podem permanecer quando forem
  intencionais e explicitamente historicos.
- Artefatos rastreados devem ser reportados, nao apagados automaticamente.

## Validacoes externas bloqueadas

Estas validacoes ficam fora da Fase 0 e exigem aprovacao explicita na fase
correta:

- envio real WhatsApp;
- envio real Instagram;
- Safari extension acceptance com Xcode/converter;
- hosted canary;
- Sora live;
- Data Lake com OpenAI remoto.

## Resultado Da Rodada 2026-06-11

Comandos executados na Fase 0:

| Comando                           | Resultado | Observacao                                                                                                   |
| --------------------------------- | --------- | ------------------------------------------------------------------------------------------------------------ |
| `npm ci`                          | passou    | confirmou instalacao do workspace `@nuoma/migration`                                                         |
| `npm run format:check`            | falhou    | Prettier reportou divida global em 280 arquivos; nao foi corrigido nesta fase para evitar reformatacao ampla |
| `npm run lint`                    | passou    | 10 tarefas Turbo                                                                                             |
| `npm run typecheck`               | passou    | 21 tarefas Turbo                                                                                             |
| `npm run build`                   | passou    | 14 tarefas Turbo; Safari segue com converter indisponivel de forma esperada                                  |
| `npm test`                        | passou    | 17 tarefas Turbo                                                                                             |
| `npm run test:artifact-retention` | passou    | `artifact-retention-policy-smoke status=ok`                                                                  |
| `npm run test:product-confidence` | passou    | `product-confidence-smoke status=ok checks=8`                                                                |

Checagens documentais:

- O unico caminho V1 restante encontrado pelo comando de drift e historico:
  `docs/architecture/V2_SPIKES.md` referencia o banco V1 usado no spike de
  migracao.
- `git ls-files data storage '**/dist/**' '**/.turbo/**'` retornou 26
  artefatos rastreados em `data/`; eles foram apenas reportados e preservados.

Status de aceite da Fase 0:

- A estrutura de workspace esta coerente para `@nuoma/migration`.
- O gate de formato ainda nao esta verde por divida preexistente.
- Nenhum smoke real ou execucao com custo externo foi executado.

## Retomada Rebrand 2026-06-11

A retomada do plano Carvao & Cobre executou gates focados adicionais sem envio
real:

| Comando                                        | Resultado |
| ---------------------------------------------- | --------- |
| `npm run typecheck --workspace @nuoma/ui`      | passou    |
| `npm run typecheck --workspace @nuoma/web`     | passou    |
| `npm run typecheck --workspace @nuoma/worker`  | passou    |
| `npm run test --workspace @nuoma/web -- --run` | passou    |
| `npm run test --workspace @nuoma/worker`       | passou    |
| `npm run build --workspace @nuoma/web`         | passou    |
| `npm run test:v211-overlay-unit`               | passou    |
| `npm run test:v211-overlay-fab`                | passou    |

Esta rodada nao substituiu o gate repo-wide acima na epoca: `format:check`
ficou registrado como divida preexistente. A divida foi fechada depois em
2026-06-12; ver `docs/maintenance/PHASE_2_DEBT_CLOSURE.md`.
