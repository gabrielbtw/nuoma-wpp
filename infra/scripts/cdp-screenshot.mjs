#!/usr/bin/env node
import { mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

import { chromium } from "playwright";

const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const whatsappUrl = process.env.WA_WEB_URL ?? "https://web.whatsapp.com/";
const outputPath = resolve(process.argv[2] ?? "data/hosted-whatsapp-screen.png");

const browser = await chromium.connectOverCDP(cdpUrl);

try {
  const context = browser.contexts()[0] ?? (await browser.newContext());
  let page = context.pages().find((candidate) => candidate.url().startsWith(whatsappUrl));
  page ??= context.pages()[0] ?? (await context.newPage());

  if (!page.url().startsWith(whatsappUrl)) {
    await page.goto(whatsappUrl, {
      waitUntil: "domcontentloaded",
      timeout: 45_000,
    });
  }

  await page.setViewportSize({ width: 1366, height: 768 });
  await page.waitForTimeout(2_000);
  await mkdir(dirname(outputPath), { recursive: true });
  await page.screenshot({ path: outputPath, fullPage: true });
  console.log(`wrote ${outputPath}`);
} finally {
  await browser.close();
}
