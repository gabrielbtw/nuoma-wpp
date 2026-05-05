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
        ariaLabel: "Abrir Nuoma CRM",
        title: "Abrir Nuoma CRM",
        version: NUOMA_OVERLAY_VERSION,
        threadPhone: "5531982066263",
        threadPhoneSource: "header-title",
        threadTitle: "5531982066263",
        insideHeader: true,
      });
      expect(state.buttonWidth).toBeGreaterThanOrEqual(38);
      expect(state.buttonHeight).toBeGreaterThanOrEqual(38);

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
          host?.shadowRoot
            ?.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`)
            ?.click();
          return {
            state: host?.getAttribute("data-nuoma-state"),
            clickDetail,
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, testId: NUOMA_OVERLAY_FAB_TEST_ID },
      );

      expect(clickState).toMatchObject({
        state: "open",
        clickDetail: {
          state: "open",
          phone: "5531982066263",
          phoneSource: "header-title",
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
            automations: [{ id: 1, name: "Boas-vindas", category: "Atendimento", status: "active" }],
            notes: "Nota fixture do painel.",
            source: "test",
          }) &&
          document
            .getElementById(rootId)
            ?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`)
            ?.textContent,
        { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
      );
      const panelText = await page.evaluate(
        ({ rootId, panelTestId }) =>
          document
            .getElementById(rootId)
            ?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`)
            ?.textContent ?? "",
        { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
      );
      expect(panelText).toContain("Contato Fixture");
      expect(panelText).toContain("Boas-vindas");
      expect(panelText).toContain("Nota fixture do painel.");

      await page.evaluate(createNuomaOverlayScript());
      const rootCountAfterSecondInject = await page.locator(`#${NUOMA_OVERLAY_ROOT_ID}`).count();
      expect(rootCountAfterSecondInject).toBe(1);
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
            phoneSource: "header-title",
            title: "5531982066263",
            contact: null,
            source: "nuoma-api",
            apiStatus: "loading",
            apiLastMethod: "contactSummary",
          });
          const loadingText = readPanel();

          setData({
            phone: "5531982066263",
            phoneSource: "header-title",
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
            phoneSource: "header-title",
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
          const disabledActions = Array.from(
            host?.shadowRoot?.querySelectorAll<HTMLButtonElement>(".nuoma-empty-action") ?? [],
          ).map((button) => ({ text: button.textContent, disabled: button.disabled }));

          return {
            loadingText,
            errorText,
            emptyText,
            disabledActions,
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
      );

      expect(state.loadingText).toContain("Carregando contato");
      expect(state.loadingText).toContain("Buscando resumo");
      expect(state.errorText).toContain("Erro na ponte API");
      expect(state.errorText).toContain("bridge offline");
      expect(state.emptyText).toContain("Contato nao encontrado no CRM");
      expect(state.emptyText).toContain("Criar contato (em breve)");
      expect(state.emptyText).toContain("Vincular contato (em breve)");
      expect(state.disabledActions).toEqual([
        { text: "Criar contato (em breve)", disabled: true },
        { text: "Vincular contato (em breve)", disabled: true },
      ]);
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
          const payloads =
            ((window as unknown as { __nuomaApiPayloads?: unknown[] }).__nuomaApiPayloads ??= []);
          payloads.push(request);
          setTimeout(() => {
            (
              window as unknown as {
                __nuomaApiResolve?: (id: string, response: unknown) => unknown;
              }
            ).__nuomaApiResolve?.(request.id, {
              ok: true,
              data: {
                phone: "5531982066263",
                phoneSource: "header-title",
                title: "5531982066263",
                contact: {
                  name: "Contato API Fixture",
                  status: "lead",
                  primaryChannel: "whatsapp",
                  notes: "Nota hidratada via window.__nuomaApi.",
                },
                conversations: [{ id: 7, channel: "whatsapp", lastPreview: "API bridge" }],
                latestMessages: [{ body: "Mensagem via API bridge", direction: "inbound" }],
                automations: [{ id: 7, name: "Bridge automation", category: "Embed", status: "active" }],
                notes: "Nota hidratada via window.__nuomaApi.",
                source: "nuoma-api",
                apiStatus: "online",
                apiLastMethod: request.method,
              },
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
                refreshContact: (input: unknown) => Promise<unknown>;
                request: (method: string, input: unknown) => Promise<unknown>;
                prepareMutation: (method: string, input: unknown) => {
                  method: string;
                  params: unknown;
                  nonce: string;
                  idempotencyKey: string;
                };
                confirmMutation: (intent: unknown, confirmationText: string) => Promise<unknown>;
              };
              __nuomaApiLastPayload?: unknown;
              __nuomaApiPayloads?: unknown[];
            }
          ).__nuomaApi;
          const response = await api.refreshContact({
            phone: "5531982066263",
            phoneSource: "header-title",
            title: "5531982066263",
            reason: "unit-test",
          });
          const blockedMutation = await api.request("addNote", { body: "sem confirmacao" });
          const mutationIntent = api.prepareMutation("addNote", { body: "nota segura" });
          const mutationResponse = await api.confirmMutation(mutationIntent, "Adicionar nota ao contato");
          const host = document.getElementById(rootId);
          host?.shadowRoot?.querySelector<HTMLButtonElement>("[data-nuoma-fab]")?.click();
          await new Promise((resolve) => setTimeout(resolve, 50));
          const panelText =
            host?.shadowRoot?.querySelector(`[data-testid="${panelTestId}"]`)?.textContent ?? "";
          return {
            managed: api.__nuomaManaged,
            response,
            blockedMutation,
            mutationResponse,
            lastPayload: (window as unknown as { __nuomaApiLastPayload?: unknown }).__nuomaApiLastPayload,
            payloads: (window as unknown as { __nuomaApiPayloads?: unknown[] }).__nuomaApiPayloads,
            apiStatus: host?.getAttribute("data-nuoma-api-status"),
            panelText,
          };
        },
        { rootId: NUOMA_OVERLAY_ROOT_ID, panelTestId: NUOMA_OVERLAY_PANEL_TEST_ID },
      );

      expect(state.managed).toBe(true);
      expect(state.response).toMatchObject({ ok: true });
      expect(state.blockedMutation).toMatchObject({
        ok: false,
        error: { code: "mutation_guard_required" },
      });
      expect(state.mutationResponse).toMatchObject({ ok: true });
      expect(state.payloads).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ method: "contactSummary" }),
          expect.objectContaining({
            method: "addNote",
            mutation: expect.objectContaining({
              confirmed: true,
              confirmationText: "Adicionar nota ao contato",
              nonce: expect.any(String),
              idempotencyKey: expect.any(String),
            }),
          }),
        ]),
      );
      expect(state.apiStatus).toBe("online");
      expect(state.panelText).toContain("Contato API Fixture");
      expect(state.panelText).toContain("Ponte API");
      expect(state.panelText).toContain("online / contactSummary");
      expect(state.panelText).toContain("Bridge automation");
    } finally {
      await browser.close();
    }
  }, 30_000);
});
