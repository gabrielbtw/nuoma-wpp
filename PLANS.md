# Plano Executivo de Melhoria do Projeto Nuoma WPP

## Diretriz da rodada atual
- foco: arquitetura, organização, legibilidade, consistência de nomes, contratos, dependências, testes e documentação
- fora de escopo neste momento: data lake, pipeline de tendências, providers de IA e ajustes ligados a `/data-lake`
- regra operacional: primeiro organizar a base; depois atacar refactors mais profundos

## Priorização por impacto vs esforço

### P1. Alto impacto / baixo esforço
- [ ] remover imports não usados e símbolos mortos
- [ ] remover código morto evidente
- [ ] revisar dependências possivelmente desnecessárias ou mal classificadas no `package.json`
- [ ] tornar a suíte de testes determinística e independente do ambiente local
- [ ] adicionar gate de higiene estática para evitar regressão de legibilidade
- [ ] consolidar utilitários e mapas repetidos do frontend onde o ganho for imediato

### P2. Alto impacto / esforço médio
- [ ] padronizar nomenclatura de enums, status, actions e labels
- [ ] reduzir duplicação de tipos e contratos entre `core` e `frontend`
- [ ] quebrar arquivos de rota e páginas que concentram responsabilidades demais
- [ ] melhorar legibilidade dos hotspots sem alterar comportamento
- [ ] revisar abstrações que hoje existem no nome, mas ainda misturam persistência, regra e efeitos colaterais

### P3. Alto impacto / alto esforço
- [ ] eliminar acoplamento entre `wa-worker` e `web-app` no fluxo do Instagram
- [ ] decompor serviços e repositórios gigantes em módulos menores por caso de uso
- [ ] mover regra de negócio que hoje está enterrada em repositórios para serviços ou use cases claros
- [ ] revisar a estratégia de execução de campanhas e automações para reduzir varreduras totais e melhorar escalabilidade

### P4. Governança e documentação
- [ ] gerar README técnico da arquitetura real
- [ ] gerar documentação executiva para acompanhamento de produto e operação
- [ ] gerar diagramas de arquitetura, runtime e fluxos principais
- [ ] revisar consistência entre documentação e código
- [ ] verificar projeto no Notion
- [ ] verificar projeto no Linear
- [ ] verificar projeto no Figma
- [ ] criar se não existir

## Plano em fases

### Fase 1. Higiene e baseline
- [ ] limpar imports não usados
- [ ] limpar símbolos mortos
- [ ] revisar dependências desnecessárias
- [ ] estabilizar testes dependentes de ambiente
- [ ] definir verificação automática mínima de higiene

**Resultado esperado**
- base mais limpa
- menos ruído para próximos refactors
- feedback mais confiável de qualidade

### Fase 2. Contratos e consistência
- [ ] unificar nomenclatura entre backend e frontend
- [ ] reduzir duplicação de tipos de domínio
- [ ] centralizar labels e mapeamentos repetidos
- [ ] revisar nomes de módulos, funções e estruturas ambíguas

**Resultado esperado**
- menos drift entre camadas
- menor custo de manutenção
- leitura de domínio mais previsível

### Fase 3. Fronteiras e decomposição
- [ ] reparar fronteiras entre `core`, `web-app`, `wa-worker` e `scheduler`
- [ ] dividir módulos críticos muito grandes
- [ ] separar persistência de regra de negócio
- [ ] reduzir pontos únicos de falha por arquivo ou serviço

**Resultado esperado**
- ownership mais claro
- menor acoplamento
- refactor futuro com menos risco

### Fase 4. Performance e manutenção
- [ ] revisar tick de automações e campanhas
- [ ] reduzir duplicação de lógica operacional
- [ ] melhorar pontos de manutenção recorrente no worker e no fluxo assistido
- [ ] preparar backlog técnico contínuo com critérios de priorização

**Resultado esperado**
- melhor previsibilidade operacional
- menos custo de evolução
- menor risco de degradação com crescimento da base

### Fase 5. Documentação e publicação interna
- [ ] publicar documentação técnica
- [ ] publicar documentação executiva
- [ ] anexar diagramas
- [ ] refletir a estrutura no Notion, Linear e Figma

**Resultado esperado**
- projeto documentado para operação e evolução
- visibilidade executiva
- handoff mais claro entre frentes
