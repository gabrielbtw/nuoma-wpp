#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
WORK_DIR="$ROOT_DIR/docs/sora/nuoma-explainer-ptbr"
PROMPTS_FILE="$WORK_DIR/prompts-v1.jsonl"
JOBS_DIR="$WORK_DIR/jobs-v1"
RENDERS_DIR="$WORK_DIR/renders"
FINAL_OUT="$WORK_DIR/nuoma-explainer-v1.mp4"
SORA_CLI="${SORA_CLI:-$HOME/.codex/skills/sora/scripts/sora.py}"
UV_CACHE_DIR="${UV_CACHE_DIR:-/tmp/uv-cache}"
CONCURRENCY="${SORA_CONCURRENCY:-2}"

SCENES=(
  "scene-01-overview"
  "scene-02-web-app"
  "scene-03-crm"
  "scene-04-automations"
  "scene-05-campaigns"
  "scene-06-operations"
  "scene-07-integrations-finale"
)

die() {
  echo "error: $*" >&2
  exit 1
}

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "missing required command: $1"
}

require_file() {
  [[ -f "$1" ]] || die "missing required file: $1"
}

require_env() {
  [[ -n "${!1:-}" ]] || die "missing required env var: $1"
}

ensure_dirs() {
  mkdir -p "$JOBS_DIR" "$RENDERS_DIR"
}

run_sora_dry() {
  require_cmd python3
  require_file "$SORA_CLI"
  "$@"
}

run_sora_live() {
  require_cmd uv
  require_cmd python3
  require_file "$SORA_CLI"
  require_env OPENAI_API_KEY
  UV_CACHE_DIR="$UV_CACHE_DIR" uv run --with openai "$@"
}

usage() {
  cat <<EOF
Usage:
  $(basename "$0") check
  $(basename "$0") dry-run
  $(basename "$0") create-batch
  $(basename "$0") status <video_id>
  $(basename "$0") poll <scene_slug> <video_id>
  $(basename "$0") edit-ui <video_id>
  $(basename "$0") edit-voice <video_id>
  $(basename "$0") edit-motion <video_id>
  $(basename "$0") extend-finale <video_id>
  $(basename "$0") concat
EOF
}

check_env() {
  local missing=0

  if command -v python3 >/dev/null 2>&1; then
    echo "ok: python3"
  else
    echo "missing: python3"
    missing=1
  fi

  if command -v uv >/dev/null 2>&1; then
    echo "ok: uv"
  else
    echo "missing: uv"
    missing=1
  fi

  if command -v ffmpeg >/dev/null 2>&1; then
    echo "ok: ffmpeg"
  else
    echo "missing: ffmpeg"
    missing=1
  fi

  if [[ -f "$SORA_CLI" ]]; then
    echo "ok: sora-cli ($SORA_CLI)"
  else
    echo "missing: sora-cli ($SORA_CLI)"
    missing=1
  fi

  if [[ -n "${OPENAI_API_KEY:-}" ]]; then
    echo "ok: OPENAI_API_KEY"
  else
    echo "missing: OPENAI_API_KEY"
    missing=1
  fi

  return "$missing"
}

edit_prompt_ui() {
  cat <<'EOF'
Primary request: same shot and same camera move; replace any readable UI text or lettering with abstract interface cards only
Constraints: keep composition, lighting, palette and the main module identity unchanged; no real people; no logos; no visible narrator
Avoid: readable text, malformed letters, flicker, jitter, crowded composition
EOF
}

edit_prompt_voice() {
  cat <<'EOF'
Primary request: same shot and same camera move; make the Brazilian Portuguese voiceover slower, clearer and easier to understand
Audio: clear Brazilian Portuguese voiceover, slightly slower pacing, stronger vocal presence in the mix, no visible narrator
Constraints: keep composition, lighting, palette and module identity unchanged; no real people; no logos
Avoid: rushed speech, muffled voice, competing ambience, visible narrator
EOF
}

