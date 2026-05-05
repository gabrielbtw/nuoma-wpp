import { describe, expect, it } from "vitest";
import { chromium } from "playwright";

import { createWhatsAppObserverScript } from "./observer-script.js";

describe("WhatsApp observer script", () => {
  it("emits message-added events from static WhatsApp-like HTML", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const events: unknown[] = [];

    try {
      await page.exposeFunction("__nuomaSync", (payload: string) => {
        events.push(JSON.parse(payload) as unknown);
      });
      await page.setContent(`
        <main id="app">
          <header><span title="5531982066263">5531982066263</span></header>
          <section id="pane-side"><div>5531982066263 Oi 15:34</div></section>
          <section id="main">
            <span>Hoje</span>
            <div data-id="false_5531982066263@c.us_MSG1">
              <div class="copyable-text" data-pre-plain-text="[15:34, 30/04/2026] Maria: ">
                <span class="selectable-text">Oi</span>
              </div>
            </div>
            <div data-id="false_5531982066263@c.us_MSG2">
              <div class="copyable-text" data-pre-plain-text="[15:34, 30/04/2026] Maria: ">
                <span class="selectable-text">Tudo bem?</span>
              </div>
            </div>
            <div data-id="true_5531982066263@c.us_MSG3">
              <button aria-label="Reproduzir mensagem de voz">ic-play-arrow-filled</button>
              <div data-testid="msg-meta"><span>15:35</span><span data-testid="msg-dblcheck">msg-dblcheck</span></div>
            </div>
          </section>
        </main>
      `);
      await page.evaluate(createWhatsAppObserverScript());
      await page.waitForFunction("Boolean(globalThis.__nuomaSyncObserverInstalled)");
      await page.waitForTimeout(250);
      const summary = await page.evaluate(() => {
        return (
          globalThis as unknown as {
            __nuomaSyncReconcile: (
              reason: string,
              details: Record<string, unknown>,
            ) => { visibleExternalIds: string[] };
          }
        ).__nuomaSyncReconcile("test-hot-window", {
          conversationId: 123,
          candidatePhone: "5531982066263",
        });
      });
      await page.waitForTimeout(250);

      expect(summary.visibleExternalIds).toEqual([
        "false_5531982066263@c.us_MSG1",
        "false_5531982066263@c.us_MSG2",
        "true_5531982066263@c.us_MSG3",
      ]);
    } finally {
      await browser.close();
    }

    const messageEvents = events.filter(
      (
        event,
      ): event is {
        type: string;
        message: {
          externalId: string;
          direction: string;
          raw: Record<string, unknown>;
          timestampPrecision: string;
          waDisplayedAt: string;
          waInferredSecond: number;
        };
      } => isMessageEvent(event),
    );

    const uniqueById = new Map(messageEvents.map((event) => [event.message.externalId, event]));

    expect([...uniqueById.keys()]).toEqual([
      "false_5531982066263@c.us_MSG1",
      "false_5531982066263@c.us_MSG2",
      "true_5531982066263@c.us_MSG3",
    ]);
    expect(uniqueById.get("false_5531982066263@c.us_MSG1")?.message.waDisplayedAt).toBe(
      "2026-04-30T15:34:00.000-03:00",
    );
    expect(uniqueById.get("false_5531982066263@c.us_MSG1")?.message.direction).toBe("inbound");
    expect(uniqueById.get("true_5531982066263@c.us_MSG3")?.message.direction).toBe("outbound");
    expect(uniqueById.get("true_5531982066263@c.us_MSG3")?.message.waDisplayedAt).toContain(
      "T15:35:00.000-03:00",
    );
    expect([...uniqueById.values()].map((event) => event.message.timestampPrecision)).toEqual([
      "minute",
      "minute",
      "minute",
    ]);
    expect([...uniqueById.values()].map((event) => event.message.waInferredSecond)).toEqual([
      58, 59, 59,
    ]);
    expect(uniqueById.get("false_5531982066263@c.us_MSG1")?.message.raw).toEqual(
      expect.objectContaining({
        reconcileDetails: {
          conversationId: 123,
          candidatePhone: "5531982066263",
        },
        reconcileReason: "test-hot-window",
      }),
    );

    const reconcileEvent = events.find(
      (
        event,
      ): event is {
        type: string;
        details: { reason: string; visibleMessageCount: number };
      } =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        (event as { type: unknown }).type === "reconcile-snapshot" &&
        "details" in event &&
        (event as { details: { reason?: unknown } }).details.reason === "test-hot-window",
    );
    expect(reconcileEvent?.details.reason).toBe("test-hot-window");
    expect(reconcileEvent?.details.visibleMessageCount).toBe(3);
  }, 30_000);

  it("can reconcile visible sidebar chats without using the composer", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const events: unknown[] = [];

    try {
      await page.exposeFunction("__nuomaSync", (payload: string) => {
        events.push(JSON.parse(payload) as unknown);
      });
      await page.setContent(`
        <main id="app">
          <section id="pane-side">
            <div role="listitem" data-testid="cell-frame-container" onclick="
              document.querySelector('#main header span').setAttribute('title', '5531982066263');
              document.querySelector('#main header span').textContent = '5531982066263';
              document.querySelector('#main [data-id]').setAttribute('data-id', 'false_5531982066263@c.us_MSG1');
              document.querySelector('#main .selectable-text').textContent = 'Oi';
            "><span title="5531982066263">5531982066263</span><span>Oi</span><span>15:34</span></div>
            <div role="listitem" data-testid="cell-frame-container" onclick="
              document.querySelector('#main header span').setAttribute('title', '5531999999999');
              document.querySelector('#main header span').textContent = '5531999999999';
              document.querySelector('#main [data-id]').setAttribute('data-id', 'false_5531999999999@c.us_MSG2');
              document.querySelector('#main .selectable-text').textContent = 'Novo chat';
            "><span title="5531999999999">5531999999999</span><span>Novo chat</span><span>15:35</span></div>
          </section>
          <section id="main">
            <header><span title="5531982066263">5531982066263</span></header>
            <span>Hoje</span>
            <div data-id="false_5531982066263@c.us_MSG1">
              <div class="copyable-text" data-pre-plain-text="[15:34, 30/04/2026] Maria: ">
                <span class="selectable-text">Oi</span>
              </div>
              <div data-testid="msg-meta"><span>15:34</span></div>
            </div>
          </section>
        </main>
      `);
      await page.evaluate(createWhatsAppObserverScript());
      await page.waitForFunction("Boolean(globalThis.__nuomaSyncObserverInstalled)");
      const result = await page.evaluate(() =>
        (
          globalThis as unknown as {
            __nuomaSyncReconcileHotWindow: (input: {
              reason: string;
              limit: number;
              delayMs: number;
              navigateByUrl?: boolean;
            }) => Promise<{ mode: string; visited: number; restored: boolean }>;
          }
        ).__nuomaSyncReconcileHotWindow({
          reason: "test-multi-chat",
          limit: 2,
          delayMs: 250,
          navigateByUrl: false,
        }),
      );
      await page.waitForTimeout(250);

      expect(result.mode).toBe("multi-chat");
      expect(result.visited).toBe(2);
      expect(result.restored).toBe(true);
    } finally {
      await browser.close();
    }

    const multiChatSnapshots = events.filter(
      (
        event,
      ): event is {
        type: string;
        details: { scope: string };
      } =>
        typeof event === "object" &&
        event !== null &&
        "type" in event &&
        (event as { type: unknown }).type === "reconcile-snapshot" &&
        "details" in event &&
        (event as { details: { scope?: unknown } }).details.scope === "multi-chat",
    );

    expect(multiChatSnapshots.length).toBeGreaterThanOrEqual(3);
  }, 30_000);

  it("detects current WhatsApp outbound bubbles without true_ data-id prefixes", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const events: unknown[] = [];

    try {
      await page.exposeFunction("__nuomaSync", (payload: string) => {
        events.push(JSON.parse(payload) as unknown);
      });
      await page.setContent(`
        <main id="app">
          <header><span title="Gabriel Braga Nuoma">Gabriel Braga Nuoma</span></header>
          <section id="pane-side"><div>Gabriel Braga Nuoma 01:15</div></section>
          <section id="main">
            <span>Hoje</span>
            <div data-id="3EB0F667409EE4B4A71CD3" data-testid="conv-msg-3EB0F667409EE4B4A71CD3">
              <div role="row">
                <div class="message-out focusable-list-item">
                  <div data-testid="msg-container">
                    <span aria-label="Você:"></span>
                    <div class="copyable-text" data-pre-plain-text="[01:15, 04/05/2026] Nuoma: ">
                      <span data-testid="selectable-text">Teste V2.5 IC2 passo 2</span>
                    </div>
                    <div data-testid="msg-meta" role="button"><span>01:15</span><span>msg-dblcheck</span></div>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
      `);
      await page.evaluate(createWhatsAppObserverScript());
      await page.waitForFunction("Boolean(globalThis.__nuomaSyncObserverInstalled)");
      await page.waitForTimeout(250);
    } finally {
      await browser.close();
    }

    const messageEvents = events.filter(
      (
        event,
      ): event is {
        type: string;
        message: { externalId: string; direction: string; body: string | null; status: string };
      } => isMessageEvent(event),
    );
    const message = messageEvents.find(
      (event) => event.message.externalId === "3EB0F667409EE4B4A71CD3",
    )?.message;

    expect(message).toEqual(
      expect.objectContaining({
        direction: "outbound",
        body: "Teste V2.5 IC2 passo 2",
        status: "sent",
      }),
    );
  }, 30_000);

  it("skips WhatsApp grouped-sticker wrapper nodes when collecting visible messages", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const events: unknown[] = [];

    try {
      await page.exposeFunction("__nuomaSync", (payload: string) => {
        events.push(JSON.parse(payload) as unknown);
      });
      await page.setContent(`
        <main id="app">
          <header><span title="Gabriel Braga Nuoma">Gabriel Braga Nuoma</span></header>
          <section id="main">
            <div data-id="3EB07301C3D42B95057EBF">
              <img alt="Imagem" />
              <div data-testid="msg-meta"><span>08:30</span><span>msg-dblcheck</span></div>
            </div>
            <div data-id="grouped-sticker--3EB07301C3D42B95057EBF-3EB04CB1B2C7CAB86E3795">
              <img alt="Imagem agrupada" />
              <div data-testid="msg-meta"><span>08:30</span><span>msg-dblcheck</span></div>
            </div>
            <div data-id="3EB06C5EC79EA18C4719DE">
              <img alt="Imagem" />
              <div data-testid="msg-meta"><span>08:31</span><span>msg-dblcheck</span></div>
            </div>
          </section>
        </main>
      `);
      await page.evaluate(createWhatsAppObserverScript());
      await page.waitForFunction("Boolean(globalThis.__nuomaSyncObserverInstalled)");
      await page.waitForTimeout(250);
      const summary = await page.evaluate(() => {
        return (
          globalThis as unknown as {
            __nuomaSyncReconcile: (reason: string, details: Record<string, unknown>) => {
              lastExternalId: string | null;
              visibleExternalIds: string[];
            };
          }
        ).__nuomaSyncReconcile("test-grouped-sticker-wrapper", {
          conversationId: 28654,
          candidatePhone: "5531982066263",
        });
      });

      expect(summary.visibleExternalIds).toEqual([
        "3EB07301C3D42B95057EBF",
        "3EB06C5EC79EA18C4719DE",
      ]);
      expect(summary.lastExternalId).toBe("3EB06C5EC79EA18C4719DE");
    } finally {
      await browser.close();
    }

    expect(
      events.some(
        (event) =>
          isMessageEvent(event) &&
          event.message.externalId.startsWith("grouped-sticker--"),
      ),
    ).toBe(false);
  }, 30_000);

  it("keeps named sidebar candidates observable while allowing CDP to skip no-phone rows", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.exposeFunction("__nuomaSync", () => {});
      await page.setContent(`
        <main id="app">
          <section id="pane-side">
            <div role="listitem" data-testid="cell-frame-container" aria-selected="true">
              <span title="5531982066263">5531982066263</span><span>Atual</span><span>15:34</span>
            </div>
            <div role="listitem" data-testid="cell-frame-container">
              <span title="Cliente Sem Telefone">Cliente Sem Telefone</span><span>Mensagem</span><span>15:35</span>
            </div>
            <div role="listitem" data-testid="cell-frame-container">
              <span title="5531999999999">5531999999999</span><span>2 mensagens não lidas</span><span>15:36</span>
            </div>
            <div role="listitem" data-testid="cell-frame-container">
              <span>Arquivadas</span>
            </div>
          </section>
          <section id="main">
            <header><span title="5531982066263">5531982066263</span></header>
          </section>
        </main>
      `);
      await page.evaluate(createWhatsAppObserverScript());
      await page.waitForFunction("Boolean(globalThis.__nuomaSyncObserverInstalled)");
      const candidates = await page.evaluate(() =>
        (
          globalThis as unknown as {
            __nuomaSyncSidebarChats: (limit: number) => Array<{
              title: string;
              phone: string | null;
              kind: string;
              unreadCount: number;
            }>;
          }
        ).__nuomaSyncSidebarChats(10),
      );

      expect(candidates).toEqual([
        expect.objectContaining({
          title: "Cliente Sem Telefone",
          phone: null,
          kind: "named",
          unreadCount: 0,
        }),
        expect.objectContaining({
          title: "5531999999999",
          phone: "5531999999999",
          kind: "phone",
          unreadCount: 2,
        }),
      ]);
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("does not emit dom-wa-changed while phone navigation is loading", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const events: unknown[] = [];

    try {
      await page.route("https://web.whatsapp.com/send?phone=5531982066263", async (route) => {
        await route.fulfill({
          status: 200,
          contentType: "text/html",
          body: "<html><body>loading phone chat</body></html>",
        });
      });
      await page.exposeFunction("__nuomaSync", (payload: string) => {
        events.push(JSON.parse(payload) as unknown);
      });
      await page.goto("https://web.whatsapp.com/send?phone=5531982066263");
      await page.evaluate(createWhatsAppObserverScript());
      await page.waitForFunction("Boolean(globalThis.__nuomaSyncObserverInstalled)");
      await page.evaluate(() => {
        const realNow = Date.now;
        let now = realNow();
        Date.now = () => now;
        (
          globalThis as unknown as {
            __nuomaSyncScan: () => void;
          }
        ).__nuomaSyncScan();
        now += 31_000;
        (
          globalThis as unknown as {
            __nuomaSyncScan: () => void;
          }
        ).__nuomaSyncScan();
        Date.now = realNow;
      });
      await page.waitForTimeout(100);
    } finally {
      await browser.close();
    }

    expect(events.some((event) => isDomChangedEvent(event))).toBe(false);
  }, 30_000);

  it("does not treat virtualized DOM exits as deleted messages during history scroll", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    const events: unknown[] = [];

    try {
      await page.exposeFunction("__nuomaSync", (payload: string) => {
        events.push(JSON.parse(payload) as unknown);
      });
      await page.setContent(`
        <main id="app">
          <section id="pane-side"><div>5531982066263 Oi 15:34</div></section>
          <section id="main">
            <header><span title="5531982066263">5531982066263</span></header>
            <div id="scroll" style="height: 120px; overflow: auto;">
              <div style="height: 800px;">
                <div data-id="false_5531982066263@c.us_NEW1">
                  <div class="copyable-text" data-pre-plain-text="[15:34, 30/04/2026] Maria: ">
                    <span class="selectable-text">Nova 1</span>
                  </div>
                </div>
                <div data-id="false_5531982066263@c.us_NEW2">
                  <div class="copyable-text" data-pre-plain-text="[15:35, 30/04/2026] Maria: ">
                    <span class="selectable-text">Nova 2</span>
                  </div>
                </div>
              </div>
            </div>
          </section>
        </main>
      `);
      await page.evaluate(createWhatsAppObserverScript());
      await page.waitForFunction("Boolean(globalThis.__nuomaSyncObserverInstalled)");
      await page.waitForTimeout(250);
      await page.evaluate(() => {
        const documentRef = (
          globalThis as unknown as {
            document: {
              querySelector: (selector: string) => {
                remove?: () => void;
                insertAdjacentHTML?: (position: string, html: string) => void;
              } | null;
            };
          }
        ).document;
        documentRef.querySelector("[data-id='false_5531982066263@c.us_NEW1']")?.remove?.();
        documentRef.querySelector("#scroll > div")?.insertAdjacentHTML?.(
          "afterbegin",
          `
            <div data-id="false_5531982066263@c.us_OLD1">
              <div class="copyable-text" data-pre-plain-text="[15:30, 30/04/2026] Maria: ">
                <span class="selectable-text">Antiga 1</span>
              </div>
            </div>
          `,
        );
        (
          globalThis as unknown as {
            __nuomaSyncReconcile: (reason: string, details: Record<string, unknown>) => void;
          }
        ).__nuomaSyncReconcile("test-history-scroll", {
          scope: "history-backfill",
        });
      });
      await page.waitForTimeout(250);
    } finally {
      await browser.close();
    }

    expect(events.some((event) => isRemovedEvent(event))).toBe(false);
    expect(
      events.some(
        (event) =>
          isMessageEvent(event) &&
          event.message.externalId === "false_5531982066263@c.us_OLD1",
      ),
    ).toBe(true);
  }, 30_000);
});

function isDomChangedEvent(event: unknown): boolean {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    (event as { type: unknown }).type === "dom-wa-changed"
  );
}

function isRemovedEvent(event: unknown): boolean {
  return (
    typeof event === "object" &&
    event !== null &&
    "type" in event &&
    (event as { type: unknown }).type === "message-removed"
  );
}

function isMessageEvent(event: unknown): event is {
  type: string;
  message: {
    externalId: string;
    raw: Record<string, unknown>;
    timestampPrecision: string;
    waDisplayedAt: string;
    waInferredSecond: number;
  };
} {
  if (typeof event !== "object" || event === null || !("type" in event) || !("message" in event)) {
    return false;
  }
  const message = (event as { message: unknown }).message;
  return (
    (event as { type: unknown }).type === "message-added" &&
    typeof message === "object" &&
    message !== null &&
    "externalId" in message &&
    "raw" in message &&
    "timestampPrecision" in message &&
    "waDisplayedAt" in message &&
    "waInferredSecond" in message
  );
}
