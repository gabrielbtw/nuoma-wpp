# Spike 3 — Hosted finalization (`--send` inside container with authenticated profile)

This is the final step to flip Spike 3 from **VERDE local + AMARELO hosted** to **VERDE hosted absoluto**, closing the IC-1 contract for V2.

## Prerequisites

1. V1 worker **stopped** (otherwise two Chromiums share the same profile dir → corruption):
   ```bash
   pm2 stop wa-worker
   pm2 list                          # confirm wa-worker is stopped
   ```
2. Image built locally:
   ```bash
   cd /Users/gabrielbraga/Projetos/nuoma-wpp/experiments/spike-3-voice
   docker build -t nuoma-spike-3-voice .
   ```
3. WhatsApp profile authenticated and reachable on host at:
   - `storage/chromium-profile/whatsapp/` (V1 default location)

## Procedure

### 1. Take a snapshot of the WhatsApp profile

Avoid mounting the live V1 profile — make a frozen copy so the spike never corrupts your real session:

```bash
cd /Users/gabrielbraga/Projetos/nuoma-wpp/experiments/spike-3-voice
mkdir -p profile-snapshot
rsync -a --delete \
  ../../storage/chromium-profile/whatsapp/ \
  profile-snapshot/
```

`rsync -a` preserves timestamps and permissions, which Chromium relies on to avoid "session expired" warnings.

### 2. Run the hosted send

```bash
docker run --rm \
  -e TARGET_PHONE=5531982066263 \
  -e CHROMIUM_PROFILE_DIR=/data/profile \
  -v "$(pwd)/profile-snapshot:/data/profile" \
  -v "$(pwd)/payloads:/app/payloads" \
  -v "$(pwd)/screenshots:/app/screenshots" \
  -v "$(pwd)/fixtures:/app/fixtures" \
  --shm-size=1g \
  --network=host \
  nuoma-spike-3-voice \
  sh -lc "xvfb-run -a npm run send"
```

Notes:

- `--shm-size=1g` avoids Chromium crashing on heavy DOM (default `/dev/shm` is 64MB inside Docker).
- `--network=host` keeps WhatsApp Web latency low and prevents any NAT-induced session refresh.
- The container reads the profile, runs the 3 calibrated voice sends (3s, 30s, 120s), captures payload snapshots and Whatsapp screenshots, then exits.

### 3. Validate result

After the run, verify three things on **your secondary phone** (`5531982066263`):

- 3 separate voice messages arrived.
- Each appears as a **native voice message** (waveform UI), NOT as an audio attachment with file icon.
- Durations displayed: 3s, 30s, 2min (or `0:03`, `0:30`, `2:00`).

Then verify on the host:

```bash
cat payloads/send-results.json
```

All three entries must show `"voiceNative": true` and `"durationErrorMs": 0`.

Finally, compare payload snapshots with the V1 baseline:

```bash
diff payloads/voice-3s.json payloads/voice-3s.baseline.json    # if baseline exists
sha256sum payloads/voice-3s.bin payloads/voice-30s.bin payloads/voice-120s.bin
```

The SHA256 hashes recorded in `REPORT.md` (G.3a) must remain stable. Any drift means the WAV header/encoding changed and IC-1 contract broke — STOP and investigate.

### 4. Cleanup

```bash
# Restore V1 worker
pm2 start wa-worker

# Optional: delete snapshot if you don't need it for re-runs
rm -rf profile-snapshot
```

## Troubleshooting

### Container shows QR/login screen

The profile is not authenticated inside the container. Causes:

- `rsync` ran before V1 ever logged in.
- File permissions got squashed by the volume mount (Linux container can't read files with macOS-only ACLs).

Fix: re-run the rsync, or chown the snapshot:

```bash
sudo chown -R $(id -u):$(id -g) profile-snapshot
```

### Chromium crashes immediately

Almost always `/dev/shm` too small. Add `--shm-size=2g` to the docker run command.

### "Profile lock" error

Another Chromium is using the profile. Stop V1 worker and any browser that might have the profile open. Verify:

```bash
ps aux | grep -i chromium | grep whatsapp | grep -v grep
```

### Voice arrives as attachment, not native

This is the IC-1 regression scenario. Likely root causes:

- Web Audio injection failed (check container logs for "MediaRecorder shim" warnings).
- ffprobe binary missing (the Dockerfile installs `ffmpeg`; check `which ffprobe` inside container).
- Profile is from a different WhatsApp Web build than the one the V1 code was tested against.

Open `screenshots/` to see what the spike captured during send. Compare with the local G.3b screenshots committed earlier.

## Decision tree

| Result | Action |
|---|---|
| 3/3 native voice + 0ms duration error + matching SHA256 | Mark Spike 3 hosted **VERDE**, update `REPORT.md`, close ADR 0010 IC-1 acceptance for V2 |
| 3/3 native voice but duration > 0ms drift | Investigate ffprobe inside container; do not regress |
| Any sent as attachment | **STOP** — IC-1 broken in container. Investigate before V2 hosted launch |

## Skill

The skill [`/wa-voice-regression`](../../.claude/skills/wa-voice-regression.md) walks through this procedure interactively and asks for confirmation at each gate.
