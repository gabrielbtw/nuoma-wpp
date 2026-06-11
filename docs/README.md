# Documentacao

Este diretorio concentra a documentacao versionada do projeto, separada entre material tecnico-operacional e material executivo.

## Objetivo

Registrar a base do projeto com duas leituras complementares:

- tecnica: para manutencao, operacao e evolucao do sistema
- executiva: para apresentacao, entendimento de negocio e alinhamento com cliente

## Leitura Recomendada

- perfil executivo: [Manual executivo visual](./executive/README.md)
- perfil tecnico: [README principal](../README.md)

## Mapa

- [Manual executivo visual](./executive/README.md)
- [Estrutura executiva para Notion](./executive/notion-structure.md)
- [Estrutura visual para Figma](./executive/figma-presentation.md)
- [ADR 0001](./adr/0001-estabilidade-primeiro.md)
- [ADR 0013 - Stack canonica](./adr/0013-canonical-runtime-stack.md)
- [Runbook do worker e PM2](./runbooks/worker-pm2.md)
- [Diagrama de arquitetura](./diagrams/architecture.md)
- [Fluxo operacional](./diagrams/runtime-flow.md)
- [Entidades principais](./diagrams/entities.md)
- [Visao simplificada para cliente](./diagrams/client-overview.md)

## Legado V1 / Maintenance

Os links abaixo sao historicos e pertencem a `legacy-maintenance`. Use apenas
para comparacao, hotfix aprovado, rollback/cutover ou migracao:

- [LEGACY - README do core](../packages/core/README.md)
- [LEGACY - README do web-app](../apps/web-app/README.md)
- [LEGACY - README do wa-worker](../apps/wa-worker/README.md)
- [LEGACY - README do scheduler](../apps/scheduler/README.md)

## Publicacao atual

- `Notion`: [Nuoma WPP - Documentacao Tecnica](https://www.notion.so/3280d58e114f81b0a2dfc2fa267b3b72)
- `Figma`: estrutura visual e storyboard executivo produzidos para apresentacao

Os arquivos deste diretorio continuam sendo a base versionada no repositorio. Notion segue como espelho vivo da documentacao, enquanto o Figma funciona como apoio visual para apresentacao.
