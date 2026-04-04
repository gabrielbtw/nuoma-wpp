# Nuoma WPP - Plano de Manutencao, Testes e Melhorias

Data: 2026-04-04
Baseado na analise de 80+ decisoes, 24 tech debts, 25 design findings, 18 arch risks.

---

## 1. Plano de Testes Reais

### 1.1 Testes Manuais Prioritarios (checklist para rodar AGORA)

#### Dashboard
- [ ] Abrir `/#/` e verificar metricas carregam
- [ ] Verificar status badge (Operacional/Atencao) reflete estado real
- [ ] Se houver jobs falhados, verificar error badge vermelho aparece
- [ ] Clicar "Saude" navega para `/#/health`

#### Campanhas (fluxo completo)
- [ ] Criar campanha com 3 steps (texto + espera + texto)
- [ ] Adicionar condicao "Se respondeu -> Sair" no step 3
- [ ] Ativar toggle Evergreen
- [ ] Importar CSV com 3 contatos
- [ ] Adicionar 2 numeros manualmente (secao "Adicionar manualmente")
- [ ] Clicar botao Eye (olho) no catalogo para abrir workflow viewer
- [ ] Verificar que o viewer mostra os 3 steps com stats
- [ ] Ativar campanha e verificar que recipients entram na fila
- [ ] Pausar e verificar que para de processar

#### Inbox Unificada
- [ ] Abrir `/#/inbox` e verificar lista de contatos (nao conversas)
- [ ] Clicar num contato e verificar timeline mista (WA + IG)
- [ ] Verificar icones de canal (verde WA, rosa IG) em cada mensagem
- [ ] Alternar canal no composer (WA/IG toggle)
- [ ] Enviar mensagem e verificar que aparece na timeline

#### Contatos
- [ ] Abrir `/#/contacts` e verificar tabela carrega
- [ ] Criar contato com telefone + Instagram
- [ ] Editar contato e verificar historico
- [ ] Abrir detalhe do contato (`/#/contacts/:id`)
- [ ] Verificar Narrative Ledger (timeline de mensagens com dates)

#### Automacoes
- [ ] Criar automacao com trigger tags
- [ ] Adicionar acoes usando o builder unificado (FlowStepCard)
- [ ] Verificar drag-and-drop funciona nas acoes
- [ ] Ativar/desativar via toggle
- [ ] Verificar signal dot muda (verde/cinza)

#### Chatbot
- [ ] Abrir `/#/chatbot`
- [ ] Criar chatbot com 2 regras keyword
- [ ] Testar no painel de preview (digitar mensagem que matcha)
- [ ] Testar mensagem sem match (verificar fallback)
- [ ] Salvar e verificar que aparece na lista

#### Saude do Sistema
- [ ] Abrir `/#/health`
- [ ] Verificar 6 StatusRow cards (sistema, scheduler, SQLite, WA, IG, memoria)
- [ ] Verificar event log no painel direito atualiza a cada 10s
- [ ] Se worker estiver offline, verificar que cards mostram warning/error

#### Settings
- [ ] Abrir `/#/settings`
- [ ] Navegar pelas 5 secoes na sidebar
- [ ] Editar um valor e verificar que botao "Salvar" aparece
- [ ] Criar tag com cor e tipo
- [ ] Verificar preview da tag no editor

#### Templates (API)
- [ ] `curl http://localhost:3000/templates` - lista vazia
- [ ] `curl -X POST http://localhost:3000/templates -H 'Content-Type: application/json' -d '{"name":"Boas-vindas","body":"Ola {{nome}}!"}'`
- [ ] `curl http://localhost:3000/templates` - template aparece
- [ ] `curl http://localhost:3000/templates/variables` - lista de variaveis

#### Segmentacao (API)
- [ ] `curl -X POST http://localhost:3000/contacts/query -H 'Content-Type: application/json' -d '{"segment":{"logic":"and","filters":[{"field":"status","operator":"equals","value":"novo"}]}}'`

