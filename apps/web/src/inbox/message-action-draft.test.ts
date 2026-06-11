import { describe, expect, it } from "vitest";

import { composerBodyForAction, type MessageActionDraft } from "./message-action-draft.js";

const baseDraft: MessageActionDraft = {
  draftId: 1,
  kind: "reply",
  messageId: 42,
  text: "Mensagem original",
  excerpt: "Mensagem original",
  contentType: "text",
  direction: "inbound",
};

describe("composer action drafts", () => {
  it("turns cite actions into an explicit quote prefix", () => {
    expect(
      composerBodyForAction({
        actionDraft: baseDraft,
        text: "Resposta nova",
      }),
    ).toBe("> Mensagem original\n\nResposta nova");
  });

  it("reuses text without promising native edit behavior", () => {
    expect(
      composerBodyForAction({
        actionDraft: { ...baseDraft, kind: "edit" },
        text: "Mensagem original revisada",
      }),
    ).toBe("Mensagem original revisada");
  });
});
