# V2 Job Queue + Worker Base

Status: V2.5 worker base closed; text, voice, document, image and video senders
smoke-tested with the active-target guard, including multi-image album sends.

## Scope

The V2.5 worker owns durable job execution primitives plus guarded WhatsApp
text, voice, document, image and video senders.

Implemented:

- `jobs.priority` from `0` to `9`; lower number runs first.
- `jobs_dead` DLQ with manual retry.
- `worker_state` heartbeat.
- `scheduler_locks` single-owner locks for future scheduler ticks.
- Worker loop claims one due job at a time.
- Graceful shutdown for `SIGTERM`/`SIGINT`.
- Memory pressure check with browser restart when browser mode is enabled.
- Admin endpoints:
  - `GET /api/admin/jobs/dead`
  - `POST /api/admin/jobs/dead/:id/retry`
  - `POST /api/admin/jobs/cleanup`
- `send_message` jobs can send real WhatsApp text when a connected CDP sync
  runtime is available and the send policy allows the target phone.
- `send_voice` jobs can send real native WhatsApp voice messages when a
  connected CDP sync runtime is available and the send policy allows the target
  phone.
- The Inbox Composer can create `send_voice` jobs through `messages.sendVoice`:
  browser recording is uploaded as a `voice` media asset, the API resolves the
  stored `audioPath`, applies the manual `5531982066263` hard guard plus the
  API send allowlist before job creation, and the worker still performs the
  ffprobe/ffmpeg preparation before touching WhatsApp.
- `campaign_step` jobs can send text, link, voice, document, image and video
  steps through the same send policy and active-chat guard. Image steps accept
  optional `mediaAssetIds[]` to send multiple images in one WhatsApp preview.
- The sender records completion system events with:
  - `jobId`
  - target `conversationId`/`phone`
  - `navigationMode`
  - visible message count before/after
  - last visible external id before/after
- The voice sender records voice evidence with:
  - `jobId`
  - target `conversationId`/`phone`
  - source audio path and prepared WAV path
  - duration from `ffprobe`/`afinfo`
  - WAV sample rate/channel/bit depth evidence
  - `navigationMode`
  - native voice evidence
  - displayed voice duration
  - last visible external id before/after
- IC-2 exists as an opt-in path: when
  `WORKER_SEND_REUSE_OPEN_CHAT_ENABLED=true`, consecutive sends to the same open
  chat may return `navigationMode="reused-open-chat"`. The default production
  posture is stricter: every send navigates to `/send?phone=...` before touching
  the composer.

## Safety

`WORKER_BROWSER_ENABLED=false` by default. The worker can process safe
operational jobs such as `backup`. Send-like jobs are not claimed unless the
handler context has a connected WhatsApp sync runtime.

`send_message`, `send_voice`, `send_document`, `send_media` and
`campaign_step` have an additional send policy gate before the worker touches
the WhatsApp runtime:

- `WA_SEND_POLICY_MODE=test` requires `WA_SEND_ALLOWED_PHONES` or legacy
  `WA_SEND_ALLOWED_PHONE` to include the resolved target phone.
- `WA_SEND_POLICY_MODE=production` allows valid WhatsApp targets; if
  `WA_SEND_ALLOWED_PHONES`/`WA_SEND_ALLOWED_PHONE` is still configured, it acts
  as a production canary allowlist.
- `WA_SEND_RATE_LIMIT_MAX` within `WA_SEND_RATE_LIMIT_WINDOW_MS` is enforced
  from persisted `sender.send_policy.allowed` events before sending.
- Every allowed or blocked decision writes `sender.send_policy.allowed` or
  `sender.send_policy.blocked` with job id, job type, phone, policy mode and
  rate-limit context.
- The conversation must be `channel="whatsapp"`.
- `send_message` payload must include a non-empty text body.
- `send_voice` payload must include an audio path, and the prepared audio must
  be valid WAV PCM 48kHz mono 16-bit.
- `campaign_step` can execute `text`, `link`, `voice`, `document`, `image` and
  `video` steps only after the same runtime and send-policy checks pass. It records
  `sender.campaign_step.completed` with campaign, recipient and step metadata.
