#!/usr/bin/env python3
"""
Voice conversion script for Nuoma Atendente Virtual.
Pipeline: Whisper transcription -> XTTS v2 synthesis with voice samples.

Usage:
  python voice_convert.py \\
    --input <original_audio_path> \\
    --samples-dir <voice_samples_dir> \\
    --output <output_wav_path> \\
    [--whisper-model <path_to_model>]

Exit code 0 = success, exit code 1 = failure (error on stderr).

Prerequisites:
  pip install TTS openai-whisper
  # XTTS v2 downloads ~1.8GB model weights on first use to ~/.local/share/tts/
"""
import argparse
import glob
import os
import subprocess
import sys


def parse_args():
    parser = argparse.ArgumentParser(description="Convert audio voice using XTTS v2")
    parser.add_argument("--input", required=True, help="Path to original audio file")
    parser.add_argument("--samples-dir", required=True, help="Directory with voice sample files")
    parser.add_argument("--output", required=True, help="Output WAV file path")
    parser.add_argument("--whisper-model", default=None, help="Path to Whisper model (optional)")
    return parser.parse_args()


def find_samples(samples_dir: str) -> list:
    patterns = ["*.wav", "*.mp3", "*.ogg", "*.m4a", "*.flac"]
    files = []
    for pattern in patterns:
        files.extend(glob.glob(os.path.join(samples_dir, pattern)))
    return sorted(files)


def transcribe_with_python(input_path: str, whisper_model_path: str | None) -> str:
    """Transcribe using openai-whisper Python library."""
    import whisper  # type: ignore
    model_name = "base"
    if whisper_model_path and os.path.exists(whisper_model_path):
        # openai-whisper doesn't support custom .bin paths directly — use "base" or the env-specified name
        # Extract model name from filename if possible (e.g. "ggml-base-q5_1.bin" -> "base")
        basename = os.path.basename(whisper_model_path).lower()
        for candidate in ["large-v3", "large-v2", "large", "medium", "small", "base", "tiny"]:
            if candidate.replace("-", "") in basename.replace("-", ""):
                model_name = candidate
                break
    model = whisper.load_model(model_name)
    result = model.transcribe(input_path, language="pt")
    return str(result["text"]).strip()


def transcribe_with_cli(input_path: str, whisper_model_path: str | None) -> str:
    """Transcribe using whisper-cli binary (fallback)."""
    whisper_bin = os.environ.get("WHISPER_BIN", "whisper-cli")
    model_path = whisper_model_path or os.environ.get("WHISPER_MODEL_PATH", "")
    if not model_path:
        raise RuntimeError("WHISPER_MODEL_PATH not set and no --whisper-model provided")
    result = subprocess.run(
        [whisper_bin, "-m", model_path, "-l", "pt", "-nt", "-np", "-f", input_path],
        capture_output=True, text=True, check=True
    )
    return result.stdout.strip()


def transcribe(input_path: str, whisper_model_path: str | None) -> str:
    """Transcribe audio to text. Tries Python library first, falls back to CLI."""
    try:
        return transcribe_with_python(input_path, whisper_model_path)
    except ImportError:
        pass
    return transcribe_with_cli(input_path, whisper_model_path)


def synthesize(text: str, samples: list, output_path: str) -> None:
    """Synthesize text with XTTS v2 using provided voice samples."""
    from TTS.api import TTS  # type: ignore
    tts = TTS("tts_models/multilingual/multi-dataset/xtts_v2")
    tts.tts_to_file(
        text=text,
        speaker_wav=samples,
        language="pt",
        file_path=output_path
    )


def main():
    args = parse_args()

    if not os.path.exists(args.input):
        print(f"Input file not found: {args.input}", file=sys.stderr)
        sys.exit(1)

    samples = find_samples(args.samples_dir)
    if not samples:
        print(f"No voice samples found in: {args.samples_dir}", file=sys.stderr)
        sys.exit(1)

    # Step 1: Transcribe original audio
    try:
        text = transcribe(args.input, args.whisper_model)
    except Exception as exc:
        print(f"Transcription failed: {exc}", file=sys.stderr)
        sys.exit(1)

    if not text:
        print("Transcription returned empty text — nothing to synthesize", file=sys.stderr)
        sys.exit(1)

    print(f"Transcribed text: {text[:100]}{'...' if len(text) > 100 else ''}")

    # Step 2: Synthesize with attendant's voice
    try:
        os.makedirs(os.path.dirname(os.path.abspath(args.output)), exist_ok=True)
        synthesize(text, samples, args.output)
    except Exception as exc:
        print(f"voice_conversion Synthesis failed: {exc}", file=sys.stderr)
        sys.exit(1)

    print(f"Voice conversion complete: {args.output}")
    sys.exit(0)


if __name__ == "__main__":
    main()
