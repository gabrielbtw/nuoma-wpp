# Plano de Execucao - Melhoria do Projeto Nuoma WPP

## Objetivo

Melhorar o projeto priorizando legibilidade, simplicidade e manutencao, com mudancas pequenas, reversiveis e com preservacao do comportamento atual sempre que possivel.

## Principios da execucao

- estabilidade operacional primeiro
- refatoracao segura antes de refatoracao estrutural
- evitar novas bibliotecas sem necessidade real
- preferir consolidacao e simplificacao a novas abstracoes
- preservar contratos publicos, comportamento do produto e integracoes sempre que possivel

## Resumo de prioridade

### Prioridade 0. Baseline ja concluido
- [x] remover imports nao usados e simbolos mortos mais evidentes
- [x] remover codigo morto obvio
- [x] adicionar gate de higiene estatica
- [x] estabilizar testes dependentes do ambiente local
- [x] consolidar duplicacoes pequenas e de baixo risco no frontend

### Prioridade 1. Refatoracao segura de consistencia
Tipo: refatoracao segura
Impacto tecnico: alto
Risco: baixo

- [ ] padronizar nomes internos de enums, status, labels e actions sem alterar contratos publicos
- [ ] reduzir duplicacao de tipos e mapeamentos entre `core` e `frontend`
- [ ] consolidar utilitarios de exibicao e formatacao que ainda estejam espalhados
- [ ] revisar nomes ambiguos de funcoes, variaveis e helpers locais

### Prioridade 2. Refatoracao segura de legibilidade
Tipo: refatoracao segura
Impacto tecnico: alto
Risco: baixo a medio

- [ ] quebrar arquivos muito longos do frontend em componentes e helpers menores
- [ ] quebrar rotas HTTP extensas em blocos menores por responsabilidade
- [ ] extrair trechos repetidos de validacao, serializacao e resposta sem mudar comportamento
- [ ] remover condicionais e ramificacoes desnecessarias onde a regra ja esta clara

### Prioridade 3. Dependencias e manutencao do workspace
Tipo: refatoracao com cuidado
Impacto tecnico: medio
Risco: medio

- [ ] revisar dependencias duplicadas ou com ownership difuso no workspace
- [ ] confirmar se dependencias candidatas a remocao continuam justificadas pelo codigo atual
- [ ] centralizar o que for de ambiente e runtime no nivel correto do workspace
- [ ] evitar substituir dependencias estaveis por novas bibliotecas

### Prioridade 4. Fronteiras e acoplamento entre camadas
Tipo: refatoracao com cuidado
Impacto tecnico: alto
Risco: alto

- [ ] reduzir dependencias cruzadas entre `web-app`, `wa-worker`, `scheduler` e `core`
- [ ] reparar imports de implementacao entre apps quando houver acoplamento de runtime
- [ ] mover regras compartilhadas para a camada correta sem alterar contratos externos
- [ ] diminuir o numero de arquivos com responsabilidade excessiva

### Prioridade 5. Manutencao operacional e performance
Tipo: refatoracao com cuidado
Impacto tecnico: medio a alto
Risco: medio a alto

- [ ] revisar hotspots de processamento de campanhas e automacoes
- [ ] reduzir duplicacao de logica operacional entre servicos e repositorios
- [ ] melhorar previsibilidade de ciclos, filas e watchdog sem alterar comportamento funcional
- [ ] atacar gargalos de manutencao antes de micro-otimizacoes de performance

### Prioridade 6. Documentacao e governanca
Tipo: refatoracao segura
Impacto tecnico: medio
Risco: baixo

- [x] criar README por camada
- [x] criar ADR da rodada
- [x] criar runbook operacional minimo
- [x] criar diagramas simples de arquitetura e fluxo
- [x] refletir a base em Notion e Linear
- [ ] manter documentacao alinhada a cada fase executada
- [ ] transformar backlog tecnico em issues menores por ownership

## Dependencias candidatas a remocao ou substituicao

### Revisar com prioridade media

- [ ] `pm2` duplicado entre raiz e `apps/scheduler`
  Acao sugerida: avaliar centralizacao no workspace root ou encapsular o restart do worker em um ponto unico.
  Observacao: exige cuidado porque o scheduler importa `pm2` em runtime.

### Revisar apenas quando o escopo abrir

- [ ] superficie de dependencias do `data lake`
  Acao sugerida: isolar melhor a trilha de `Whisper`, `Ollama` e `OpenAI` em fase dedicada.
  Observacao: nao remover agora; depende de iniciativa separada.

### Manter por enquanto

- [ ] `@dnd-kit/*`
  Motivo: ha uso direto no builder de campanhas; so revisar se o fluxo de edicao for simplificado.

- [ ] `@fastify/middie`
  Motivo: hoje suporta o `vite` em `middlewareMode`; so substituir se o bootstrap do dev server mudar.

- [ ] `csv-parse`
  Motivo: continua sendo usado pelo fluxo de importacao CSV.

- [ ] `playwright`
  Motivo: dependencia estrutural do `wa-worker`; nao ha substituicao de baixo risco nesta arquitetura.

## Ordem ideal de execucao

1. Consolidar consistencia interna de nomes, tipos e mapeamentos.
2. Melhorar legibilidade dos hotspots sem mudar comportamento.
3. Revisar dependencias candidatas e ownership do workspace.
4. Atacar acoplamentos entre camadas e imports cruzados.
5. Revisar manutencao operacional e hotspots de processamento.
6. Atualizar backlog, documentacao e runbooks ao final de cada fase.

