---
name: wa-voice-regression
description: Validate IC-1 WhatsApp native voice behavior: Web Audio/MediaRecorder injection, WAV 48kHz mono 16-bit, ffprobe duration and native voice delivery evidence.
user_invocable: true
---

# /wa-voice-regression

Use before touching voice/audio send code or when proving IC-1.

## Invariant

Owner-approved behavior must not regress: WhatsApp receives native voice messages, not file attachments, with accurate duration.

## Rules

- Do not refactor the voice pipeline casually.
- Use a test phone, never production target without explicit approval.
- Do not claim success without visual evidence and duration check.
- Preserve no-relaunch/no-unnecessary-focus behavior during recording.

## Validate

Run the existing worker tests/smokes for the changed scope. For real sends, capture screenshot/video evidence and record target/canal.
