/**
 * Extract phone numbers from Instagram DM threads and update Nuoma contacts.
 *
 * Connects to an existing Chrome/Chromium via CDP (port 9222),
 * finds the Instagram tab, fetches inbox threads through IG private API,
 * scans messages for Brazilian phone numbers, and patches matching
 * contacts in the Nuoma web-app.
 *
 * Usage:  npx tsx scripts/extract-phones-from-ig.ts
 */

import { chromium } from "playwright";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------
const CDP_URL = "http://127.0.0.1:9222";
const NUOMA_BASE = "http://localhost:3000";
const IG_APP_ID = "936619743392459";
const THREADS_LIMIT = 20;
const MESSAGES_LIMIT = 20;
const RATE_LIMIT_MS = 1_000;

// ---------------------------------------------------------------------------
// Phone regex: matches Brazilian numbers in various formats
//   +55 11 99999-8888 | (11) 99999-8888 | 11999998888 | 55 11 999998888 etc.
// ---------------------------------------------------------------------------
const PHONE_REGEX =
  /(?:\+?55\s*)?(?:\(?\d{2}\)?[\s.-]*)(?:9[\s.-]?\d{4}[\s.-]?\d{4})/g;

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  // If starts with 55 and has 12-13 digits, strip country code
  if (digits.startsWith("55") && digits.length >= 12) {
    return digits.slice(2);
  }
  return digits;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// Instagram API helpers (executed inside the browser page context)
// ---------------------------------------------------------------------------

interface IgThread {
  thread_id: string;
  thread_title: string;
  users: Array<{ username: string; pk: number }>;
}

interface IgInboxResponse {
  inbox: {
    threads: IgThread[];
    has_older: boolean;
    oldest_cursor: string;
  };
}

interface IgThreadItem {
  item_type: string;
  text?: string;
  timestamp: number;
}

interface IgThreadDetailResponse {
  thread: {
    thread_id: string;
    items: IgThreadItem[];
    has_older: boolean;
    oldest_cursor: string;
  };
}

async function fetchIgApi<T>(
  page: import("playwright").Page,
  path: string
): Promise<T> {
  const result = await page.evaluate(async (apiPath: string) => {
    // Get CSRF token from cookies
    const csrfMatch = document.cookie.match(/csrftoken=([^;]+)/);
    const csrfToken = csrfMatch ? csrfMatch[1] : "";

    const resp = await fetch(`https://www.instagram.com${apiPath}`, {
      headers: {
        "X-CSRFToken": csrfToken,
        "X-IG-App-ID": "936619743392459",
        "X-Requested-With": "XMLHttpRequest",
      },
      credentials: "include",
    });

    if (!resp.ok) {
      throw new Error(`IG API ${resp.status}: ${resp.statusText} for ${apiPath}`);
    }

    return resp.json();
  }, path);

  return result as T;
}

// ---------------------------------------------------------------------------
// Nuoma API helpers
// ---------------------------------------------------------------------------

interface NuomaContact {
  id: string;
  name: string;
  phone: string | null;
  instagram: string | null;
  tags: string[];
}

interface NuomaContactsPage {
  data: NuomaContact[];
  total: number;
  page: number;
  pageSize: number;
}

async function searchContact(username: string): Promise<NuomaContact | null> {
  // Search by @username
  const query = `@${username}`;
  const url = `${NUOMA_BASE}/contacts?q=${encodeURIComponent(query)}&pageSize=5`;
  const resp = await fetch(url);
  if (!resp.ok) {
    console.error(`  [NUOMA] Failed to search contacts: ${resp.status}`);
    return null;
  }
  const result = (await resp.json()) as NuomaContactsPage;
  if (result.data.length === 0) return null;

  // Find exact match on instagram field
  const match = result.data.find(
    (c) =>
      c.instagram?.replace(/^@/, "").toLowerCase() === username.toLowerCase()
  );
  return match ?? result.data[0];
}

