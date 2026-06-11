# Core

Biblioteca compartilhada com ambiente, acesso a banco, repositorios, servicos e tipos de dominio.

## Papel

- carregar configuracao e caminhos de runtime
- abrir e migrar o SQLite
- expor repositorios e servicos usados por `web-app`, `scheduler` e `wa-worker`
- concentrar contratos compartilhados entre as camadas

## Modulos principais

- `src/config`: leitura e validacao de ambiente
- `src/db`: conexao e migrations
- `src/repositories`: acesso a dados
- `src/services`: casos de uso e processamento operacional
- `src/types`: tipos de dominio
- `src/utils`: logger e utilitarios compartilhados

## Comandos

```bash
npm run typecheck --workspace @nuoma/core
npm run migrate --workspace @nuoma/core
npm run seed --workspace @nuoma/core
npm run import:instagram --workspace @nuoma/core
```

## Limites da camada

- esta camada define contrato e regra compartilhada; as demais devem se adaptar a ela
- nao deve concentrar preocupacoes de interface visual
- nesta rodada, o `data lake` existe no pacote, mas fica fora do escopo de alteracao

## Observacao da rodada atual

As mudancas aceitas aqui sao apenas de higiene segura, testes e documentacao. Refactors estruturais mais profundos ficam para uma fase posterior.
