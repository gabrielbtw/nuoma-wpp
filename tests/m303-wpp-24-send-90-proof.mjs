import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const cdpUrl = process.env.CDP_URL ?? "http://127.0.0.1:9223";
const phone = normalizePhone(process.env.M303_WPP_PHONE ?? process.env.WA_SEND_ALLOWED_PHONE);
const outputRoot = path.resolve(process.env.M303_WPP_PROOF_DIR ?? "data");

if (process.env.M303_CONFIRM_WPP_REAL !== "SIM") {
  throw new Error("M303 WPP proof blocked: set M303_CONFIRM_WPP_REAL=SIM");
}
if (!phone) {
  throw new Error("M303 WPP proof requires M303_WPP_PHONE or WA_SEND_ALLOWED_PHONE");
}

const runStamp = new Date().toISOString().replace(/[:.]/g, "-");
const outDir = path.join(outputRoot, `m303-wpp-24-send-90-proof-${runStamp}`);
const evidence = [];

fs.mkdirSync(outDir, { recursive: true });

try {
  const browser = await chromium.connectOverCDP(cdpUrl);
  const page = browser.contexts().flatMap((context) => context.pages()).find((item) => item.url().includes("web.whatsapp.com"));
  if (!page) {
    throw new Error(`No WhatsApp Web page found through CDP ${cdpUrl}`);
  }

  await shot(page, 1, "estado-inicial");
  await page.goto(`https://web.whatsapp.com/send?phone=${phone}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await page.waitForTimeout(6_000);
  await assertComposer(page);
  await shot(page, 2, "chat-correto-aberto", `phone=${phone}`);

  const opened24 = await openTemporaryMessagesPanel(page);
  await shot(page, 3, "painel-aberto-antes-de-24h", `opened=${opened24}; state=${JSON.stringify(await readState(page))}`);
  const clicked24 = await clickDuration(page, "24h");
  const selected24 = await waitSelected(page, "24h");
  await shot(page, 4, "radio-24h-marcado", `click=${JSON.stringify(clicked24)}; state=${JSON.stringify(selected24)}`);
  await closeSidePanel(page);
  const notice24 = await waitLatestNotice(page, "24h");
  await shot(page, 5, "saiu-do-painel-popup-24h-visivel", `notice=${JSON.stringify(notice24)}`);

  const message = process.env.M303_WPP_PROOF_MESSAGE ?? `M30.3 prova oficial ${nowBr()} - envio com temporarias 24h; restaurar para 90d em seguida.`;
  await typeAndSend(page, message);
  await shot(page, 6, "mensagem-enviada-com-24h", message);

  const opened90 = await openTemporaryMessagesPanel(page);
  await shot(page, 7, "painel-aberto-antes-restaurar-90d", `opened=${opened90}; state=${JSON.stringify(await readState(page))}`);
  const clicked90 = await clickDuration(page, "90d");
  const selected90 = await waitSelected(page, "90d");
  await shot(page, 8, "radio-90d-marcado", `click=${JSON.stringify(clicked90)}; state=${JSON.stringify(selected90)}`);
  await closeSidePanel(page);
  const notice90 = await waitLatestNotice(page, "90d");
  await shot(page, 9, "saiu-do-painel-popup-90d-visivel", `notice=${JSON.stringify(notice90)}`);

  const reopened = await openTemporaryMessagesPanel(page);
  const finalState = await waitSelected(page, "90d");
  await shot(page, 10, "painel-reaberto-final-90d-marcado", `opened=${reopened}; state=${JSON.stringify(finalState)}`);

  const report = { phone, outDir, message, notice24, notice90, finalState, evidence };
  fs.writeFileSync(path.join(outDir, "evidence.json"), `${JSON.stringify(report, null, 2)}\n`);
  console.log(
    [
      "m303-wpp-24-send-90-proof",
      `phone=${phone}`,
      `notice24=${notice24.duration}`,
      `notice90=${notice90.duration}`,
      `finalSelected=${finalState.selected}`,
      `proofDir=${outDir}`,
      "ig=nao_aplicavel",
    ].join("|"),
  );
  await browser.close();
} catch (error) {
  console.error(`m303-wpp-24-send-90-proof|failed|proofDir=${outDir}|error=${error.message}`);
  process.exitCode = 1;
}

function normalizePhone(value) {
  const digits = String(value ?? "").split(",")[0]?.replace(/\D/g, "") ?? "";
  return digits || null;
}

function nowBr() {
  return new Date().toLocaleString("pt-BR", {
    timeZone: "America/Sao_Paulo",
    hour12: false,
  });
}

async function assertComposer(page) {
  await page.waitForSelector("#main footer [contenteditable='true']", { timeout: 20_000 });
}

async function stamp(page, label, extra = "") {
  await page.evaluate(
    ({ label, extra, now }) => {
      let marker = document.getElementById("__codex_m303_stamp");
      if (!marker) {
        marker = document.createElement("div");
        marker.id = "__codex_m303_stamp";
        document.body.appendChild(marker);
      }
      Object.assign(marker.style, {
        position: "fixed",
        left: "8px",
        bottom: "8px",
        zIndex: "2147483647",
        background: "#fde047",
        color: "#111827",
        border: "2px solid #111827",
        borderRadius: "4px",
        padding: "7px 9px",
        font: "700 13px/1.3 Arial, sans-serif",
        whiteSpace: "pre-wrap",
        maxWidth: "620px",
        pointerEvents: "none",
      });
      marker.textContent = `M30.3 PROVA WPP | ${now}\n${label}${extra ? `\n${extra}` : ""}`;
    },
    { label, extra, now: nowBr() },
  );
}

async function shot(page, index, label, extra = "") {
  await stamp(page, `${String(index).padStart(2, "0")} ${label}`, extra);
  await page.waitForTimeout(250);
  const file = path.join(outDir, `${String(index).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const row = { index, label, file, at: new Date().toISOString(), extra };
  evidence.push(row);
  console.log(`proof|${index}|${label}|${file}|${row.at}|${extra}`);
  return file;
}

async function openTemporaryMessagesPanel(page) {
  await page.evaluate(() => {
    const header = document.querySelector("#main header");
    const target = header?.querySelector("[role='button'],button") || header;
    target?.click();
  });
  await page.waitForTimeout(1_200);
  let clicked = await clickByText(page, [
    "Mensagens temporarias",
    "Mensagens temporárias",
    "Disappearing messages",
    "Mensajes temporales",
  ]);
  if (!clicked) {
    await page.evaluate(() => {
      const nodes = visibleNodes("#main header button[aria-label], #main header [role='button'][aria-label], #main header span[data-icon='menu'], #main header span[data-icon='down']");
      const node = nodes.reverse()[0];
      const target = node?.closest("button") || node?.closest("[role='button']") || node;
      target?.click();

      function visibleNodes(selector) {
        return Array.from(document.querySelectorAll(selector)).filter((item) => {
          if (!(item instanceof HTMLElement)) return false;
          const rect = item.getBoundingClientRect();
          const style = getComputedStyle(item);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        });
      }
    });
    await page.waitForTimeout(800);
    clicked = await clickByText(page, [
      "Mensagens temporarias",
      "Mensagens temporárias",
      "Disappearing messages",
      "Mensajes temporales",
    ]);
  }
  await page.waitForTimeout(1_200);
  return clicked;
}

async function clickByText(page, needles, selector = "button,[role='button'],[role='menuitem'],div,span") {
  return page.evaluate(
    ({ needles, selector }) => {
      const normalized = needles.map(clean);
      const match = visibleNodes(selector)
        .map((node) => ({
          node,
          text: clean(node.textContent || node.getAttribute("aria-label") || node.getAttribute("title") || ""),
        }))
        .filter((item) => normalized.some((needle) => item.text.includes(needle)))
        .sort((a, b) => a.text.length - b.text.length)[0]?.node;
      if (!match) return false;
      const target = match.closest("button") || match.closest("[role='button']") || match.closest("[role='menuitem']") || match;
      target.scrollIntoView({ block: "center", inline: "center" });
      target.click();
      return true;

      function clean(value) {
        return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
      }
      function visibleNodes(innerSelector) {
        return Array.from(document.querySelectorAll(innerSelector)).filter((item) => {
          if (!(item instanceof HTMLElement)) return false;
          const rect = item.getBoundingClientRect();
          const style = getComputedStyle(item);
          return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
        });
      }
    },
    { needles, selector },
  );
}

async function clickDuration(page, duration) {
  return page.evaluate((requestedDuration) => {
    const labels = {
      "24h": ["24 horas", "24 hours", "24 h"],
      "7d": ["7 dias", "7 days", "7 d"],
      "90d": ["90 dias", "90 days", "90 d", "3 meses", "3 months"],
    }[requestedDuration].map(clean);
    const label = visibleNodes("label,span,div")
      .filter((node) => rightPanelNode(node))
      .map((node) => ({ node, text: clean(node.textContent || "") }))
      .filter((item) => labels.some((candidate) => item.text === candidate || item.text.includes(candidate)))
      .sort((a, b) => optionScore(a, labels) - optionScore(b, labels))[0]?.node;
    if (!label) return { ok: false, reason: "label-not-found" };

    const row = label.closest("label") || label.parentElement;
    const input = row?.querySelector("input[aria-checked], input[type='radio'], [role='radio'], [aria-checked]");
    const target = input instanceof HTMLElement ? input : row instanceof HTMLElement ? row : label;
    target.scrollIntoView({ block: "center", inline: "center" });
    const rect = target.getBoundingClientRect();
    target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 }));
    target.click();
    return { ok: true, target: target.tagName, text: (target.textContent || target.getAttribute("aria-label") || "").slice(0, 80) };

    function optionScore(item, exactLabels) {
      return (exactLabels.includes(item.text) ? 0 : 1_000) + item.text.length;
    }
    function rightPanelNode(node) {
      return node instanceof HTMLElement && node.getBoundingClientRect().left > window.innerWidth * 0.58;
    }
    function clean(value) {
      return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    }
    function visibleNodes(selector) {
      return Array.from(document.querySelectorAll(selector)).filter((item) => {
        if (!(item instanceof HTMLElement)) return false;
        const rect = item.getBoundingClientRect();
        const style = getComputedStyle(item);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
    }
  }, duration);
}

async function closeSidePanel(page) {
  await page.evaluate(() => {
    const back = visibleNodes("button, [role='button'], span[data-icon='back'], span[data-icon='back-refreshed']")
      .filter((node) => node.getBoundingClientRect().left > window.innerWidth * 0.58)
      .find((node) => /voltar|back|back-refreshed/i.test(node.getAttribute("aria-label") || node.getAttribute("title") || node.getAttribute("data-icon") || node.textContent || ""));
    const target = back?.closest("button") || back?.closest("[role='button']") || back;
    target?.click();

    function visibleNodes(selector) {
      return Array.from(document.querySelectorAll(selector)).filter((item) => {
        if (!(item instanceof HTMLElement)) return false;
        const rect = item.getBoundingClientRect();
        const style = getComputedStyle(item);
        return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
      });
    }
  });
  await page.waitForTimeout(1_500);
}

async function typeAndSend(page, message) {
  const composer = page.locator("#main footer [contenteditable='true']").last();
  await composer.click({ timeout: 10_000 });
  await composer.fill(message);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(2_500);
}

async function waitSelected(page, expected, timeoutMs = 8_000) {
  const started = Date.now();
  let state = null;
  while (Date.now() - started < timeoutMs) {
    state = await readState(page);
    if (state.selected === expected) return state;
    await page.waitForTimeout(400);
  }
  throw new Error(`selected duration did not become ${expected}: ${JSON.stringify(state)}`);
}

async function waitLatestNotice(page, expected, timeoutMs = 10_000) {
  const started = Date.now();
  let state = null;
  while (Date.now() - started < timeoutMs) {
    state = await readState(page);
    if (state.latestNotice?.duration === expected) return state.latestNotice;
    await page.waitForTimeout(500);
  }
  throw new Error(`latest visible notice did not become ${expected}: ${JSON.stringify(state)}`);
}

async function readState(page) {
  return page.evaluate(() => {
    const optionNodes = Array.from(document.querySelectorAll("input[aria-checked], input[type='radio'], [role='radio'], [aria-checked]"))
      .filter((node) => isVisible(node) && rightPanelNode(node));
    const options = optionNodes.map((node) => ({
      duration: optionDuration(node),
      ariaChecked: node.getAttribute("aria-checked"),
      checked: "checked" in node ? Boolean(node.checked) : null,
    }));
    const selected = options.find((item) => item.ariaChecked === "true" || item.checked === true)?.duration || null;
    const latestNotice = Array.from(document.querySelectorAll("#main div, #main span"))
      .filter(isVisible)
      .map((node) => {
        const rect = node.getBoundingClientRect();
        const text = (node.textContent || "").replace(/\s+/g, " ").trim();
        const duration = /voce atualizou a duracao das mensagens temporarias|você atualizou a duração das mensagens temporárias|voce ativou as mensagens temporarias|você ativou as mensagens temporárias/i.test(text)
          ? durationFromText(text)
          : null;
        return duration ? { text: text.slice(0, 220), duration, top: Math.round(rect.top), left: Math.round(rect.left) } : null;
      })
      .filter(Boolean)
      .sort((a, b) => b.top - a.top)[0] || null;

    return {
      selected,
      options,
      latestNotice,
      header: document.querySelector("#main header")?.textContent?.replace(/\s+/g, " ").trim().slice(0, 180) || null,
      composer: Boolean(document.querySelector("#main footer [contenteditable='true']")),
    };

    function optionDuration(node) {
      const texts = [
        node.getAttribute("aria-label"),
        node.getAttribute("title"),
        node.textContent,
        node.closest("label")?.textContent,
        node.parentElement?.textContent,
        node.nextElementSibling?.textContent,
        node.parentElement?.querySelector("span")?.textContent,
      ];
      for (const text of texts) {
        const duration = durationFromText(text || "");
        if (duration) return duration;
      }
      return null;
    }
    function durationFromText(value) {
      const text = clean(value);
      if (/(^|[^0-9])24\s*(h|hora|horas|hour|hours)([^a-z]|$)/i.test(text)) return "24h";
      if (/(^|[^0-9])7\s*(d|dia|dias|day|days)([^a-z]|$)/i.test(text)) return "7d";
      if (/(^|[^0-9])90\s*(d|dia|dias|day|days)([^a-z]|$)/i.test(text)) return "90d";
      if (/(^|[^0-9])3\s*(mes|meses|month|months)([^a-z]|$)/i.test(text)) return "90d";
      return null;
    }
    function rightPanelNode(node) {
      return node instanceof HTMLElement && node.getBoundingClientRect().left > window.innerWidth * 0.58;
    }
    function isVisible(node) {
      if (!(node instanceof HTMLElement)) return false;
      const rect = node.getBoundingClientRect();
      const style = getComputedStyle(node);
      return rect.width > 0 && rect.height > 0 && style.display !== "none" && style.visibility !== "hidden";
    }
    function clean(value) {
      return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/\s+/g, " ").trim().toLowerCase();
    }
  });
}
