# Nuoma WPP Sora Explainer PT-BR

Workflow versionavel para gerar o explainer institucional do Nuoma WPP sem editar `storage/`, que e tratado como area de artefatos do workspace. Os prompts ficam em `docs/sora/nuoma-explainer-ptbr`, e os renders locais sao produzidos sob esse mesmo diretorio.

## Escopo

- Formato: `16:9`
- Modelo: `sora-2-pro`
- Resolucao: `1920x1080`
- Duracao alvo: `56s`
- Estrutura: `7` cenas de `8s`
- Linguagem: motion graphics cinematografico com voiceover em portugues do Brasil

## Arquivos

- `prompts-v1.jsonl`: lote principal com as 7 cenas
- `scripts/sora/nuoma-explainer-ptbr.sh`: launcher para `dry-run`, `create-batch`, `poll`, `status`, `edit-*`, `extend-finale` e `concat`

## Pre-requisitos

- `python3`
- `uv`
- `ffmpeg`
- `OPENAI_API_KEY` configurada localmente com uma chave nova, nao a que foi exposta nesta conversa

Variaveis opcionais:

```bash
export OPENAI_API_KEY="<nova-chave-rotacionada>"
export SORA_CLI="$HOME/.codex/skills/sora/scripts/sora.py"
export UV_CACHE_DIR="/tmp/uv-cache"
```

## Execucao

Validar o lote sem chamar a API:

```bash
/Users/gabrielbraga/Projetos/nuoma-wpp/scripts/sora/nuoma-explainer-ptbr.sh check
/Users/gabrielbraga/Projetos/nuoma-wpp/scripts/sora/nuoma-explainer-ptbr.sh dry-run
```

O comando `check` reporta se `python3`, `uv`, `ffmpeg`, `SORA_CLI` e `OPENAI_API_KEY` estao prontos para a geracao real.

Gerar as 7 cenas:

```bash
/Users/gabrielbraga/Projetos/nuoma-wpp/scripts/sora/nuoma-explainer-ptbr.sh create-batch
```

Baixar uma cena apos a criacao do job:

```bash
/Users/gabrielbraga/Projetos/nuoma-wpp/scripts/sora/nuoma-explainer-ptbr.sh poll scene-01-overview video_abc123
```

Consultar status de um job:

```bash
/Users/gabrielbraga/Projetos/nuoma-wpp/scripts/sora/nuoma-explainer-ptbr.sh status video_abc123
```

## Iteracoes concretas

Artefato de UI ou texto:

```bash
/Users/gabrielbraga/Projetos/nuoma-wpp/scripts/sora/nuoma-explainer-ptbr.sh edit-ui video_abc123
```

Narracao corrida ou pouco clara:

```bash
/Users/gabrielbraga/Projetos/nuoma-wpp/scripts/sora/nuoma-explainer-ptbr.sh edit-voice video_abc123
```

Movimento caotico:

```bash
/Users/gabrielbraga/Projetos/nuoma-wpp/scripts/sora/nuoma-explainer-ptbr.sh edit-motion video_abc123
```

Se o fechamento precisar respirar mais `8s`:

```bash
/Users/gabrielbraga/Projetos/nuoma-wpp/scripts/sora/nuoma-explainer-ptbr.sh extend-finale video_abc123
```

## Montagem final

Depois de baixar `scene-01` ate `scene-07` em `docs/sora/nuoma-explainer-ptbr/renders`, concatenar:

```bash
/Users/gabrielbraga/Projetos/nuoma-wpp/scripts/sora/nuoma-explainer-ptbr.sh concat
```

Saida:

- `docs/sora/nuoma-explainer-ptbr/nuoma-explainer-v1.mp4`

## Criterios de aceite

- `48s` a `56s`, alvo `56s`
- Uma ideia principal por cena
- Voiceover PT-BR inteligivel, sem locutor visivel
- Nada de logos, pessoas reais, texto embaralhado ou UI literal do WhatsApp
- Integracoes aparecem como trilha lateral, nao como nucleo diario do produto
