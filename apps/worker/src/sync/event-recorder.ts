import * as fs from "node:fs";
import * as readline from "node:readline";
import { finished } from "node:stream/promises";

import type { SyncEvent } from "./events.js";
import { parseSyncEventPayload } from "./events.js";

export interface SyncEventRecorder {
  write: (event: SyncEvent) => void;
  close: () => Promise<void>;
}

export function createJsonlSyncEventRecorder(filePath: string): SyncEventRecorder {
  const stream = fs.createWriteStream(filePath, { flags: "a" });

  return {
    write: (event) => {
      stream.write(`${JSON.stringify(event)}\n`);
    },
    close: async () => {
      stream.end();
      await finished(stream);
    },
  };
}

export async function replayJsonlSyncEvents(filePath: string): Promise<SyncEvent[]> {
  const stream = fs.createReadStream(filePath, { encoding: "utf8" });
  const lines = readline.createInterface({
    input: stream,
    crlfDelay: Infinity,
  });
  const events: SyncEvent[] = [];

  for await (const line of lines) {
    if (!line.trim()) {
      continue;
    }
    events.push(parseSyncEventPayload(line));
  }

  return events;
}
