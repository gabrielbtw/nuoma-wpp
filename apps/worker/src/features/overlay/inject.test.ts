/// <reference lib="dom" />

import { readFile } from "node:fs/promises";
import * as path from "node:path";

import { chromium } from "playwright";
import { describe, expect, it } from "vitest";

import {
  NUOMA_OVERLAY_FAB_TEST_ID,
  NUOMA_OVERLAY_PANEL_TEST_ID,
  NUOMA_OVERLAY_ROOT_ID,
  NUOMA_OVERLAY_VERSION,
  createNuomaOverlayScript,
} from "./inject.js";

describe("Nuoma WhatsApp overlay injection", () => {
  it("mounts a Shadow DOM FAB inside the conversation header", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

    try {
      const fixture = await readFile(
        path.resolve(process.cwd(), "../../tests/fixtures/wa-web.html"),
        "utf8",
      );
      await page.setContent(fixture);
      await page.evaluate(createNuomaOverlayScript());
      await page.waitForFunction(
        ({ rootId, testId }) => {
          const host = document.getElementById(rootId);
          return Boolean(host?.shadowRoot?.querySelector(`[data-testid="${testId}"]`));
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, testId: NUOMA_OVERLAY_FAB_TEST_ID },
      );

      const state = await page.evaluate(
        ({ rootId, testId }) => {
          const header = document.querySelector("#main header");
          const host = document.getElementById(rootId);
          const button = host?.shadowRoot?.querySelector(`[data-testid="${testId}"]`);
          const buttonRect = button?.getBoundingClientRect();
          const headerRect = header?.getBoundingClientRect();
          const insideHeader =
            buttonRect && headerRect
              ? buttonRect.top >= headerRect.top && buttonRect.bottom <= headerRect.bottom + 1
              : false;

          return {
            rootCount: document.querySelectorAll(`#${rootId}`).length,
            parentIsHeader: host?.parentElement === header,
            shadowIsolated: Boolean(host?.shadowRoot),
            ariaLabel: button?.getAttribute("aria-label"),
            title: button?.getAttribute("title"),
            hasBrandButton: Boolean(button?.querySelector(".nuoma-brand-button")),
            hasBrandMark: Boolean(button?.querySelector(".nuoma-brand-mark")),
            hasBrandStatus: Boolean(button?.querySelector(".nuoma-brand-status")),
            brandText: button?.querySelector(".nuoma-brand-mark")?.textContent,
            hasLegacyMark: Boolean(button?.querySelector(".nuoma-mark")),
            hasLegacyOctoArt: Boolean(button?.querySelector(".nuoma-octo-art")),
            visualState: host?.getAttribute("data-nuoma-visual-state"),
            brandTransform:
              button?.querySelector<HTMLElement>(".nuoma-brand-mark")?.style.transform ?? "",
            version: host?.getAttribute("data-nuoma-version"),
            threadPhone: host?.getAttribute("data-nuoma-thread-phone"),
            threadPhoneSource: host?.getAttribute("data-nuoma-phone-source"),
            threadTitle: host?.getAttribute("data-nuoma-thread-title"),
            buttonWidth: buttonRect?.width ?? 0,
            buttonHeight: buttonRect?.height ?? 0,
            insideHeader,
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, testId: NUOMA_OVERLAY_FAB_TEST_ID },
      );

      expect(state).toMatchObject({
        rootCount: 1,
        parentIsHeader: true,
        shadowIsolated: true,
        ariaLabel: "Abrir painel Nuoma",
        title: "Abrir painel Nuoma",
        hasBrandButton: true,
        hasBrandMark: true,
        hasBrandStatus: true,
        brandText: "N",
        hasLegacyMark: false,
        hasLegacyOctoArt: false,
        version: NUOMA_OVERLAY_VERSION,
        threadPhone: "5531982066263",
        threadPhoneSource: "message-data-id",
        threadTitle: "5531982066263",
        insideHeader: true,
      });
      expect(state.buttonWidth).toBeGreaterThanOrEqual(38);
      expect(state.buttonHeight).toBeGreaterThanOrEqual(38);
      expect(state.visualState).toBe("idle");
      expect(state.brandTransform).toContain("rotate");

      const clickState = await page.evaluate(
        ({ rootId, testId }) => {
          let clickDetail: unknown = null;
          window.addEventListener(
            "nuoma:overlay-fab-click",
            (event) => {
              clickDetail = (event as CustomEvent).detail;
            },
            { once: true },
          );
          const host = document.getElementById(rootId);
          host?.shadowRoot?.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)?.click();
          return {
            state: host?.getAttribute("data-nuoma-state"),
            visualState: host?.getAttribute("data-nuoma-visual-state"),
            clickDetail,
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, testId: NUOMA_OVERLAY_FAB_TEST_ID },
      );

      expect(clickState).toMatchObject({
        state: "open",
        visualState: "review",
        clickDetail: {
          state: "open",
          phone: "5531982066263",
          phoneSource: "message-data-id",
          title: "5531982066263",
          version: NUOMA_OVERLAY_VERSION,
        },
      });
      await page.evaluate(
        ({ rootId, panelTestId }) =>
          (
            window as unknown as {
              __nuomaOverlaySetData: (data: unknown) => unknown;
            }
          ).__nuomaOverlaySetData({
            phone: "5531982066263",
            title: "5531982066263",
            contact: {
              name: "Contato Fixture",
              status: "lead",
              primaryChannel: "whatsapp",
              notes: "Nota fixture do painel.",
            },
            conversations: [{ id: 1, channel: "whatsapp", lastPreview: "Oi fixture" }],
            latestMessages: [{ body: "Oi fixture", direction: "inbound", contentType: "text" }],
            automations: [
              {
                id: 1,
                name: "Boas-vindas",
                category: "Atendimento",
                status: "active",
                overlayEnabled: true,
              },
            ],
            notes: "Nota fixture do painel.",
            source: "test",
          }) &&
          document
            .getElementById(rootId)
            ?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`)?.textContent,
        { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
      );
      const panelText = await page.evaluate(
        ({ rootId, panelTestId }) =>
          document
            .getElementById(rootId)
            ?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`)?.textContent ?? "",
        { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
      );
      expect(panelText).toContain("Contato Fixture");
      expect(panelText).toContain("Boas-vindas");
      expect(panelText).toContain("Nota fixture do painel.");

      await page.evaluate(
        ({ rootId, testId }) => {
          const button = document
            .getElementById(rootId)
            ?.shadowRoot?.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);
          if (button) {
            button.setAttribute("aria-label", "Abrir Nuoma CRM");
            button.innerHTML =
              '<span class="nuoma-octo" aria-hidden="true"><span class="nuoma-octo-art"></span></span>';
          }
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, testId: NUOMA_OVERLAY_FAB_TEST_ID },
      );
      await page.evaluate(createNuomaOverlayScript());
      const upgradeState = await page.evaluate(
        ({ rootId, testId }) => {
          const host = document.getElementById(rootId);
          const button = host?.shadowRoot?.querySelector(`[data-testid="${testId}"]`);
          return {
            rootCount: document.querySelectorAll(`#${rootId}`).length,
            ariaLabel: button?.getAttribute("aria-label"),
            hasBrandButton: Boolean(button?.querySelector(".nuoma-brand-button")),
            hasBrandMark: Boolean(button?.querySelector(".nuoma-brand-mark")),
            hasLegacyOctoArt: Boolean(button?.querySelector(".nuoma-octo-art")),
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, testId: NUOMA_OVERLAY_FAB_TEST_ID },
      );
      expect(upgradeState).toMatchObject({
        rootCount: 1,
        ariaLabel: "Abrir painel Nuoma",
        hasBrandButton: true,
        hasBrandMark: true,
        hasLegacyOctoArt: false,
      });
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("detects the phone for saved contacts when the header title is not numeric", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

    try {
      await page.setContent(`
        <!doctype html>
        <html lang="pt-BR">
          <body>
            <section id="pane-side" role="list" aria-label="Conversas">
              <div role="listitem" aria-selected="true" data-testid="cell-frame-container">
                <span title="Gabriel Braga Nuoma">Gabriel Braga Nuoma</span>
                <span title="+55 31 98206-6263">+55 31 98206-6263</span>
              </div>
            </section>
            <section id="main">
              <header style="position: relative; min-height: 64px">
                <span title="Gabriel Braga Nuoma">Gabriel Braga Nuoma</span>
              </header>
              <div data-id="false_5531982066263@c.us_M34">
                <span class="selectable-text">Mensagem salva no contato.</span>
              </div>
            </section>
          </body>
        </html>
      `);
      await page.evaluate(createNuomaOverlayScript());

      const state = await page.evaluate(
        ({ rootId, panelTestId }) => {
          const refreshState = (
            window as unknown as {
              __nuomaOverlayRefresh: () => {
                mounted: boolean;
                phone: string;
                phoneSource: string;
                title: string;
              };
            }
          ).__nuomaOverlayRefresh();
          const host = document.getElementById(rootId);
          host?.shadowRoot?.querySelector<HTMLButtonElement>("[data-nuoma-fab]")?.click();
          const panelText =
            host?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`)?.textContent ?? "";
          return {
            ...refreshState,
            hostPhone: host?.getAttribute("data-nuoma-thread-phone"),
            hostPhoneSource: host?.getAttribute("data-nuoma-phone-source"),
            panelText,
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
      );

      expect(state).toMatchObject({
        mounted: true,
        phone: "5531982066263",
        phoneSource: "message-data-id",
        title: "Gabriel Braga Nuoma",
        hostPhone: "5531982066263",
        hostPhoneSource: "message-data-id",
      });
      expect(state.panelText).toContain("+5531982066263");
      expect(state.panelText).toContain("Detector");
      expect(state.panelText).toContain("message-data-id");
      expect(state.panelText).not.toContain("Telefone nao identificado");
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("does not infer identity from active sidebar display text alone", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

    try {
      await page.setContent(`
        <!doctype html>
        <html lang="pt-BR">
          <body>
            <section id="pane-side" role="list" aria-label="Conversas">
              <div role="listitem" aria-selected="true" data-testid="cell-frame-container">
                <span title="31982066263">31982066263</span>
              </div>
            </section>
            <section id="main">
              <header style="position: relative; min-height: 64px">
                <span title="Gabriel Braga Nuoma">Gabriel Braga Nuoma</span>
              </header>
              <div data-id="false_3EB0OPAQUE_M34">
                <span class="selectable-text">Mensagem sem telefone no id visivel.</span>
              </div>
            </section>
          </body>
        </html>
      `);
      await page.evaluate(createNuomaOverlayScript());

      const state = await page.evaluate(
        ({ rootId, panelTestId }) => {
          const refreshState = (
            window as unknown as {
              __nuomaOverlayRefresh: () => {
                mounted: boolean;
                phone: string;
                phoneSource: string;
                title: string;
              };
            }
          ).__nuomaOverlayRefresh();
          const host = document.getElementById(rootId);
          host?.shadowRoot?.querySelector<HTMLButtonElement>("[data-nuoma-fab]")?.click();
          const panelText =
            host?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`)?.textContent ?? "";
          return {
            ...refreshState,
            hostPhone: host?.getAttribute("data-nuoma-thread-phone"),
            hostPhoneSource: host?.getAttribute("data-nuoma-phone-source"),
            panelText,
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
      );

      expect(state).toMatchObject({
        mounted: true,
        phone: "",
        phoneSource: "unresolved",
        title: "Gabriel Braga Nuoma",
        hostPhone: "",
        hostPhoneSource: "unresolved",
      });
      expect(state.panelText).toContain("Telefone nao identificado");
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("moves focus into the panel and closes with Escape", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

    try {
      const fixture = await readFile(
        path.resolve(process.cwd(), "../../tests/fixtures/wa-web.html"),
        "utf8",
      );
      await page.setContent(fixture);
      await page.evaluate(createNuomaOverlayScript());

      const opened = await page.evaluate(
        ({ rootId }) => {
          const host = document.getElementById(rootId);
          host?.shadowRoot?.querySelector<HTMLButtonElement>("[data-nuoma-fab]")?.click();
          return host?.getAttribute("data-nuoma-state");
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID },
      );
      expect(opened).toBe("open");
      await page.waitForTimeout(20);
      const focusState = await page.evaluate((rootId) => {
        const host = document.getElementById(rootId);
        return {
          activeClass: host?.shadowRoot?.activeElement?.className ?? "",
          expanded: host?.shadowRoot
            ?.querySelector("[data-nuoma-fab]")
            ?.getAttribute("aria-expanded"),
        };
      }, NUOMA_OVERLAY_ROOT_ID);
      expect(focusState.activeClass).toContain("nuoma-panel-body");
      expect(focusState.expanded).toBe("true");

      await page.evaluate((rootId) => {
        const host = document.getElementById(rootId);
        const target =
          host?.shadowRoot?.activeElement ?? host?.shadowRoot?.querySelector("[data-nuoma-panel]");
        target?.dispatchEvent(
          new KeyboardEvent("keydown", {
            key: "Escape",
            bubbles: true,
            cancelable: true,
            composed: true,
          }),
        );
      }, NUOMA_OVERLAY_ROOT_ID);
      await page.waitForTimeout(20);
      const closed = await page.evaluate((rootId) => {
        const host = document.getElementById(rootId);
        return {
          state: host?.getAttribute("data-nuoma-state"),
          expanded: host?.shadowRoot
            ?.querySelector("[data-nuoma-fab]")
            ?.getAttribute("aria-expanded"),
          activeFab: Boolean(host?.shadowRoot?.activeElement?.matches("[data-nuoma-fab]")),
        };
      }, NUOMA_OVERLAY_ROOT_ID);
      expect(closed).toMatchObject({ state: "closed", expanded: "false", activeFab: true });
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("keeps the panel inside a mobile viewport", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 390, height: 740 } });

    try {
      const fixture = await readFile(
        path.resolve(process.cwd(), "../../tests/fixtures/wa-web.html"),
        "utf8",
      );
      await page.setContent(fixture);
      await page.evaluate(createNuomaOverlayScript());
      await page.evaluate(
        ({ rootId }) => {
          document
            .getElementById(rootId)
            ?.shadowRoot?.querySelector<HTMLButtonElement>("[data-nuoma-fab]")
            ?.click();
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID },
      );
      await page.waitForTimeout(250);

      const layout = await page.evaluate(
        ({ rootId, panelTestId }) => {
          const host = document.getElementById(rootId);
          const panel = host?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`);
          const button = host?.shadowRoot?.querySelector("[data-nuoma-fab]");
          const panelRect = panel?.getBoundingClientRect();
          const buttonRect = button?.getBoundingClientRect();
          return {
            panelLeft: panelRect?.left ?? -1,
            panelRight: panelRect?.right ?? -1,
            panelTop: panelRect?.top ?? -1,
            panelBottom: panelRect?.bottom ?? -1,
            panelWidth: panelRect?.width ?? 0,
            buttonWidth: buttonRect?.width ?? 0,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight,
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
      );

      expect(layout.panelLeft).toBeGreaterThanOrEqual(0);
      expect(layout.panelRight).toBeLessThanOrEqual(layout.viewportWidth);
      expect(layout.panelTop).toBeGreaterThanOrEqual(0);
      expect(layout.panelBottom).toBeLessThanOrEqual(layout.viewportHeight);
      expect(layout.panelWidth).toBeGreaterThan(300);
      expect(layout.buttonWidth).toBeGreaterThanOrEqual(38);
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("ignores WhatsApp header control titles before reading the chat title", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

    try {
      await page.setContent(`
        <!doctype html>
        <html lang="pt-BR">
          <body>
            <section id="pane-side" role="list" aria-label="Conversas">
              <div role="listitem" aria-selected="true" data-testid="cell-frame-container">
                <span title="Gabriel Braga Nuoma">Gabriel Braga Nuoma</span>
                <span title="+55 31 98206-6263">+55 31 98206-6263</span>
              </div>
            </section>
            <section id="main">
              <header style="position: relative; min-height: 64px">
                <div role="button" title="Dados do perfil">default-contact-refreshed</div>
                <div role="button" data-testid="conversation-info-header">
                  <span data-testid="conversation-info-header-chat-title">Gabriel Braga Nuoma</span>
                </div>
              </header>
              <div data-id="false_5531982066263@c.us_M34">
                <span class="selectable-text">Mensagem salva no contato.</span>
              </div>
            </section>
          </body>
        </html>
      `);
      await page.evaluate(createNuomaOverlayScript());

      const state = await page.evaluate(
        ({ rootId }) => {
          const refreshState = (
            window as unknown as {
              __nuomaOverlayRefresh: () => {
                mounted: boolean;
                phone: string;
                phoneSource: string;
                title: string;
              };
            }
          ).__nuomaOverlayRefresh();
          const host = document.getElementById(rootId);
          return {
            ...refreshState,
            hostPhone: host?.getAttribute("data-nuoma-thread-phone"),
            hostTitle: host?.getAttribute("data-nuoma-thread-title"),
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID },
      );

      expect(state).toMatchObject({
        mounted: true,
        phone: "5531982066263",
        phoneSource: "message-data-id",
        title: "Gabriel Braga Nuoma",
        hostPhone: "5531982066263",
        hostTitle: "Gabriel Braga Nuoma",
      });
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("detects the phone from an open contact details drawer when message ids are opaque", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

    try {
      await page.setContent(`
        <!doctype html>
        <html lang="pt-BR">
          <body>
            <section id="pane-side" role="list" aria-label="Conversas">
              <div role="listitem" aria-selected="true" data-testid="cell-frame-container">
                <span title="Gabriel Braga Nuoma">Gabriel Braga Nuoma</span>
              </div>
            </section>
            <section id="main">
              <header style="position: relative; min-height: 64px">
                <span title="Gabriel Braga Nuoma">Gabriel Braga Nuoma</span>
              </header>
              <div data-id="false_3EB0OPAQUE_M34">
                <span class="selectable-text">Mensagem sem telefone no id visivel.</span>
              </div>
            </section>
            <aside data-testid="contact-info-drawer" aria-label="Dados do contato">
              <h2>Gabriel Braga Nuoma</h2>
              <a href="tel:+5531982066263">+55 31 98206-6263</a>
            </aside>
          </body>
        </html>
      `);
      await page.evaluate(createNuomaOverlayScript());

      const state = await page.evaluate(
        ({ rootId }) => {
          const refreshState = (
            window as unknown as {
              __nuomaOverlayRefresh: () => {
                mounted: boolean;
                phone: string;
                phoneSource: string;
                title: string;
              };
            }
          ).__nuomaOverlayRefresh();
          const host = document.getElementById(rootId);
          return {
            ...refreshState,
            hostPhone: host?.getAttribute("data-nuoma-thread-phone"),
            hostPhoneSource: host?.getAttribute("data-nuoma-phone-source"),
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID },
      );

      expect(state).toMatchObject({
        mounted: true,
        phone: "5531982066263",
        phoneSource: "contact-details",
        title: "Gabriel Braga Nuoma",
        hostPhone: "5531982066263",
        hostPhoneSource: "contact-details",
      });
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("keeps an API-hydrated phone when WhatsApp exposes a saved contact title plus WA JID", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

    try {
      await page.setContent(`
        <!doctype html>
        <html lang="pt-BR">
          <body>
            <section id="pane-side" role="list" aria-label="Conversas">
              <div role="listitem" aria-selected="true" data-testid="cell-frame-container">
                <span title="Gabriel Braga Nuoma">Gabriel Braga Nuoma</span>
              </div>
            </section>
            <section id="main">
              <header style="position: relative; min-height: 64px">
                <div role="button" title="Dados do perfil">default-contact-refreshed</div>
                <div role="button" data-testid="conversation-info-header">
                  <span data-testid="conversation-info-header-chat-title">Gabriel Braga Nuoma</span>
                </div>
              </header>
              <div data-id="false_3EB0OPAQUE_M34">
                <span class="selectable-text">Mensagem sem telefone no data-id atual do WhatsApp.</span>
              </div>
            </section>
          </body>
        </html>
      `);
      await page.evaluate(() => {
        (window as unknown as { require: (name: string) => unknown }).require = (name: string) =>
          name === "WAWebCollections"
            ? {
                Chat: {
                  _models: [
                    {
                      active: true,
                      id: { _serialized: "5531982066263@c.us" },
                    },
                  ],
                },
              }
            : {};
      });
      await page.evaluate(createNuomaOverlayScript());

      const state = await page.evaluate(
        ({ rootId }) => {
          const api = window as unknown as {
            __nuomaOverlaySetData: (data: unknown) => unknown;
            __nuomaOverlayRefresh: () => {
              mounted: boolean;
              phone: string;
              phoneSource: string;
              title: string;
            };
          };
          const before = api.__nuomaOverlayRefresh();
          api.__nuomaOverlaySetData({
            phone: "5531982066263",
            waJid: "5531982066263@s.whatsapp.net",
            phoneSource: "wa-jid",
            title: "Gabriel Braga Nuoma",
            contact: { name: "Gabriel Braga Nuoma", status: "active", primaryChannel: "whatsapp" },
            source: "nuoma-api",
          });
          const after = api.__nuomaOverlayRefresh();
          const host = document.getElementById(rootId);
          return {
            before,
            after,
            hostPhone: host?.getAttribute("data-nuoma-thread-phone"),
            hostPhoneSource: host?.getAttribute("data-nuoma-phone-source"),
            hostTitle: host?.getAttribute("data-nuoma-thread-title"),
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID },
      );

      expect(state.before).toMatchObject({
        mounted: true,
        phone: "5531982066263",
        phoneSource: "wa-jid",
        title: "Gabriel Braga Nuoma",
      });
      expect(state.after).toMatchObject({
        mounted: true,
        phone: "5531982066263",
        phoneSource: "wa-jid",
        title: "Gabriel Braga Nuoma",
      });
      expect(state).toMatchObject({
        hostPhone: "5531982066263",
        hostPhoneSource: "wa-jid",
        hostTitle: "Gabriel Braga Nuoma",
      });
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("renders real loading, error, and no-contact states in the panel", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

    try {
      const fixture = await readFile(
        path.resolve(process.cwd(), "../../tests/fixtures/wa-web.html"),
        "utf8",
      );
      await page.setContent(fixture);
      await page.evaluate(createNuomaOverlayScript());

      const state = await page.evaluate(
        ({ rootId, panelTestId }) => {
          const host = document.getElementById(rootId);
          host?.shadowRoot?.querySelector<HTMLButtonElement>("[data-nuoma-fab]")?.click();
          const setData = (
            window as unknown as {
              __nuomaOverlaySetData: (data: unknown) => unknown;
            }
          ).__nuomaOverlaySetData;
          const readPanel = () =>
            host?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`)?.textContent ?? "";

          setData({
            phone: "5531982066263",
            phoneSource: "message-data-id",
            title: "5531982066263",
            contact: null,
            source: "nuoma-api",
            apiStatus: "loading",
            apiLastMethod: "contactSummary",
          });
          const loadingText = readPanel();

          setData({
            phone: "5531982066263",
            phoneSource: "message-data-id",
            title: "5531982066263",
            contact: null,
            source: "nuoma-api",
            apiStatus: "error",
            apiLastMethod: "contactSummary",
            apiLastError: "bridge offline",
          });
          const errorText = readPanel();

          setData({
            phone: "5531982066263",
            phoneSource: "message-data-id",
            title: "5531982066263",
            contact: null,
            conversations: [],
            latestMessages: [],
            automations: [],
            notes: null,
            source: "nuoma-api",
            apiStatus: "online",
            apiLastMethod: "contactSummary",
            apiLastError: "",
          });
          const emptyText = readPanel();
          const emptyActions = Array.from(
            host?.shadowRoot?.querySelectorAll<HTMLButtonElement>(".nuoma-empty-action") ?? [],
          ).map((button) => ({ text: button.textContent, disabled: button.disabled }));

          return {
            loadingText,
            errorText,
            emptyText,
            emptyActions,
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
      );

      expect(state.loadingText).toContain("Carregando contato");
      expect(state.loadingText).toContain("Buscando resumo");
      expect(state.errorText).toContain("Erro na ponte API");
      expect(state.errorText).toContain("bridge offline");
      expect(state.errorText).toContain("Reconectar ponte");
      expect(state.emptyText).toContain("Contato nao encontrado no CRM");
      expect(state.emptyText).toContain("Sincronizar conversa");
      expect(state.emptyText).toContain("Copiar telefone");
      expect(state.emptyActions).toEqual([
        { text: "Sincronizar conversa", disabled: false },
        { text: "Copiar telefone", disabled: false },
      ]);
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("enables manual sync when only a canonical WhatsApp JID is available", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

    try {
      await page.setContent(`
        <html>
          <body>
            <div id="main">
              <header>
                <div role="button" aria-label="Dados do contato">
                  <span>Gabriel Salvo</span>
                </div>
              </header>
            </div>
          </body>
        </html>
      `);
      await page.evaluate(createNuomaOverlayScript());

      const state = await page.evaluate(
        ({ rootId, panelTestId }) => {
          const host = document.getElementById(rootId);
          host?.shadowRoot?.querySelector<HTMLButtonElement>("[data-nuoma-fab]")?.click();
          (
            window as unknown as {
              __nuomaOverlaySetData: (data: unknown) => unknown;
            }
          ).__nuomaOverlaySetData({
            phone: "",
            waJid: "5531982066263@s.whatsapp.net",
            phoneSource: "wa-jid",
            title: "Gabriel Salvo",
            contact: null,
            conversations: [],
            latestMessages: [],
            automations: [],
            campaigns: [],
            notes: null,
            source: "nuoma-api",
            apiStatus: "online",
            apiLastMethod: "contactSummary",
          });

          const panel = host?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`) ?? null;
          const syncButton = Array.from(
            host?.shadowRoot?.querySelectorAll<HTMLButtonElement>(".nuoma-action") ?? [],
          ).find((button) => button.textContent === "Forcar sync");

          return {
            hostPhone: host?.getAttribute("data-nuoma-thread-phone"),
            hostWaJid: host?.getAttribute("data-nuoma-wa-jid"),
            panelText: panel?.textContent ?? "",
            syncDisabled: syncButton?.disabled,
            syncAria: syncButton?.getAttribute("aria-label"),
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
      );

      expect(state).toMatchObject({
        hostPhone: "",
        hostWaJid: "5531982066263@s.whatsapp.net",
        syncDisabled: false,
        syncAria: "Forcar sync da conversa atual",
      });
      expect(state.panelText).toContain("Telefone nao identificado");
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("does not reuse API-hydrated title when the active WhatsApp thread has no canonical identity", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

    try {
      await page.setContent(`
        <html>
          <body>
            <div id="main">
              <header>
                <div role="button" aria-label="Dados do contato">
                  <span>Contato Salvo Antigo</span>
                </div>
              </header>
            </div>
          </body>
        </html>
      `);
      await page.evaluate(createNuomaOverlayScript());

      const state = await page.evaluate(
        ({ rootId }) => {
          const api = window as unknown as {
            __nuomaOverlaySetData: (data: unknown) => unknown;
            __nuomaOverlayRefresh: () => {
              mounted: boolean;
              phone: string;
              waJid: string;
              title: string;
            };
          };
          api.__nuomaOverlaySetData({
            phone: "5531982066263",
            waJid: "5531982066263@s.whatsapp.net",
            phoneSource: "wa-jid",
            title: "Contato Salvo Antigo",
            contact: { name: "Contato Salvo Antigo", status: "active", primaryChannel: "whatsapp" },
            conversations: [],
            latestMessages: [],
            automations: [],
            campaigns: [],
            notes: null,
            source: "nuoma-api",
          });

          document.querySelector("#main header")!.innerHTML = `
            <div role="button" aria-label="Dados do contato">
              <span>Outro Contato Salvo</span>
            </div>
          `;

          const refresh = api.__nuomaOverlayRefresh();
          const host = document.getElementById(rootId);
          return {
            refresh,
            hostPhone: host?.getAttribute("data-nuoma-thread-phone"),
            hostWaJid: host?.getAttribute("data-nuoma-wa-jid"),
            hostTitle: host?.getAttribute("data-nuoma-thread-title"),
            hostPhoneSource: host?.getAttribute("data-nuoma-phone-source"),
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID },
      );

      expect(state).toMatchObject({
        refresh: expect.objectContaining({
          mounted: true,
          phone: "",
          waJid: "",
          phoneSource: "unresolved",
          title: "Outro Contato Salvo",
        }),
        hostPhone: "",
        hostWaJid: "",
        hostTitle: "Outro Contato Salvo",
        hostPhoneSource: "unresolved",
      });
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("exposes window.__nuomaApi through a promise bridge and hydrates the panel", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

    try {
      const fixture = await readFile(
        path.resolve(process.cwd(), "../../tests/fixtures/wa-web.html"),
        "utf8",
      );
      await page.setContent(fixture);
      await page.evaluate(() => {
        (
          window as unknown as {
            __nuomaApi: (payload: string) => void;
            __nuomaApiLastPayload?: unknown;
            __nuomaApiPayloads?: unknown[];
            __nuomaApiResolve?: (id: string, response: unknown) => unknown;
          }
        ).__nuomaApi = (payload: string) => {
          const request = JSON.parse(payload) as { id: string; method: string };
          (
            window as unknown as {
              __nuomaApiLastPayload?: unknown;
              __nuomaApiPayloads?: unknown[];
            }
          ).__nuomaApiLastPayload = request;
          const payloads = ((
            window as unknown as { __nuomaApiPayloads?: unknown[] }
          ).__nuomaApiPayloads ??= []);
          payloads.push(request);
          setTimeout(() => {
            const snapshot = {
              phone: "5531982066263",
              phoneSource: "message-data-id",
              title: "5531982066263",
              contact: {
                name: "Contato API Fixture",
                status: "lead",
                primaryChannel: "whatsapp",
                notes: "Nota hidratada via window.__nuomaApi.",
              },
              conversations: [{ id: 7, channel: "whatsapp", lastPreview: "API bridge" }],
              latestMessages: [{ body: "Mensagem via API bridge", direction: "inbound" }],
              automations: [
                {
                  id: 7,
                  name: "Bridge automation",
                  category: "Embed",
                  status: "active",
                  triggerChannel: "whatsapp",
                  actionsCount: 1,
                  sendStepsCount: 1,
                  overlayEnabled: true,
                  eligible: true,
                  reasons: [],
                  wouldEnqueueJobs: true,
                  canDispatchReal: true,
                },
              ],
              campaigns: [
                {
                  id: 11,
                  name: "Campanha API Fixture",
                  status: "running",
                  channel: "whatsapp",
                  stepsCount: 2,
                  firstStepType: "text",
                  overlayEnabled: true,
                  eligible: true,
                  reasons: [],
                  canDispatchReal: true,
                },
              ],
              notes: "Nota hidratada via window.__nuomaApi.",
              source: "nuoma-api",
              apiStatus: "online",
              apiLastMethod: request.method,
            };
            (
              window as unknown as {
                __nuomaApiResolve?: (id: string, response: unknown) => unknown;
              }
            ).__nuomaApiResolve?.(request.id, {
              ok: true,
              data:
                request.method === "forceConversationSync"
                  ? {
                      result: {
                        mode: "phone-navigation",
                        conversationId: 7,
                        phone: "5531982066263",
                        history: { syncedWindows: 1, stoppedReason: "top-reached" },
                      },
                      snapshot,
                    }
                  : request.method === "runCampaignForPhone"
                    ? {
                        result: {
                          campaign: { id: 11, name: "Campanha API Fixture", status: "running" },
                          phone: "5531982066263",
                          recipientsCreated: 1,
                          jobsCreated: 1,
                          plannedJobs: 1,
                          rejected: [],
                        },
                        snapshot: {
                          ...snapshot,
                          campaignRunStatus: "done",
                          campaignRunLastResult: {
                            recipientsCreated: 1,
                            jobsCreated: 1,
                          },
                        },
                      }
                    : request.method === "runAutomationForPhone"
                      ? {
                          result: {
                            automation: { id: 7, name: "Bridge automation", status: "active" },
                            phone: "5531982066263",
                            eligible: true,
                            jobsCreated: 1,
                            actionsApplied: 0,
                            plannedActions: 1,
                            rejected: [],
                          },
                          snapshot: {
                            ...snapshot,
                            automationRunStatus: "done",
                            automationRunLastResult: {
                              jobsCreated: 1,
                              actionsApplied: 0,
                            },
                          },
                        }
                      : snapshot,
            });
          }, 0);
        };
      });
      await page.evaluate(createNuomaOverlayScript());

      const state = await page.evaluate(
        async ({ rootId, panelTestId }) => {
          const api = (
            window as unknown as {
              __nuomaApi: {
                __nuomaManaged: boolean;
                __nuomaBridge?: unknown;
                refreshContact: (input: unknown) => Promise<unknown>;
                forceConversationSync: (input: unknown) => Promise<unknown>;
                runCampaignForPhone: (input: unknown) => Promise<unknown>;
                runAutomationForPhone: (input: unknown) => Promise<unknown>;
                request: (method: string, input: unknown) => Promise<unknown>;
                prepareMutation: (
                  method: string,
                  input: unknown,
                ) => {
                  method: string;
                  params: unknown;
                  nonce: string;
                  idempotencyKey: string;
                };
                confirmMutation: (intent: unknown, confirmationText: string) => Promise<unknown>;
              };
              __nuomaApiNativeBridge?: unknown;
              __nuomaOverlayState?: { apiBridge?: unknown };
              __nuomaApiLastPayload?: unknown;
              __nuomaApiPayloads?: unknown[];
            }
          ).__nuomaApi;
          const nativeBridgeType = typeof (
            window as unknown as { __nuomaApiNativeBridge?: unknown }
          ).__nuomaApiNativeBridge;
          api.__nuomaBridge = { stale: true };
          (
            window as unknown as { __nuomaOverlayState?: { apiBridge?: unknown } }
          ).__nuomaOverlayState!.apiBridge = null;
          const response = await api.refreshContact({
            phone: "5531982066263",
            phoneSource: "message-data-id",
            title: "5531982066263",
            reason: "unit-test",
          });
          const blockedMutation = await api.request("addNote", { body: "sem confirmacao" });
          const mutationIntent = api.prepareMutation("addNote", { body: "nota segura" });
          const mutationResponse = await api.confirmMutation(
            mutationIntent,
            "Adicionar nota ao contato",
          );
          const forceResponse = await api.forceConversationSync({
            phone: "5531982066263",
            conversationId: 7,
            reason: "unit-test",
          });
          const campaignResponse = await api.runCampaignForPhone({
            campaignId: 11,
            phone: "5531982066263",
            reason: "unit-test",
          });
          const automationResponse = await api.runAutomationForPhone({
            automationId: 7,
            phone: "5531982066263",
            reason: "unit-test",
          });
          const host = document.getElementById(rootId);
          host?.shadowRoot?.querySelector<HTMLButtonElement>("[data-nuoma-fab]")?.click();
          await new Promise((resolve) => setTimeout(resolve, 50));
          host?.shadowRoot
            ?.querySelector<HTMLButtonElement>("[data-nuoma-campaign-run='11']")
            ?.click();
          await new Promise((resolve) => setTimeout(resolve, 50));
          host?.shadowRoot
            ?.querySelector<HTMLSelectElement>("[data-nuoma-quick-automation]")
            ?.dispatchEvent(new Event("change", { bubbles: true }));
          host?.shadowRoot
            ?.querySelector<HTMLButtonElement>("[data-nuoma-quick-run-automation]")
            ?.click();
          await new Promise((resolve) => setTimeout(resolve, 50));
          const panelText =
            host?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`)?.textContent ?? "";
          return {
            managed: api.__nuomaManaged,
            response,
            blockedMutation,
            mutationResponse,
            forceResponse,
            campaignResponse,
            automationResponse,
            lastPayload: (window as unknown as { __nuomaApiLastPayload?: unknown })
              .__nuomaApiLastPayload,
            payloads: (window as unknown as { __nuomaApiPayloads?: unknown[] }).__nuomaApiPayloads,
            apiStatus: host?.getAttribute("data-nuoma-api-status"),
            nativeBridgeType,
            recoveredBridgeType: typeof api.__nuomaBridge,
            panelText,
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
      );

      expect(state.managed).toBe(true);
      expect(state.nativeBridgeType).toBe("function");
      expect(state.recoveredBridgeType).toBe("function");
      expect(state.response).toMatchObject({ ok: true });
      expect(state.blockedMutation).toMatchObject({
        ok: false,
        error: { code: "mutation_guard_required" },
      });
      expect(state.mutationResponse).toMatchObject({ ok: true });
      expect(state.forceResponse).toMatchObject({ ok: true });
      expect(state.campaignResponse).toMatchObject({ ok: true });
      expect(state.automationResponse).toMatchObject({ ok: true });
      expect(state.payloads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: "contactSummary" }),
          expect.objectContaining({
            method: "forceConversationSync",
            mutation: expect.objectContaining({
              confirmed: true,
              confirmationText: "Forcar sync da conversa atual",
              nonce: expect.any(String),
              idempotencyKey: expect.any(String),
            }),
          }),
          expect.objectContaining({
            method: "addNote",
            mutation: expect.objectContaining({
              confirmed: true,
              confirmationText: "Adicionar nota ao contato",
              nonce: expect.any(String),
              idempotencyKey: expect.any(String),
            }),
          }),
          expect.objectContaining({
            method: "runCampaignForPhone",
            mutation: expect.objectContaining({
              confirmed: true,
              confirmationText: "Rodar campanha no numero atual",
              nonce: expect.any(String),
              idempotencyKey: expect.any(String),
            }),
          }),
          expect.objectContaining({
            method: "runAutomationForPhone",
            mutation: expect.objectContaining({
              confirmed: true,
              confirmationText: "Rodar automacao no numero atual",
              nonce: expect.any(String),
              idempotencyKey: expect.any(String),
            }),
          }),
        ]),
      );
      expect(state.apiStatus).toBe("online");
      expect(state.panelText).toContain("Contato API Fixture");
      expect(state.panelText).toContain("Ponte API");
      expect(state.panelText).toContain("online / runAutomationForPhone");
      expect(state.panelText).toContain("Forcar sync");
      expect(state.panelText).toContain("atualizado");
      expect(state.panelText).toContain("Bridge automation");
      expect(state.panelText).toContain("Campanha API Fixture");
      expect(state.panelText).toContain("Acao rapida");
      expect(state.panelText).toContain("Disparar campanha");
      expect(state.panelText).toContain("Disparar automacao");
      expect(state.panelText).toContain("Criou 1 recipient(s) e 1 job(s).");
      expect(state.panelText).toContain("Criou 1 job(s) e aplicou 0 acao(oes).");
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("renders V2.11 quick actions, sync indicator, automation history, debug and shortcuts", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

    try {
      const fixture = await readFile(
        path.resolve(process.cwd(), "../../tests/fixtures/wa-web.html"),
        "utf8",
      );
      await page.setContent(fixture);
      await page.evaluate(createNuomaOverlayScript());
      const state = await page.evaluate(
        async ({ rootId, panelTestId }) => {
          (
            window as unknown as {
              __nuomaOverlaySetData: (data: unknown) => unknown;
            }
          ).__nuomaOverlaySetData({
            phone: "5531982066263",
            waJid: "5531982066263@s.whatsapp.net",
            phoneSource: "message-data-id",
            title: "5531982066263",
            contact: {
              id: 10,
              name: "Contato V2.11",
              status: "lead",
              primaryChannel: "whatsapp",
              tagIds: [2],
              notes: "Nota",
            },
            tags: [
              { id: 1, name: "VIP", color: "#22c55e" },
              { id: 2, name: "Lead quente", color: "#f97316" },
            ],
            reminders: [
              {
                id: 3,
                title: "Retornar lead",
                dueAt: "2026-06-12T12:00:00.000Z",
                status: "open",
              },
            ],
            automations: [],
            campaigns: [],
            automationHistory: [
              {
                id: 99,
                type: "automation.overlay.dispatched",
                automationId: 42,
                eligible: true,
                jobsCreated: 1,
                actionsApplied: 2,
                createdAt: "2026-06-11T10:00:00.000Z",
              },
            ],
            syncStatus: "running",
            apiStatus: "online",
            apiLastMethod: "contactSummary",
            source: "nuoma-api",
          });
          const host = document.getElementById(rootId);
          host?.shadowRoot?.querySelector<HTMLButtonElement>("[data-nuoma-fab]")?.click();
          await new Promise((resolve) => setTimeout(resolve, 30));
          const panel = host?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`);
          host?.shadowRoot?.querySelector<HTMLButtonElement>("[data-nuoma-debug-toggle]")?.click();
          const body = host?.shadowRoot?.querySelector<HTMLElement>("[data-nuoma-panel-body]");
          body?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "d", bubbles: true, cancelable: true }),
          );
          body?.dispatchEvent(
            new KeyboardEvent("keydown", { key: "r", bubbles: true, cancelable: true }),
          );
          const statusSelect = host?.shadowRoot?.querySelector<HTMLSelectElement>(
            "[data-nuoma-quick-status]",
          );
          const statusEvent = new KeyboardEvent("keydown", {
            key: "d",
            bubbles: true,
            cancelable: true,
          });
          statusSelect?.dispatchEvent(statusEvent);
          return {
            panelText: panel?.textContent ?? "",
            hasSyncIndicator: Boolean(
              host?.shadowRoot?.querySelector("[data-nuoma-sync-indicator='running']"),
            ),
            hasQuickTag: Boolean(host?.shadowRoot?.querySelector("[data-nuoma-quick-tag]")),
            hasQuickStatus: Boolean(host?.shadowRoot?.querySelector("[data-nuoma-quick-status]")),
            hasQuickReminder: Boolean(
              host?.shadowRoot?.querySelector("[data-nuoma-quick-create-reminder]"),
            ),
            hasHistory: Boolean(host?.shadowRoot?.querySelector("[data-nuoma-automation-history]")),
            debug: host?.getAttribute("data-nuoma-debug"),
            statusPrevented: statusEvent.defaultPrevented,
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
      );

      expect(state.panelText).toContain("Sync ativo");
      expect(state.panelText).toContain("VIP");
      expect(state.panelText).toContain("Lead quente");
      expect(state.panelText).toContain("Retornar lead");
      expect(state.panelText).toContain("Historico automacoes");
      expect(state.panelText).toContain("Automation #42 disparada");
      expect(state.hasSyncIndicator).toBe(true);
      expect(state.hasQuickTag).toBe(true);
      expect(state.hasQuickStatus).toBe(true);
      expect(state.hasQuickReminder).toBe(true);
      expect(state.hasHistory).toBe(true);
      expect(state.debug).toBe("false");
      expect(state.statusPrevented).toBe(false);
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("debounces observer refreshes and hot-reloads without duplicating the overlay", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

    try {
      const fixture = await readFile(
        path.resolve(process.cwd(), "../../tests/fixtures/wa-web.html"),
        "utf8",
      );
      await page.setContent(fixture);
      await page.evaluate(createNuomaOverlayScript({ version: "v2.11-test-a" }));
      const result = await page.evaluate(
        async ({ rootId }) => {
          const overlayState = (
            window as unknown as {
              __nuomaOverlayState: { refreshCount: number; observerTimer: number };
            }
          ).__nuomaOverlayState;
          const before = overlayState.refreshCount;
          for (let index = 0; index < 12; index += 1) {
            document
              .querySelector("#main header")
              ?.setAttribute("data-testid", "conversation-header-" + index);
          }
          await new Promise((resolve) => setTimeout(resolve, 90));
          return {
            before,
            afterBurst: overlayState.refreshCount,
            timer: overlayState.observerTimer,
            rootCountBeforeReload: document.querySelectorAll(`#${rootId}`).length,
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID },
      );
      await page.evaluate(createNuomaOverlayScript({ version: "v2.11-test-b" }));
      const reloaded = await page.evaluate((rootId) => {
        const host = document.getElementById(rootId);
        return {
          rootCount: document.querySelectorAll(`#${rootId}`).length,
          version: host?.getAttribute("data-nuoma-version"),
          hotReloadedAt: host?.getAttribute("data-nuoma-hot-reloaded-at"),
        };
      }, NUOMA_OVERLAY_ROOT_ID);

      expect(result.rootCountBeforeReload).toBe(1);
      expect(result.afterBurst - result.before).toBeLessThanOrEqual(2);
      expect(result.timer).toBe(0);
      expect(reloaded).toMatchObject({ rootCount: 1, version: "v2.11-test-b" });
      expect(reloaded.hotReloadedAt).toBeTruthy();
    } finally {
      await browser.close();
    }
  }, 30_000);

  it("keeps native WhatsApp composer events additive while the overlay is open", async () => {
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });

    try {
      await page.setContent(`
        <!doctype html>
        <html lang="pt-BR">
          <body>
            <section id="main">
              <header style="position: relative; min-height: 64px">
                <span title="5531982066263">5531982066263</span>
                <button type="button" aria-label="Pesquisar">Pesquisar</button>
                <button type="button" aria-label="Mais opcoes">Mais</button>
              </header>
              <div data-id="false_5531982066263@c.us_M34">Mensagem</div>
              <footer>
                <div id="composer" contenteditable="true" role="textbox">Oi</div>
                <button id="native-send" type="button" aria-label="Enviar">Enviar</button>
              </footer>
            </section>
          </body>
        </html>
      `);
      await page.evaluate(createNuomaOverlayScript());
      const result = await page.evaluate((rootId) => {
        let sendClicks = 0;
        let composerEnter = 0;
        document.getElementById("native-send")?.addEventListener("click", () => {
          sendClicks += 1;
        });
        document.getElementById("composer")?.addEventListener("keydown", (event) => {
          if (event.key === "Enter" && !event.defaultPrevented) {
            composerEnter += 1;
          }
        });
        const host = document.getElementById(rootId);
        host?.shadowRoot?.querySelector<HTMLButtonElement>("[data-nuoma-fab]")?.click();
        document.getElementById("native-send")?.click();
        document.getElementById("composer")?.dispatchEvent(
          new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true }),
        );
        return {
          overlayState: host?.getAttribute("data-nuoma-state"),
          sendClicks,
          composerEnter,
        };
      }, NUOMA_OVERLAY_ROOT_ID);

      expect(result).toMatchObject({ overlayState: "open", sendClicks: 1, composerEnter: 1 });
    } finally {
      await browser.close();
    }
  }, 30_000);
});
