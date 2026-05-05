import { SYNC_BINDING_NAME } from "./events.js";

export function createWhatsAppObserverScript(bindingName = SYNC_BINDING_NAME): string {
  return `
(() => {
  const bindingName = ${JSON.stringify(bindingName)};
  const observerVersion = "2026-05-05.1";
  const source = "wa-web";
  const channel = "whatsapp";
  const seen = new Map();
  const attachmentSeen = new Map();
  let lastThreadId = null;
  let lastSidebarFingerprint = null;
  let lastDomAlertAt = 0;
  let missingDomSince = null;

  if (window.__nuomaSyncObserverInstalled) {
    if (
      window.__nuomaSyncObserverVersion === observerVersion &&
      typeof window.__nuomaSyncScan === "function"
    ) {
      queueMicrotask(window.__nuomaSyncScan);
      return;
    }
    if (window.__nuomaSyncObserver && typeof window.__nuomaSyncObserver.disconnect === "function") {
      window.__nuomaSyncObserver.disconnect();
    }
    window.__nuomaSyncObserverInstalled = false;
  }

  if (window.__nuomaSyncObserverInstalled) {
    return;
  }
  window.__nuomaSyncObserverInstalled = true;

  function nowIso() {
    return new Date().toISOString();
  }

  function emit(event) {
    const binding = window[bindingName];
    if (typeof binding !== "function") {
      return;
    }
    binding(JSON.stringify({
      source,
      observedAtUtc: nowIso(),
      ...event,
    }));
  }

  function emitDomChanged(reason, details) {
    const now = Date.now();
    if (now - lastDomAlertAt < 30000) {
      return;
    }
    lastDomAlertAt = now;
    emit({
      type: "dom-wa-changed",
      thread: activeThread(),
      details: {
        reason,
        observerVersion,
        ...(details || {}),
      },
    });
  }

  function textOf(selector, root) {
    const node = (root || document).querySelector(selector);
    return cleanText(node && (node.getAttribute("title") || node.textContent));
  }

  function cleanText(value) {
    return String(value || "").replace(/\\s+/g, " ").trim();
  }

  function activeThread() {
    const header = document.querySelector("#main header");
    const title =
      chatTitleFromHeader(header) ||
      textOf("[data-testid='conversation-info-header-chat-title']", header) ||
      "WhatsApp";
    const phone = normalizePhone(title);
    const hrefKey = location.href.includes("/send?phone=")
      ? new URL(location.href).searchParams.get("phone")
      : null;
    const externalThreadId = hrefKey || phone || title;
    return {
      channel,
      externalThreadId,
      title,
      phone,
      unreadCount: 0,
      fingerprint: null,
    };
  }

  function profilePhotoImage() {
    const header = document.querySelector("#main header");
    if (!header) {
      return null;
    }
    const images = Array.from(header.querySelectorAll("img"))
      .filter((node) => node instanceof HTMLImageElement)
      .filter((image) => image.naturalWidth >= 24 && image.naturalHeight >= 24)
      .filter((image) => {
        const src = String(image.currentSrc || image.src || "");
        return src && !src.startsWith("data:image/svg") && !src.includes("default-contact");
      });
    return images[0] || null;
  }

  async function profilePhotoSnapshot() {
    const image = profilePhotoImage();
    if (!image) {
      return null;
    }
    const sourceUrl = String(image.currentSrc || image.src || "");
    if (!sourceUrl) {
      return null;
    }
    const response = await fetch(sourceUrl);
    if (!response.ok) {
      return null;
    }
    const blob = await response.blob();
    if (!blob.type.startsWith("image/")) {
      return null;
    }
    const buffer = await blob.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buffer);
    const sha256 = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const dataBase64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || "").split(",")[1] || "");
      reader.onerror = () => reject(reader.error || new Error("profile photo read failed"));
      reader.readAsDataURL(blob);
    });
    return {
      thread: activeThread(),
      dataBase64,
      mimeType: blob.type,
      sha256,
      sizeBytes: buffer.byteLength,
      sourceUrl: sourceUrl.startsWith("http://") || sourceUrl.startsWith("https://") ? sourceUrl : null,
    };
  }

  function chatTitleFromHeader(header) {
    if (!header) {
      return null;
    }
    const titledCandidates = Array.from(header.querySelectorAll("span[title]"))
      .map((node) => cleanText(node.getAttribute("title") || node.textContent))
      .filter(isChatTitleCandidate);
    if (titledCandidates[0]) {
      return titledCandidates[0];
    }
    const candidates = Array.from(header.querySelectorAll("span, div"))
      .map((node) => cleanText(node.textContent))
      .filter(isChatTitleCandidate);
    return candidates[0] || null;
  }

  function isChatTitleCandidate(text) {
    if (!text || text.length < 2) return false;
    if (text.startsWith("ic-")) return false;
    if (text.startsWith("wds-ic-")) return false;
    if (text.includes("default-contact")) return false;
    if (text.includes("Etiquetar conversa")) return false;
    if (text.includes("Dados do perfil")) return false;
    if (text.includes("clique para mostrar")) return false;
    if (text.toLowerCase().startsWith("visto por último")) return false;
    if (text.toLowerCase().startsWith("last seen")) return false;
    if (text.toLowerCase().includes("digitando")) return false;
    if (text.toLowerCase().includes("typing")) return false;
    if (text.toLowerCase() === "conta comercial") return false;
    if (text.toLowerCase() === "business account") return false;
    if (text.includes("label-outline")) return false;
    return true;
  }

  function normalizePhone(value) {
    const digits = cleanText(value).replace(/\\D/g, "");
    return digits.length >= 8 ? digits : null;
  }

  function phoneFromText(value) {
    const text = cleanText(value);
    const matches = text.match(/(?:\\+?\\d[\\d\\s().-]{7,}\\d)/g) || [];
    for (const match of matches) {
      const digits = match.replace(/\\D/g, "");
      if (digits.length >= 10 && digits.length <= 13) {
        return digits;
      }
    }
    return normalizePhone(text);
  }

  function parsePrePlainText(value) {
    const text = cleanText(value);
    const match = text.match(/\\[(\\d{1,2}):(\\d{2})(?::(\\d{2}))?,\\s*(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})\\]/);
    if (!match) {
      return {
        displayedAtText: text || null,
        waDisplayedAt: null,
        timestampPrecision: "unknown",
        messageSecond: null,
        minuteKey: null,
      };
    }
    const hour = match[1].padStart(2, "0");
    const minute = match[2].padStart(2, "0");
    const second = match[3] ? match[3].padStart(2, "0") : "00";
    const day = match[4].padStart(2, "0");
    const month = match[5].padStart(2, "0");
    const year = match[6].length === 2 ? "20" + match[6] : match[6];
    return {
      displayedAtText: text,
      waDisplayedAt: year + "-" + month + "-" + day + "T" + hour + ":" + minute + ":" + second + ".000-03:00",
      timestampPrecision: match[3] ? "second" : "minute",
      messageSecond: match[3] ? Number(second) : null,
      minuteKey: year + "-" + month + "-" + day + "T" + hour + ":" + minute + "-03:00",
    };
  }

  function timestampFromNode(node) {
    const prePlainNode = node.querySelector("[data-pre-plain-text]");
    const timestamp = parsePrePlainText(
      node.getAttribute("data-pre-plain-text") ||
        (prePlainNode && prePlainNode.getAttribute("data-pre-plain-text")),
    );
    if (timestamp.timestampPrecision !== "unknown") {
      return timestamp;
    }

    const visibleTime = visibleTimeFromNode(node);
    if (!visibleTime) {
      return timestamp;
    }

    const date = visibleDateForNode(node);
    if (!date) {
      return {
        ...timestamp,
        displayedAtText: visibleTime,
      };
    }

    return {
      displayedAtText: date.label + " " + visibleTime,
      waDisplayedAt: date.isoDate + "T" + visibleTime + ":00.000-03:00",
      timestampPrecision: "minute",
      messageSecond: null,
      minuteKey: date.isoDate + "T" + visibleTime + "-03:00",
    };
  }

  function visibleTimeFromNode(node) {
    const metaNode = node.querySelector("[data-testid='msg-meta']");
    const text = cleanText((metaNode && metaNode.textContent) || node.textContent);
    const matches = text.match(/\\d{1,2}:\\d{2}/g);
    if (!matches || matches.length === 0) {
      return null;
    }
    const value = matches[matches.length - 1];
    const parts = value.split(":");
    return parts[0].padStart(2, "0") + ":" + parts[1];
  }

  function visibleDateForNode(node) {
    const main = document.querySelector("#main") || document.body || document.documentElement;
    const labels = Array.from(main.querySelectorAll("span, div"))
      .filter((candidate) => {
        if (!(candidate instanceof HTMLElement)) return false;
        if (candidate.contains(node)) return false;
        if (!(candidate.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) {
          return false;
        }
        return dateFromLabel(cleanText(candidate.textContent)) !== null;
      })
      .map((candidate) => dateFromLabel(cleanText(candidate.textContent)))
      .filter(Boolean);
    return labels.length > 0 ? labels[labels.length - 1] : currentBrazilDate("Hoje");
  }

  function dateFromLabel(label) {
    const text = cleanText(label);
    if (!text || text.length > 30) {
      return null;
    }
    if (/^hoje$/i.test(text)) {
      return currentBrazilDate("Hoje");
    }
    if (/^ontem$/i.test(text)) {
      const date = new Date();
      date.setDate(date.getDate() - 1);
      return brazilDateFromDate(date, "Ontem");
    }
    const numeric = text.match(/^(\\d{1,2})\\/(\\d{1,2})\\/(\\d{2,4})$/);
    if (numeric) {
      const year = numeric[3].length === 2 ? "20" + numeric[3] : numeric[3];
      return {
        label: text,
        isoDate: year + "-" + numeric[2].padStart(2, "0") + "-" + numeric[1].padStart(2, "0"),
      };
    }
    return null;
  }

  function currentBrazilDate(label) {
    return brazilDateFromDate(new Date(), label);
  }

  function brazilDateFromDate(date, label) {
    return {
      label,
      isoDate: new Intl.DateTimeFormat("sv-SE", {
        timeZone: "America/Sao_Paulo",
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
      }).format(date),
    };
  }

  function directionFromNode(node) {
    const dataId = node.getAttribute("data-id");
    if (String(dataId).startsWith("true_")) {
      return "outbound";
    }
    if (String(dataId).startsWith("false_")) {
      return "inbound";
    }
    if (node.querySelector(".message-out, [class*='message-out'], [aria-label='Você:'], [aria-label='You:']")) {
      return "outbound";
    }
    if (node.querySelector(".message-in, [class*='message-in']")) {
      return "inbound";
    }
    const text = cleanText(node.textContent).toLowerCase();
    if (text.includes("tail-out") || text.includes("msg-dblcheck")) {
      return "outbound";
    }
    if (text.includes("tail-in")) {
      return "inbound";
    }
    return "inbound";
  }

  function bodyFromNode(node) {
    const textNode = node.querySelector(
      "[data-testid='selectable-text'], .selectable-text, [data-testid='msg-text']",
    );
    const explicitText = cleanText(textNode && textNode.textContent);
    if (explicitText) {
      return isUiOnlyMessageText(explicitText) ? null : explicitText;
    }

    const fallback = cleanText(node.textContent)
      .replace(/tail-(in|out)/g, "")
      .replace(/msg-dblcheck/g, "")
      .replace(/default-contact-refreshed/g, "")
      .replace(/forward-refreshed/g, "")
      .replace(/^Encaminhada\\s*/i, "")
      .replace(/^Forwarded\\s*/i, "")
      .replace(/ptt-status/g, "")
      .replace(/video-pip/g, "")
      .replace(/media-play/g, "")
      .replace(/media-cancel/g, "")
      .replace(/msg-video/g, "")
      .replace(/ic-play-arrow-filled/g, "")
      .replace(/^unknown/g, "")
      .replace(/(\\d{1,2}:\\d{2}){1,2}$/g, "")
      .trim();

    if (!fallback || isUiOnlyMessageText(fallback)) {
      return null;
    }

    return fallback;
  }

  function messageContextFromNode(node) {
    const text = cleanText(node.textContent);
    const quotedNode = node.querySelector("[data-testid='quoted-msg'], [aria-label*='Resposta'], [aria-label*='Reply']");
    const reactionNode = node.querySelector("[data-testid*='reaction'], [aria-label*='reação'], [aria-label*='reaction']");
    const isForwarded =
      /\\bEncaminhada\\b/i.test(text) ||
      /\\bForwarded\\b/i.test(text) ||
      Boolean(node.querySelector("[data-testid*='forward']"));
    const isEdited = /\\b(editada|edited)\\b/i.test(text);
    const isPoll = /\\b(enquete|poll)\\b/i.test(text) || Boolean(node.querySelector("[data-testid*='poll']"));
    const isLocation =
      /\\b(localização|location|maps\\.google|goo\\.gl\\/maps)\\b/i.test(text) ||
      Boolean(node.querySelector("a[href*='maps.google'], a[href*='wa.me/l']"));
    return {
      isForwarded,
      isEdited,
      isReply: Boolean(quotedNode),
      quotedText: quotedNode ? cleanText(quotedNode.textContent).slice(0, 500) : null,
      reactionText: reactionNode ? cleanText(reactionNode.textContent).slice(0, 100) : null,
      isPoll,
      isLocation,
    };
  }

  function isUiOnlyMessageText(value) {
    const text = cleanText(value)
      .replace(/[\\u200e\\u200f\\u202a-\\u202e]/g, "")
      .replace(/\\s/g, "");
    return /^((\\d{1,2}:\\d{2})|(\\d+:\\d{2})|(\\d+[,.]\\d×))*$/.test(text);
  }

  function statusFromNode(node) {
    const nestedLabels = Array.from(node.querySelectorAll("[aria-label]"))
      .map((candidate) => candidate.getAttribute("aria-label"))
      .filter(Boolean)
      .join(" ");
    const label = cleanText(
      [node.getAttribute("aria-label"), nestedLabels, node.textContent].filter(Boolean).join(" "),
    ).toLowerCase();
    if (label.includes("read") || label.includes("lida")) return "read";
    if (label.includes("delivered") || label.includes("entregue")) return "delivered";
    if (label.includes("sent") || label.includes("enviada")) return "sent";
    if (label.includes("failed") || label.includes("falha")) return "failed";
    return directionFromNode(node) === "outbound" ? "sent" : "received";
  }

  function contentTypeFromNode(node) {
    const label = cleanText(node.getAttribute("aria-label") || node.textContent).toLowerCase();
    if (label.includes("localização") || label.includes("location") || label.includes("maps.google")) return "link";
    if (label.includes("enquete") || label.includes("poll")) return "system";
    if (label.includes("sticker")) return "sticker";
    if (label.includes("ic-play-arrow-filled") || label.includes("ptt-status")) return "audio";
    if (label.includes("image") || label.includes("imagem") || node.querySelector("img")) return "image";
    if (label.includes("audio") || label.includes("áudio")) return "audio";
    if (label.includes("video") || label.includes("vídeo")) return "video";
    if (label.includes("document") || label.includes("documento")) return "document";
    return "text";
  }

  function attachmentCandidateFromEntry(entry) {
    const contentType = entry.message.contentType;
    if (!["image", "audio", "voice", "video", "document"].includes(contentType)) {
      return null;
    }
    const sourceUrl = attachmentSourceUrl(entry.node, contentType);
    const caption = entry.message.body;
    const seed = [
      entry.message.externalId,
      contentType,
      sourceUrl || "",
      caption || "",
      entry.message.displayedAtText || "",
    ].join("|");
    const sha256 = candidateSha256(seed);
    const fileName = attachmentFileName(entry.node, contentType, sha256);
    return {
      contentType,
      externalMessageId: entry.message.externalId,
      fileName,
      mimeType: attachmentMimeType(contentType, sourceUrl, fileName),
      sha256,
      sizeBytes: 0,
      durationMs: null,
      storagePath: "wa-visible://" + sha256,
      sourceUrl: validUrlOrNull(sourceUrl),
      caption,
    };
  }

  function attachmentSourceUrl(node, contentType) {
    if (contentType === "image") {
      const image = node.querySelector("img");
      return image ? String(image.currentSrc || image.src || "") : null;
    }
    if (contentType === "video") {
      const video = node.querySelector("video");
      const source = node.querySelector("video source");
      return String(
        (video && (video.currentSrc || video.src || video.poster)) ||
          (source && source.src) ||
          "",
      ) || null;
    }
    if (contentType === "audio" || contentType === "voice") {
      const audio = node.querySelector("audio");
      const source = node.querySelector("audio source");
      return String((audio && (audio.currentSrc || audio.src)) || (source && source.src) || "") || null;
    }
    const link = node.querySelector("a[href]");
    return link ? String(link.href || link.getAttribute("href") || "") : null;
  }

  function attachmentFileName(node, contentType, sha256) {
    const sourceNode = node.querySelector("[download], [title], [aria-label]");
    const raw =
      sourceNode &&
      cleanText(
        sourceNode.getAttribute("download") ||
          sourceNode.getAttribute("title") ||
          sourceNode.getAttribute("aria-label"),
      );
    const cleaned = String(raw || "")
      .replace(/[<>:"/\\\\|?*]+/g, "-")
      .replace(/\\s+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80);
    if (cleaned && cleaned.includes(".")) {
      return cleaned;
    }
    return (cleaned || contentType) + "-" + sha256.slice(0, 12) + attachmentExtension(contentType);
  }

  function attachmentExtension(contentType) {
    if (contentType === "image") return ".jpg";
    if (contentType === "video") return ".mp4";
    if (contentType === "audio" || contentType === "voice") return ".ogg";
    if (contentType === "document") return ".bin";
    return ".bin";
  }

  function attachmentMimeType(contentType, sourceUrl, fileName) {
    const value = String(sourceUrl || fileName || "").toLowerCase();
    if (value.includes(".png")) return "image/png";
    if (value.includes(".webp")) return "image/webp";
    if (value.includes(".mp4")) return "video/mp4";
    if (value.includes(".webm")) return "video/webm";
    if (value.includes(".ogg") || value.includes(".oga")) return "audio/ogg";
    if (value.includes(".mp3")) return "audio/mpeg";
    if (value.includes(".pdf")) return "application/pdf";
    if (contentType === "image") return "image/jpeg";
    if (contentType === "video") return "video/mp4";
    if (contentType === "audio" || contentType === "voice") return "audio/ogg";
    return "application/octet-stream";
  }

  function validUrlOrNull(value) {
    if (!value) {
      return null;
    }
    try {
      new URL(value);
      return value;
    } catch {
      return null;
    }
  }

  function candidateSha256(seed) {
    let hash = 0x811c9dc5;
    for (let index = 0; index < seed.length; index += 1) {
      hash ^= seed.charCodeAt(index);
      hash = Math.imul(hash, 0x01000193);
    }
    const parts = [];
    for (let index = 0; index < 8; index += 1) {
      hash ^= index + seed.length;
      hash = Math.imul(hash, 0x01000193);
      parts.push((hash >>> 0).toString(16).padStart(8, "0"));
    }
    return parts.join("").slice(0, 64);
  }

  function collectMessages() {
    const thread = activeThread();
    const nodes = Array.from(document.querySelectorAll("[data-id]"))
      .filter((node) => node instanceof HTMLElement)
      .filter((node) => {
        const dataId = node.getAttribute("data-id") || "";
        return (
          dataId.length > 0 &&
          !dataId.includes("status@broadcast") &&
          !dataId.startsWith("grouped-sticker--")
        );
      });
    const messages = nodes.map((node, index) => {
      const externalId = node.getAttribute("data-id");
      const timestamp = timestampFromNode(node);
      const context = messageContextFromNode(node);
      const status = statusFromNode(node);
      return {
        node,
        index,
        thread,
        minuteKey: timestamp.minuteKey,
        message: {
          externalId,
          direction: directionFromNode(node),
          contentType: contentTypeFromNode(node),
          status,
          body: bodyFromNode(node),
          displayedAtText: timestamp.displayedAtText,
          waDisplayedAt: timestamp.waDisplayedAt,
          timestampPrecision: timestamp.timestampPrecision,
          messageSecond: timestamp.messageSecond,
          waInferredSecond: timestamp.messageSecond,
          observedAtUtc: nowIso(),
          raw: {
            dataId: externalId,
            deliveryStatus: status,
            deliveryStatusSource: "observer",
            domIndex: index,
            ...context,
          },
        },
      };
    });

    const byMinute = new Map();
    messages.forEach((entry, index) => {
      if (entry.message.messageSecond !== null || !entry.minuteKey) {
        return;
      }
      const indexes = byMinute.get(entry.minuteKey) || [];
      indexes.push(index);
      byMinute.set(entry.minuteKey, indexes);
    });
    byMinute.forEach((indexes) => {
      const start = Math.max(0, 60 - indexes.length);
      indexes.forEach((messageIndex, groupIndex) => {
        messages[messageIndex].message.waInferredSecond = Math.min(59, start + groupIndex);
      });
    });

    return messages;
  }

  function scanMessages(options) {
    const force = Boolean(options && options.force);
    const reason = (options && options.reason) || "observer-scan";
    const details = (options && options.details) || null;
    const currentIds = new Set();
    const currentAttachmentKeys = new Set();
    const entries = collectMessages();
    for (const entry of entries) {
      currentIds.add(entry.message.externalId);
      const signature = JSON.stringify({
        body: entry.message.body,
        status: entry.message.status,
        raw: entry.message.raw,
        deleted: entry.node.getAttribute("data-deleted") || null,
      });
      const previous = seen.get(entry.message.externalId);
      seen.set(entry.message.externalId, signature);
      if (!previous || force || previous !== signature) {
        emit({
          type: previous && previous !== signature ? "message-updated" : "message-added",
          thread: entry.thread,
          message: {
            ...entry.message,
            raw: {
              ...entry.message.raw,
              reconcileReason: force ? reason : null,
              reconcileDetails: force ? details : null,
            },
          },
        });
      }
      const attachment = attachmentCandidateFromEntry(entry);
      if (attachment) {
        const attachmentKey = attachment.externalMessageId + ":" + attachment.sha256;
        currentAttachmentKeys.add(attachmentKey);
        const attachmentSignature = JSON.stringify({
          contentType: attachment.contentType,
          caption: attachment.caption,
          sourceUrl: attachment.sourceUrl,
          storagePath: attachment.storagePath,
        });
        const previousAttachment = attachmentSeen.get(attachmentKey);
        attachmentSeen.set(attachmentKey, attachmentSignature);
        if (!previousAttachment || force || previousAttachment !== attachmentSignature) {
          emit({
            type: "attachment-candidate-captured",
            thread: entry.thread,
            attachment,
            details: {
              reconcileReason: force ? reason : null,
              reconcileDetails: force ? details : null,
              observerVersion,
              domIndex: entry.index,
              captureMode: "visible-dom-candidate",
            },
          });
        }
      }
    }

    for (const externalId of Array.from(seen.keys())) {
      if (!currentIds.has(externalId)) {
        seen.delete(externalId);
      }
    }
    for (const attachmentKey of Array.from(attachmentSeen.keys())) {
      if (!currentAttachmentKeys.has(attachmentKey)) {
        attachmentSeen.delete(attachmentKey);
      }
    }

    return {
      thread: entries[0] ? entries[0].thread : activeThread(),
      visibleMessageCount: entries.length,
      firstExternalId: entries[0] ? entries[0].message.externalId : null,
      lastExternalId: entries[entries.length - 1]
        ? entries[entries.length - 1].message.externalId
        : null,
      visibleExternalIds: entries.map((entry) => entry.message.externalId),
    };
  }

  function scanThread() {
    const thread = activeThread();
    if (thread.externalThreadId !== lastThreadId) {
      lastThreadId = thread.externalThreadId;
      emit({ type: "chat-opened", thread });
    }
  }

  function scanSidebar() {
    const sidebar = document.querySelector("#pane-side");
    if (!sidebar) {
      return;
    }
    const fingerprint = cleanText(sidebar.textContent).slice(0, 4000);
    if (fingerprint && fingerprint !== lastSidebarFingerprint) {
      lastSidebarFingerprint = fingerprint;
      emit({
        type: "conversation-fingerprint-changed",
        thread: activeThread(),
        details: { fingerprint },
      });
      queueMicrotask(() => reconcile("sidebar-fingerprint-changed"));
    }
  }

  function scanDomHealth() {
    const hasMain = Boolean(document.querySelector("#main"));
    const hasSidebar = Boolean(document.querySelector("#pane-side"));
    if (hasMain && hasSidebar) {
      missingDomSince = null;
      return;
    }
    if (String(location.href || "").includes("/send?phone=")) {
      missingDomSince = null;
      return;
    }
    if (document.readyState !== "complete") {
      missingDomSince = null;
      return;
    }
    if (missingDomSince === null) {
      missingDomSince = Date.now();
      return;
    }
    if (Date.now() - missingDomSince >= 10000) {
      emitDomChanged("wa-dom-surface-missing", { hasMain, hasSidebar });
    }
  }

  function scan() {
    scanDomHealth();
    scanThread();
    scanSidebar();
    scanMessages({ force: false, reason: "observer-scan" });
  }

  function reconcile(reason, extraDetails) {
    return reconcileWithDetails(reason, extraDetails || {});
  }

  function reconcileWithDetails(reason, extraDetails) {
    scanDomHealth();
    scanThread();
    scanSidebar();
    const summary = scanMessages({
      force: true,
      reason: reason || "hot-window",
      details: extraDetails || {},
    });
    emit({
      type: "reconcile-snapshot",
      thread: summary.thread,
      details: {
        ...(extraDetails || {}),
        reason: reason || "hot-window",
        visibleMessageCount: summary.visibleMessageCount,
        firstExternalId: summary.firstExternalId,
        lastExternalId: summary.lastExternalId,
      },
    });
    return summary;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function messageScrollContainer() {
    const main = document.querySelector("#main");
    if (!main) {
      return null;
    }
    const candidates = Array.from(
      main.querySelectorAll(
        "[data-testid='conversation-panel-wrapper'], [role='application'], .copyable-area, div"
      )
    ).filter((node) => node instanceof HTMLElement);
    const scrollable = candidates
      .filter((node) => node.scrollHeight > node.clientHeight + 24)
      .sort((a, b) => b.scrollHeight - a.scrollHeight);
    return scrollable[0] || (main instanceof HTMLElement ? main : null);
  }

  async function scrollHistory(options) {
    const reason = (options && options.reason) || "history-backfill";
    const details = (options && options.details) || {};
    const delayMs = Math.max(250, Number((options && options.delayMs) || 1200));
    const before = scanMessages({
      force: true,
      reason: reason + ":before",
      details: {
        ...details,
        phase: "before-scroll",
      },
    });
    const container = messageScrollContainer();
    if (!container) {
      return {
        ...before,
        moved: false,
        beforeFirstExternalId: before.firstExternalId,
        beforeScrollTop: null,
        afterScrollTop: null,
      };
    }
    const beforeScrollTop = container.scrollTop;
    const distance = Math.max(Math.floor(container.clientHeight * 0.85), 600);
    container.scrollTop = Math.max(0, beforeScrollTop - distance);
    container.dispatchEvent(new Event("scroll", { bubbles: true }));
    await sleep(delayMs);
    const afterScrollTop = container.scrollTop;
    const after = reconcileWithDetails(reason, {
      ...details,
      phase: "after-scroll",
      beforeFirstExternalId: before.firstExternalId,
      beforeScrollTop,
      afterScrollTop,
    });
    return {
      ...after,
      moved:
        afterScrollTop !== beforeScrollTop ||
        (after.firstExternalId !== null && after.firstExternalId !== before.firstExternalId),
      beforeFirstExternalId: before.firstExternalId,
      beforeScrollTop,
      afterScrollTop,
    };
  }

  function sidebarChats(limit) {
    const sidebar = document.querySelector("#pane-side");
    if (!sidebar) {
      return [];
    }
    const nodes = Array.from(
      sidebar.querySelectorAll(
        "[aria-selected], [role='gridcell'], [data-testid='cell-frame-container'], [role='listitem']"
      )
    )
      .filter((node) => node instanceof HTMLElement)
      .map((node) => {
        const element =
          node.closest("[aria-selected]") ||
          node.closest("[role='gridcell']") ||
          node.closest("button") ||
          node.closest("[role='listitem']") ||
          node;
        return element instanceof HTMLElement ? element : node;
      });
    const seenRows = new Set();
    const rows = [];
    for (const node of nodes) {
      if (seenRows.has(node)) {
        continue;
      }
      seenRows.add(node);
      const text = cleanText(node.textContent);
      if (!text || text.length < 2) {
        continue;
      }
      if (
        node.getAttribute("aria-selected") === "true" ||
        text.includes("Arquivadas") ||
        text.includes("archive-refreshed") ||
        text.includes("Archived")
      ) {
        continue;
      }
      const titleNode =
        node.querySelector("[data-testid='cell-frame-title']") || node.querySelector("span[title]");
      const title = cleanText(
        (titleNode && (titleNode.getAttribute("title") || titleNode.textContent)) ||
          text
            .replace(/\\d+ mensagens? não lidas/gi, "")
            .replace(/\\d+ unread messages?/gi, "")
            .replace(/wds-ic-[a-z0-9-]+/gi, "")
            .replace(/default-contact-refreshed/gi, "")
            .replace(/status-dblcheck/gi, "")
            .replace(/ic-[a-z0-9-]+/gi, "")
            .split(/\\b(?:Hoje|Ontem|segunda-feira|terça-feira|quarta-feira|quinta-feira|sexta-feira|sábado|domingo|\\d{1,2}:\\d{2})\\b/i)[0]
            .trim(),
      );
      if (!title || title === "WhatsApp" || title.includes("Clique para conversar") || !isChatTitleCandidate(title)) {
        continue;
      }
      const phone = phoneFromText(title) || phoneFromText(text);
      const unreadText = cleanText(text.replace(title, " "));
      const unreadMatch =
        unreadText.match(/(?:^|\\D)(\\d+)\\s+mensagens? não lidas/i) ||
        unreadText.match(/(?:^|\\D)(\\d+)\\s+unread messages?/i);
      rows.push({
        element: node,
        title,
        phone: phone || null,
        unreadCount: unreadMatch ? Number(unreadMatch[1]) : 0,
        selected: node.getAttribute("aria-selected") === "true",
        kind: phone ? "phone" : "named",
        fingerprint: text.slice(0, 500),
      });
      if (rows.length >= limit) {
        break;
      }
    }
    return rows;
  }

  async function waitForChatLoad(previousThreadId, delayMs) {
    const deadline = Date.now() + Math.max(delayMs, 2500);
    while (Date.now() < deadline) {
      const thread = activeThread();
      const visibleMessages = document.querySelectorAll("#main [data-id]").length;
      if (visibleMessages > 0 && thread.externalThreadId !== previousThreadId) {
        return;
      }
      await sleep(150);
    }
  }

  async function openCandidate(candidate, delayMs, navigateByUrl) {
    const before = activeThread();
    if (navigateByUrl && candidate.phone) {
      location.assign("https://web.whatsapp.com/send?phone=" + encodeURIComponent(candidate.phone));
      await waitForChatLoad(before.externalThreadId, delayMs + 1500);
      return;
    }
    candidate.element.click();
    await waitForChatLoad(before.externalThreadId, delayMs);
  }

  async function reconcileHotWindow(options) {
    const reason = (options && options.reason) || "hot-window";
    const limit = Math.max(1, Math.min(Number((options && options.limit) || 5), 20));
    const delayMs = Math.max(250, Number((options && options.delayMs) || 1200));
    const navigateByUrl = !(options && options.navigateByUrl === false);
    const startedThread = activeThread();
    const candidates = sidebarChats(limit);
    let visited = 0;
    let errors = 0;

    reconcileWithDetails(reason + ":active", {
      scope: "multi-chat",
      candidateIndex: -1,
      candidateTitle: startedThread.title,
    });

    for (let index = 0; index < candidates.length; index += 1) {
      const candidate = candidates[index];
      try {
        await openCandidate(candidate, delayMs, navigateByUrl);
        await sleep(delayMs);
        reconcileWithDetails(reason + ":sidebar", {
          scope: "multi-chat",
          candidateIndex: index,
          candidateTitle: candidate.title,
          candidatePhone: candidate.phone,
          candidateFingerprint: candidate.fingerprint,
        });
        visited += 1;
      } catch (error) {
        errors += 1;
        emit({
          type: "dom-wa-changed",
          thread: activeThread(),
          details: {
            reason: "multi-chat-reconcile-click-failed",
            candidateIndex: index,
            candidateTitle: candidate.title,
            error: String(error && error.message ? error.message : error),
          },
        });
      }
    }

    const restorePhone = phoneFromText(options && options.restorePhone);
    const restore = sidebarChats(Math.max(limit, 10)).find(
      (candidate) =>
        candidate.title === startedThread.title ||
        (restorePhone && candidate.phone === restorePhone) ||
        (startedThread.phone && candidate.phone === startedThread.phone),
    );
    if (restore || restorePhone) {
      try {
        const before = activeThread();
        if (navigateByUrl && restorePhone) {
          location.assign(
            "https://web.whatsapp.com/send?phone=" + encodeURIComponent(restorePhone),
          );
          await waitForChatLoad(before.externalThreadId, delayMs + 1500);
        } else if (restore) {
          await openCandidate(restore, delayMs, navigateByUrl);
        }
        await sleep(Math.min(delayMs, 1000));
        reconcileWithDetails(reason + ":restore", {
          scope: "multi-chat",
          candidateIndex: -2,
          candidateTitle: restore ? restore.title : startedThread.title,
          candidatePhone: restorePhone || (restore && restore.phone) || null,
        });
      } catch {
        errors += 1;
      }
    }

    return {
      mode: "multi-chat",
      candidates: candidates.length,
      visited,
      errors,
      restored: Boolean(restore || restorePhone),
    };
  }

  const observer = new MutationObserver(() => scan());
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ["data-id", "data-pre-plain-text", "aria-label", "data-deleted"],
  });

  window.__nuomaSyncObserver = observer;
  window.__nuomaSyncObserverVersion = observerVersion;
  window.__nuomaSyncScan = scan;
  window.__nuomaSyncReconcile = reconcile;
  window.__nuomaSyncScrollHistory = scrollHistory;
  window.__nuomaSyncProfilePhoto = profilePhotoSnapshot;
  window.__nuomaSyncSidebarChats = (limit) =>
    sidebarChats(limit || 5).map((candidate) => ({
      title: candidate.title,
      phone: candidate.phone,
      unreadCount: candidate.unreadCount,
      kind: candidate.kind,
      selected: candidate.selected,
      fingerprint: candidate.fingerprint,
    }));
  window.__nuomaSyncReconcileHotWindow = reconcileHotWindow;
  queueMicrotask(scan);
  setInterval(scan, 5000);
})();
`;
}