edit_prompt_motion() {
  cat <<'EOF'
Primary request: same shot and same camera move; reduce motion intensity and simplify the action to one clear visual gesture
Constraints: keep the core subject, framing, lighting and palette unchanged; no real people; no logos; no visible narrator
Avoid: camera shake, chaotic motion, flicker, jitter, crowded composition
EOF
}

extend_prompt_finale() {
  cat <<'EOF'
Use case: institutional product explainer closing beat
Primary request: continue the finale by holding the full governed platform in frame and letting the architecture breathe for eight more seconds
Action: continue the aerial pull-back very gently, then settle into a calm final wide composition
Camera: preserve the existing motion continuity and finish with a stable premium hero frame
Audio: clear Brazilian Portuguese voiceover can taper naturally; no visible narrator
Constraints: keep integrations secondary to the main operating core; no real people; no readable UI text; no logos
Avoid: sudden new elements, chaotic motion, flicker, malformed letters
EOF
}

concat_all() {
  require_cmd ffmpeg
  ensure_dirs

  local scene
  local concat_file
  concat_file="$(mktemp)"

  for scene in "${SCENES[@]}"; do
    [[ -f "$RENDERS_DIR/$scene.mp4" ]] || die "missing render: $RENDERS_DIR/$scene.mp4"
    printf "file '%s'\n" "$RENDERS_DIR/$scene.mp4" >>"$concat_file"
  done

  ffmpeg -y -f concat -safe 0 -i "$concat_file" -c copy "$FINAL_OUT"
  rm -f "$concat_file"
  echo "wrote $FINAL_OUT"
}

main() {
  [[ $# -ge 1 ]] || { usage; exit 1; }
  ensure_dirs

  case "$1" in
    check)
      check_env
      ;;
    dry-run)
      run_sora_dry python3 "$SORA_CLI" create-batch \
        --input "$PROMPTS_FILE" \
        --out-dir "$JOBS_DIR/dry-run" \
        --concurrency 1 \
        --dry-run \
        --no-augment
      ;;
    create-batch)
      run_sora_live python3 "$SORA_CLI" create-batch \
        --input "$PROMPTS_FILE" \
        --out-dir "$JOBS_DIR" \
        --concurrency "$CONCURRENCY" \
        --no-augment
      ;;
    status)
      [[ $# -eq 2 ]] || die "usage: $(basename "$0") status <video_id>"
      run_sora_live python3 "$SORA_CLI" status --id "$2"
      ;;
    poll)
      [[ $# -eq 3 ]] || die "usage: $(basename "$0") poll <scene_slug> <video_id>"
      run_sora_live python3 "$SORA_CLI" poll --id "$3" --download --out "$RENDERS_DIR/$2.mp4"
      ;;
    edit-ui)
      [[ $# -eq 2 ]] || die "usage: $(basename "$0") edit-ui <video_id>"
      run_sora_live python3 "$SORA_CLI" edit --id "$2" --prompt "$(edit_prompt_ui)" --no-augment
      ;;
    edit-voice)
      [[ $# -eq 2 ]] || die "usage: $(basename "$0") edit-voice <video_id>"
      run_sora_live python3 "$SORA_CLI" edit --id "$2" --prompt "$(edit_prompt_voice)" --no-augment
      ;;
    edit-motion)
      [[ $# -eq 2 ]] || die "usage: $(basename "$0") edit-motion <video_id>"
      run_sora_live python3 "$SORA_CLI" edit --id "$2" --prompt "$(edit_prompt_motion)" --no-augment
      ;;
    extend-finale)
      [[ $# -eq 2 ]] || die "usage: $(basename "$0") extend-finale <video_id>"
      run_sora_live python3 "$SORA_CLI" extend --id "$2" --seconds 8 --prompt "$(extend_prompt_finale)" --no-augment
      ;;
    concat)
      concat_all
      ;;
    *)
      usage
      exit 1
      ;;
  esac
}

main "$@"