async function updateContactPhone(
  contactId: string,
  phone: string
): Promise<boolean> {
  const url = `${NUOMA_BASE}/contacts/${contactId}`;
  const resp = await fetch(url, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ phone }),
  });
  if (!resp.ok) {
    console.error(`  [NUOMA] Failed to update contact ${contactId}: ${resp.status}`);
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log("[*] Connecting to Chrome via CDP...");
  const browser = await chromium.connectOverCDP(CDP_URL);
  console.log(`[*] Connected. Contexts: ${browser.contexts().length}`);

  // Find the Instagram page
  let igPage: import("playwright").Page | null = null;
  for (const context of browser.contexts()) {
    for (const page of context.pages()) {
      const url = page.url();
      if (url.includes("instagram.com")) {
        igPage = page;
        break;
      }
    }
    if (igPage) break;
  }

  if (!igPage) {
    console.error("[!] No Instagram page found in any browser context.");
    console.error("    Make sure instagram.com is open in the Chrome connected to CDP.");
    process.exit(1);
  }

  console.log(`[*] Found Instagram page: ${igPage.url()}`);

  // ---------------------------------------------------------------------------
  // Step 1: Fetch all threads from inbox (with pagination)
  // ---------------------------------------------------------------------------
  console.log("\n[*] Fetching inbox threads...");
  const allThreads: IgThread[] = [];
  let hasOlder = true;
  let cursor: string | null = null;

  while (hasOlder) {
    let path = `/api/v1/direct_v2/inbox/?limit=${THREADS_LIMIT}`;
    if (cursor) {
      path += `&cursor=${cursor}`;
    }

    try {
      const resp = await fetchIgApi<IgInboxResponse>(igPage, path);
      const threads = resp.inbox.threads ?? [];
      allThreads.push(...threads);
      hasOlder = resp.inbox.has_older ?? false;
      cursor = resp.inbox.oldest_cursor ?? null;
      console.log(`  Fetched ${threads.length} threads (total: ${allThreads.length}, has_older: ${hasOlder})`);
    } catch (err) {
      console.error(`  [!] Error fetching inbox: ${err}`);
      hasOlder = false;
    }

    await sleep(RATE_LIMIT_MS);
  }

  console.log(`\n[*] Total threads found: ${allThreads.length}`);

  // ---------------------------------------------------------------------------
  // Step 2: For each thread, fetch messages and scan for phone numbers
  // ---------------------------------------------------------------------------
  let phonesFound = 0;
  let contactsUpdated = 0;

  for (let i = 0; i < allThreads.length; i++) {
    const thread = allThreads[i];
    const username =
      thread.users?.[0]?.username ?? thread.thread_title ?? "unknown";
    console.log(
      `\n[${i + 1}/${allThreads.length}] Processing thread: @${username} (${thread.thread_id})`
    );

    // Fetch messages
    let messages: IgThreadItem[] = [];
    try {
      const path = `/api/v1/direct_v2/threads/${thread.thread_id}/?limit=${MESSAGES_LIMIT}`;
      const resp = await fetchIgApi<IgThreadDetailResponse>(igPage, path);
      messages = resp.thread?.items ?? [];
      console.log(`  Messages fetched: ${messages.length}`);
    } catch (err) {
      console.error(`  [!] Error fetching thread messages: ${err}`);
      await sleep(RATE_LIMIT_MS);
      continue;
    }

    await sleep(RATE_LIMIT_MS);

    // Scan for phone numbers in text messages
    const phonesInThread = new Set<string>();
    for (const msg of messages) {
      if (msg.item_type !== "text" || !msg.text) continue;
      const matches = msg.text.match(PHONE_REGEX);
      if (matches) {
        for (const raw of matches) {
          const normalized = normalizePhone(raw);
          if (normalized.length >= 10 && normalized.length <= 11) {
            phonesInThread.add(normalized);
          }
        }
      }
    }

    if (phonesInThread.size === 0) {
      console.log("  No phone numbers found in messages.");
      continue;
    }

    const phones = Array.from(phonesInThread);
    phonesFound += phones.length;
    console.log(`  Phone numbers found: ${phones.join(", ")}`);

    // Search for the contact in Nuoma
    const contact = await searchContact(username);
    if (!contact) {
      console.log(`  No matching contact found for @${username} in Nuoma. Skipping.`);
      continue;
    }

    // If contact already has a phone, skip unless it is empty
    if (contact.phone && contact.phone.trim().length > 0) {
      console.log(
        `  Contact "${contact.name}" (${contact.id}) already has phone: ${contact.phone}. Skipping.`
      );
      continue;
    }

    // Use the first phone found
    const phoneToSet = phones[0];
    console.log(
      `  Updating contact "${contact.name}" (${contact.id}) with phone: ${phoneToSet}`
    );
    const ok = await updateContactPhone(contact.id, phoneToSet);
    if (ok) {
      contactsUpdated++;
      console.log(`  [OK] Contact updated successfully.`);
    }
  }

  // ---------------------------------------------------------------------------
  // Summary
  // ---------------------------------------------------------------------------
  console.log("\n========================================");
  console.log("  SUMMARY");
  console.log("========================================");
  console.log(`  Threads processed:  ${allThreads.length}`);
  console.log(`  Phone numbers found: ${phonesFound}`);
  console.log(`  Contacts updated:    ${contactsUpdated}`);
  console.log("========================================\n");
}

main().catch((err) => {
  console.error("[FATAL]", err);
  process.exit(1);
});
