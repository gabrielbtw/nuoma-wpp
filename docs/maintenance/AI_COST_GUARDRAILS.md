# AI Cost Guardrails

## Politica da Fase 1

Durante a estabilizacao e canonicalizacao, chamadas com custo externo ficam
proibidas por padrao. Isso inclui OpenAI, Sora e enriquecimento remoto do Data
Lake.

## Flags exigidas

- `AI_COST_APPROVED=SIM`: obrigatoria para qualquer execucao OpenAI/Data Lake
  remota.
- `SORA_BUDGET_APPROVED=SIM`: obrigatoria para qualquer geracao, edicao,
  polling operacional ou extensao de video Sora que possa consumir cota.

## Comportamento executavel

- `AI_PROVIDER=none` desliga enriquecimento AI.
- `AI_PROVIDER=local` permite apenas provedores locais.
- `AI_PROVIDER=auto` prefere provedores locais e so usa OpenAI quando
  `AI_COST_APPROVED=SIM` e `OPENAI_API_KEY` estiverem definidos.
- `AI_PROVIDER=openai` tambem exige `AI_COST_APPROVED=SIM`; sem aprovacao, o
  provider efetivo fica `none`.
- Scripts Sora live falham antes de chamar a API quando
  `SORA_BUDGET_APPROVED` nao e `SIM`.

## Preferencia operacional

Durante validacoes de plataforma, usar:

```bash
AI_PROVIDER=local
```

ou:

```bash
AI_PROVIDER=none
```

## Fases futuras

Fase 1 implementa o gate externo minimo. A implementacao de controle fino fica
para Fase 2:

- cache por `sha256 + model + promptVersion`;
- limite por quantidade de assets;
- limite por tamanho/duracao de audio e imagem;
- retry com contador e backoff;
- estimativa de custo por asset antes de executar lote.
