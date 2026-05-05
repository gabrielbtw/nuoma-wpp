import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { createJsonlSyncEventRecorder, replayJsonlSyncEvents } from "./event-recorder.js";
import type { SyncEvent } from "./events.js";
import { filterWhatsAppFlowTrace } from "./wa-flow-trace.js";

describe("sync event recorder", () => {
  it("records JSONL events and replays a phone-scoped WhatsApp trace", async () => {
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "nuoma-v2-sync-recorder-"));
    const filePath = path.join(tempDir, "events.jsonl");
    const recorder = createJsonlSyncEventRecorder(filePath);
    const event: SyncEvent = {
      type: "reconcile-snapshot",
      source: "wa-web",
      observedAtUtc: "2026-04-30T18:37:00.000Z",
      thread: {
        channel: "whatsapp",
        externalThreadId: "5531982066263@c.us",
        title: "5531982066263",
        phone: "5531982066263",
        unreadCount: 0,
        fingerprint: null,
      },
      details: {
        reason: "test",
      },
    };

    try {
      recorder.write(event);
      await recorder.close();
      const replayed = await replayJsonlSyncEvents(filePath);
      const trace = filterWhatsAppFlowTrace(replayed, { phone: "55 (31) 98206-6263" });

      expect(replayed).toEqual([event]);
      expect(trace).toEqual([event]);
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true });
    }
  });
});
