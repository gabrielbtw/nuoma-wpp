# Diagrama de Entidades Principais

```mermaid
erDiagram
  CONTACTS {
    string id PK
    string name
    string phone
    string instagram
    string status
    string procedure_status
  }

  CONTACT_CHANNELS {
    string id PK
    string contact_id FK
    string type
    string display_value
    boolean is_primary
    boolean is_active
  }

  TAGS {
    string id PK
    string name
    string type
    boolean active
  }

  CONTACT_TAGS {
    string contact_id FK
    string tag_id FK
  }

  CONVERSATIONS {
    string id PK
    string contact_id FK
    string channel
    string external_thread_id
    string title
    int unread_count
    string status
  }

  MESSAGES {
    string id PK
    string conversation_id FK
    string contact_id FK
    string direction
    string content_type
    string status
  }

  AUTOMATIONS {
    string id PK
    string name
    string category
    boolean enabled
  }

  AUTOMATION_ACTIONS {
    string id PK
    string automation_id FK
    int sort_order
    string type
  }

  AUTOMATION_RUNS {
    string id PK
    string automation_id FK
    string contact_id FK
    string conversation_id FK
    string status
    string next_run_at
  }

  CAMPAIGNS {
    string id PK
    string name
    string status
    string send_window_start
    string send_window_end
  }

  CAMPAIGN_STEPS {
    string id PK
    string campaign_id FK
    int sort_order
    string type
    string channel_scope
  }

  CAMPAIGN_RECIPIENTS {
    string id PK
    string campaign_id FK
    string contact_id FK
    string channel
    string status
    string next_run_at
  }

  JOBS {
    string id PK
    string type
    string status
    string scheduled_at
    int attempts
  }

  WORKER_STATE {
    string key PK
    string updated_at
  }

  SYSTEM_LOGS {
    string id PK
    string process_name
    string level
    string created_at
  }

  CONTACTS ||--o{ CONTACT_CHANNELS : "tem"
  CONTACTS ||--o{ CONTACT_TAGS : "recebe"
  TAGS ||--o{ CONTACT_TAGS : "classifica"
  CONTACTS o|--o{ CONVERSATIONS : "participa"
  CONVERSATIONS ||--o{ MESSAGES : "agrega"
  CONTACTS o|--o{ MESSAGES : "origina"
  AUTOMATIONS ||--o{ AUTOMATION_ACTIONS : "define"
  AUTOMATIONS ||--o{ AUTOMATION_RUNS : "gera"
  CONTACTS ||--o{ AUTOMATION_RUNS : "alvo"
  CONVERSATIONS o|--o{ AUTOMATION_RUNS : "contexto"
  CAMPAIGNS ||--o{ CAMPAIGN_STEPS : "composta por"
  CAMPAIGNS ||--o{ CAMPAIGN_RECIPIENTS : "dispara para"
  CONTACTS o|--o{ CAMPAIGN_RECIPIENTS : "pode referenciar"
```

## O que este diagrama mostra

Este modelo resume as entidades mais importantes da base atual, sem tentar representar todas as tabelas auxiliares. O centro funcional do sistema fica em quatro blocos: contatos, conversas, automacoes e campanhas. A partir deles, o projeto organiza classificacao por tags, historico de mensagens e execucao operacional por jobs.

O diagrama tambem evidencia que o sistema nao e apenas uma lista de contatos. Ele combina relacionamento, execucao e monitoramento. `worker_state` e `system_logs` aparecem como apoios de observabilidade, enquanto `campaign_recipients` e `automation_runs` mostram onde a operacao efetivamente vira fila e processamento.