- The campaign scheduler tick is available through `campaigns.tick`: it scans
  `running`/due `scheduled` campaigns, creates deduped `campaign_step` jobs,
  stores `awaitingJobId` on the recipient to prevent duplicate sends, and lets
  the worker clear that marker after step completion.
- `campaigns.tick` also supports `dryRun=true`, returning `plannedJobs` without
  creating jobs, conversations or mutating campaign recipients.
- The API can run the same scheduler as an opt-in daemon with
  `API_CAMPAIGN_SCHEDULER_ENABLED=true`. It is disabled by default and uses
  `API_CAMPAIGN_SCHEDULER_INTERVAL_MS` plus `API_CAMPAIGN_SCHEDULER_USER_ID`.
- Operational decision for the current single-user hosted phase: the periodic
  campaign scheduler runs inside the API process. No separate `scheduler`
  process/container is required until the deployment needs multiple API
  replicas or scheduler isolation.

Unsupported message-producing job types still move to DLQ with an explicit
error when claimed by a connected runtime:

- `send_instagram_message`
- `chatbot_reply`

No WhatsApp message is sent when test policy has no matching allowlist, when
production canary allowlist does not include the phone, or when the rate limit
is exceeded.

## Retry Policy

- Send-like jobs use a linear 60 second retry once real handlers exist.
- Validation/sync-like jobs use exponential backoff capped at 5 minutes.
- Permanent handler gaps go straight to DLQ.
- Jobs move to DLQ once `attempts >= maxAttempts`.

## Worker Runtime

Browser mode uses Playwright `launchPersistentContext` with:

- profile: `CHROMIUM_PROFILE_DIR`
- CDP port: `CHROMIUM_CDP_PORT`
- optional Xvfb when `WORKER_HEADLESS=false`

Default V2 config keeps browser disabled to protect the V1 WhatsApp session
during coexistence.

## Smoke Evidence

On 2026-05-04, real WhatsApp sends to the dedicated test number
`5531982066263` completed through the worker:

- Job `14`: UI-created `send_message`, completed, inserted outbound message
  `3EB0880875BEB2E146393A`.
- Jobs `15` and `16`: queued together for the same conversation. Job `15`
  returned `navigationMode="navigated"`; job `16` returned
  `navigationMode="reused-open-chat"`, proving IC-2 for consecutive text steps.
- Job `21`: 3s native voice fixture completed with
  `nativeVoiceEvidence=true`, displayed duration `3s`, and external id
  `3EB03B793C90660031C4E2`.
- Job `23`: `/Users/gabrielbraga/Desktop/Rebote.ogg` was converted from
  Ogg/Opus to WAV PCM 48kHz mono 16-bit and sent as native voice, with
  `nativeVoiceEvidence=true`, displayed duration `15s`, and external id
  `3EB06D60FF806553502D99`.
- Jobs `24` and `25`: 30s and 120s native voice fixtures completed. Job `25`
  returned `navigationMode="reused-open-chat"`, proving the reuse path for
  consecutive voice sends too.
- Final V2.5 batch: valid jobs `46`, `47`, `48`, `40`, `44`, `45`, `41`, `42`
  and `43` sent the user's 9-file batch to `5531982066263`: 3 native voice
  messages, 1 video and 5 images. The images persisted as `content_type=image`,
  not stickers. Final audit returned zero active jobs, zero `grouped-sticker--`
  rows, zero active duplicate external IDs and zero completed sender events
  outside the configured test allowlist.
- Job `19` on the hosted server validated one `campaign_step` image album with
  `mediaAssetIds=[1,3,4,5]`. The worker attached 4 image files in the same media
  input, completed with `mediaCount=4`, `captionSent=true`, and external id
  `3EB017F9D9A33390EF1D95`.

The smoke also exposed and fixed current WhatsApp DOM direction parsing for
outbound bubbles whose `data-id` no longer starts with `true_`.
It also hardened media reconciliation so synthetic `grouped-sticker--...`
wrappers and stale IDs from partial visible windows are not accepted as the
new send result.

## Pending

- External scheduler process split, if the API-embedded daemon stops being
  enough for hosted operations.
- Hosted runbook should decide whether the API-embedded daemons remain enough or
  whether campaign/sender scheduling moves to a dedicated scheduler process.