### 1.2 Testes Automatizados (a implementar)

#### Prioridade 1: Services (unit tests)
```
packages/core/src/services/
  campaign-service.test.ts    → processCampaignTick, handleJobSuccess/Failure
  automation-service.test.ts  → evaluateEligibility, processAutomationTick
  dashboard-service.test.ts   → getDashboardSummary com failures
```

#### Prioridade 2: Repositories (integration tests)
```
packages/core/src/repositories/
  campaign-repository.test.ts → CRUD, evergreen, conditions, step stats
  chatbot-repository.test.ts  → CRUD, matchChatbotRule
  template-repository.test.ts → CRUD, variable listing
  contact-repository.test.ts  → queryContactsBySegment
```

#### Prioridade 3: Routes (API tests)
```
apps/web-app/src/server/routes/
  campaigns.test.ts → activation flow, manual recipients, step-stats
  chatbots.test.ts  → CRUD + keyword matching
  templates.test.ts → CRUD
```

### 1.3 Testes de Performance (com 5k-50k contatos)

- [ ] Importar CSV com 5.000 contatos
- [ ] Verificar tempo de listContactsPage (deve ser < 200ms)
- [ ] Criar campanha com 5.000 recipients
- [ ] Verificar que processCampaignTick nao causa OOM (fix ja aplicado: campaign cache)
- [ ] Verificar que listUnifiedInbox nao faz N+1 (fix ja aplicado: subquery)
- [ ] Medir memoria do wa-worker durante sync de 100+ conversas

---

## 2. Plano de Manutencao

### 2.1 Rotina Diaria
- [ ] Verificar dashboard: status operacional, error badge
- [ ] Verificar health page: worker autenticado, scheduler rodando
- [ ] Verificar logs: erros recentes

### 2.2 Rotina Semanal
- [ ] Verificar campanhas: recipients com falha, reprocessar se necessario
- [ ] Verificar automacoes: runs pendentes, cooldowns
- [ ] Backup do SQLite: `cp storage/database/nuoma.db storage/database/nuoma-backup-$(date +%Y%m%d).db`
- [ ] Verificar tamanho do DB: `ls -lh storage/database/nuoma.db`
- [ ] Limpar temp files: `rm -rf storage/temp/*`

### 2.3 Rotina Mensal
- [ ] Rodar `npm run typecheck` e `npm run hygiene`
- [ ] Verificar dependencias: `npm outdated`
- [ ] Revisar PHASE-11-ANALYSIS.md: quantos items foram resolvidos
- [ ] Verificar performance com volume atual de contatos

### 2.4 Monitoramento Automatizado
O scheduler ja faz:
- Watchdog do wa-worker (restart se stale)
- Release de job locks stale (a cada ciclo)
- Cleanup de temp files (diario)
- Heartbeat publishing (a cada 20s)

### 2.5 Runbook de Incidentes
Ver: `docs/runbooks/worker-pm2.md`

---

## 3. Melhorias Futuras (Priorizadas)

### Sprint 1: Quick Wins (1-2 dias)
| Item | Impacto | Custo | Fonte |
|------|---------|-------|-------|
| Extrair parseJson* duplicados para utils | MEDIUM | LOW | Tech Debt #9 |
| Adicionar indices compostos em jobs | LOW | LOW | Arch #17 |
| Graceful shutdown no scheduler | MEDIUM | LOW | Arch #13 |
| Config paths validation no startup | MEDIUM | LOW | Arch #15 |

### Sprint 2: Robustez (2-3 dias)
| Item | Impacto | Custo | Fonte |
|------|---------|-------|-------|
| BEGIN IMMEDIATE para double-claim prevention | HIGH | MEDIUM | Arch #5 |
| Transaction boundaries em ensureCampaignRecipientContact | MEDIUM | MEDIUM | Arch #7 |
| Error classification no worker (fatal vs retry) | MEDIUM | MEDIUM | Arch #8 |
| Correlation IDs nos job failures | MEDIUM | MEDIUM | Arch #16 |