## Plano em fases

### Fase 0. Baseline tecnico
Tipo: refatoracao segura
Impacto tecnico: alto
Status: concluida

- [x] criar e validar `npm run hygiene`
- [x] passar `npm run typecheck`
- [x] passar `npm test`
- [x] limpar imports e codigo morto obvio
- [x] estabilizar o teste que dependia do ambiente local
- [x] consolidar duplicacoes pequenas de exibicao no frontend

### Fase 1. Consistencia de dominio e contratos internos
Tipo: refatoracao segura
Impacto tecnico: alto
Status: pendente

- [ ] mapear enums, status, actions e labels duplicados entre `core` e `frontend`
- [ ] definir uma fonte unica para nomenclaturas de apresentacao onde isso for seguro
- [ ] remover tipos de tela que duplicam tipos de dominio sem necessidade
- [ ] padronizar nomes internos mecanicos, sem renomear payloads ou rotas
- [ ] validar `npm run hygiene`
- [ ] validar `npm run typecheck`
- [ ] validar `npm test`

Resultado esperado:
- menos drift entre camadas
- leitura mais previsivel do dominio
- menor custo de manutencao em ajustes simples

### Fase 2. Legibilidade e modularizacao local
Tipo: refatoracao segura
Impacto tecnico: alto
Status: pendente

- [ ] quebrar paginas muito extensas do frontend em componentes menores
- [ ] quebrar rotas do servidor que concentram serializacao, validacao e coordenacao
- [ ] extrair helpers locais quando a leitura melhorar claramente
- [ ] remover ramificacoes, `ifs` e variaveis intermediarias desnecessarias
- [ ] evitar criar novas camadas abstratas para resolver problemas pequenos
- [ ] validar `npm run hygiene`
- [ ] validar `npm run build`
- [ ] validar `npm test`

Resultado esperado:
- arquivos menores
- menor carga cognitiva
- revisao de codigo mais simples

### Fase 3. Dependencias e ownership do workspace
Tipo: refatoracao com cuidado
Impacto tecnico: medio
Status: pendente

- [ ] revisar se `pm2` deve ficar apenas na raiz ou apenas no scheduler
- [ ] revisar se ha dependencia de runtime em app errada no `package.json`
- [ ] registrar explicitamente dependencias mantidas por necessidade real
- [ ] manter o `data lake` fora da execucao e apenas documentado como trilha separada
- [ ] evitar substituicoes de biblioteca que exijam rewrite desnecessario
- [ ] validar `npm run typecheck`
- [ ] validar `npm test`

Resultado esperado:
- ownership mais claro das dependencias
- menos ruido nos manifests
- menos risco de drift entre runtime e workspace

### Fase 4. Fronteiras entre camadas
Tipo: refatoracao com cuidado
Impacto tecnico: alto
Status: pendente

- [ ] mapear imports cruzados entre apps e `core`
- [ ] eliminar acoplamentos de implementacao entre `wa-worker` e `web-app`
- [ ] mover regras compartilhadas para a camada correta, sem mudar contrato externo
- [ ] reduzir arquivos com responsabilidades misturadas entre IO, regra e coordenacao
- [ ] fazer a mudanca em passos pequenos, com checkpoints validaveis
- [ ] validar `npm run typecheck`
- [ ] validar `npm test`
- [ ] validar `npm run build`

Resultado esperado:
- fronteiras mais claras
- menor acoplamento
- base mais segura para refactors futuros

### Fase 5. Manutencao operacional e performance
Tipo: refatoracao com cuidado
Impacto tecnico: medio a alto
Status: pendente

- [ ] mapear pontos de varredura total em campanhas e automacoes
- [ ] reduzir duplicacao de logica operacional entre servicos e repositorios
- [ ] revisar watchdog, filas e ciclos com foco em previsibilidade
- [ ] priorizar simplificacao e observabilidade antes de otimizar desempenho bruto
- [ ] medir risco de cada ajuste antes de alterar fluxo de runtime
- [ ] validar `npm run typecheck`
- [ ] validar `npm test`

Resultado esperado:
- menor custo de operacao
- menos comportamento surprendente em runtime
- melhor previsibilidade para manutencao

### Fase 6. Documentacao e backlog continuo
Tipo: refatoracao segura
Impacto tecnico: medio
Status: em andamento

- [x] criar README por camada
- [x] criar ADR curto da rodada
- [x] criar runbook de worker e PM2
- [x] criar diagramas simples
- [x] publicar base em Notion
- [x] publicar backlog em Linear
- [ ] manter `PLANS.md` sincronizado com o estado real da execucao
- [ ] quebrar backlog macro em entregas pequenas por camada
- [ ] revisar documentacao ao fim de cada fase concluida

Resultado esperado:
- execucao mais rastreavel
- contexto compartilhado entre time tecnico e operacional
- menor dependencia de conhecimento tacito

## Hotspots conhecidos para fases futuras

- [ ] `apps/web-app/src/client/pages/campaigns.tsx`
- [ ] `apps/web-app/src/client/components/campaigns/builder.tsx`
- [ ] `apps/wa-worker/src/worker.ts`
- [ ] `packages/core/src/services/automation-service.ts`
- [ ] `packages/core/src/services/campaign-service.ts`
- [ ] `packages/core/src/repositories/contact-repository.ts`
- [ ] `packages/core/src/repositories/conversation-repository.ts`

## Regra de corte

Se uma mudanca deixar de ser pequena, reversivel ou claramente segura, ela sai da fase atual e volta para backlog de fase cuidadosa.
