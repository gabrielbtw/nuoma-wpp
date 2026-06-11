# Diagrama de Fluxo Principal

```mermaid
sequenceDiagram
  participant Operacao
  participant UI as web-app UI
  participant API as web-app API
  participant Core as packages/core
  participant DB as SQLite
  participant Scheduler as scheduler
  participant Worker as wa-worker
  participant Browser as WhatsApp Web

  Operacao->>UI: cria contatos, campanhas e automacoes
  UI->>API: envia acoes e consultas
  API->>Core: valida payloads e executa casos de uso
  Core->>DB: persiste contatos, campanhas, conversas e jobs

  loop ciclo periodico
    Scheduler->>Core: processAutomationTick() / processCampaignTick()
    Core->>DB: identifica itens elegiveis e agenda jobs
  end

  loop processamento de jobs
    Worker->>Core: claimDueJobForTypes()
    Core->>DB: entrega job pendente
    Worker->>Browser: executa sync ou envio
    Worker->>Core: registra sucesso, falha e estado
    Core->>DB: atualiza conversations, messages, campaign_recipients, jobs e worker_state
  end

  UI->>API: consulta dashboard, health, logs e inbox
  API->>Core: le estado consolidado
  Core->>DB: consulta dados operacionais
  API-->>UI: devolve leitura atual da operacao
  UI-->>Operacao: exibe status, historico e alertas
```

## O que este diagrama mostra

Este fluxo representa o caminho principal do sistema no dia a dia. A operacao cadastra ou configura dados pela interface, o `web-app` valida e persiste essas informacoes, o `scheduler` identifica o que precisa acontecer nos ciclos periodicos e o `wa-worker` executa syncs e envios no navegador persistente.

No fechamento do ciclo, o mesmo conjunto de componentes alimenta o painel operacional. Por isso dashboard, inbox, health e logs nao sao camadas separadas: eles sao leituras diferentes do mesmo estado consolidado no banco e no runtime dos processos.