### Sprint 3: Features Pendentes (3-5 dias)
| Item | Impacto | Custo | Fonte |
|------|---------|-------|-------|
| Integrar SegmentBuilder na pagina de contatos | HIGH | MEDIUM | Fase 12 |
| Integrar SegmentBuilder como seletor de recipients em campanhas | HIGH | MEDIUM | Fase 12 |
| Workflow viewer horizontal com branching | MEDIUM | HIGH | Fase 12 |
| Template picker no builder (selecionar template existente) | MEDIUM | MEDIUM | Fase 1 |

### Sprint 4: Testes (2-3 dias)
| Item | Impacto | Custo | Fonte |
|------|---------|-------|-------|
| Unit tests para campaign-service | HIGH | HIGH | Tech Debt #16 |
| Unit tests para automation-service | HIGH | HIGH | Tech Debt #16 |
| Integration tests para chatbot-repository | MEDIUM | MEDIUM | Novo |
| API tests para campaign flow completo | MEDIUM | HIGH | Novo |

### Sprint 5: Refactoring (3-5 dias)
| Item | Impacto | Custo | Fonte |
|------|---------|-------|-------|
| Split campaign-service em modulos | HIGH | HIGH | Tech Debt #4 |
| Split automation-service em modulos | HIGH | HIGH | Tech Debt #5 |
| Split contact-repository (CRUD vs query vs history) | MEDIUM | HIGH | Tech Debt #12 |
| Consolidar validacao duplicada | HIGH | MEDIUM | Tech Debt #6 |

### Sprint 6: UX Polish (2-3 dias)
| Item | Impacto | Custo | Fonte |
|------|---------|-------|-------|
| Skeleton loaders em todas as queries | MEDIUM | MEDIUM | Design #2 |
| EmptyState padronizado em todas as paginas | MEDIUM | LOW | Design #3 |
| Loading spinner em botoes de mutation | LOW | LOW | Design #18 |
| Message bubble compartilhado (inbox + contact detail) | LOW | LOW | Design #11 |

### Backlog (sem prazo)
| Item | Impacto | Custo |
|------|---------|-------|
| Migrar para Zod validation nos repository boundaries | LOW | HIGH |
| Full-text search para contatos (50k+) | LOW | MEDIUM |
| OpenAPI documentation para todas as rotas | LOW | MEDIUM |
| Error boundaries no React | LOW | LOW |
| A/B testing em campanhas | LOW | HIGH |
| Evergreen scheduler evaluation no processCampaignTick | MEDIUM | MEDIUM |
| Chatbot integration com wa-worker (processar mensagens incoming) | HIGH | HIGH |

---

## 4. Metricas de Saude do Projeto

### Codigo
- **Typecheck**: 4/4 workspaces passam
- **Hygiene**: ultimo check em 2026-04-04
- **Testes**: 1 arquivo de teste (review.test.ts) - cobertura minima
- **Tech debt**: 24 items (9 HIGH, 13 MEDIUM, 2 LOW)

### Performance
- **SQLite DB**: WAL mode, busy retry com 5 tentativas
- **Job queue**: deduplicacao atomica, lock release automatico
- **Campaign processing**: pre-fetch cache, state freshness check
- **Inbox query**: subquery em vez de N+1

### Design
- **Pages redesenhadas**: 12/12 (100%)
- **Design tokens**: n-bg, n-surface, n-text hierarchy implementados
- **Components**: Skeleton, EmptyState, Toast, DataTable criados
- **Findings pendentes**: 25 (3 CRITICAL, 9 MAJOR) - ver PHASE-11-ANALYSIS.md

### Arquitetura
- **Risks resolvidos**: 4/18 (job locks, dedupe, N+1 cache, freshness)
- **Risks pendentes**: 14 (5 HIGH, 8 MEDIUM, 1 LOW)
- **Migracoes**: 9 (0001-0009) todas aplicadas
- **Skills**: 10 configuradas para desenvolvimento futuro
