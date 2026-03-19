import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, readdirSync, readFileSync, rmSync, statSync } from "node:fs";
import { homedir } from "node:os";
import path from "node:path";
import { loadEnv } from "../config/env.js";
import { getDb } from "../db/connection.js";
import {
  createDataLakeReport,
  getLatestDataLakeReport,
  listDataLakeAssets,
  listDataLakeSources,
  listDataLakeTextCorpus,
  upsertDataLakeAsset,
  upsertDataLakeSource,
  type DataLakeAssetRecord
} from "../repositories/data-lake-repository.js";
import { recordSystemEvent } from "../repositories/system-repository.js";
import { extractInstagramConversationSnapshots, listInstagramExportFiles } from "./instagram-contact-import-service.js";
import { ensureDir } from "../utils/fs.js";

type DataLakeRunOptions = {
  includeDatabaseMessages?: boolean;
  includeInstagramExports?: boolean;
  instagramRoots?: string[];
  mediaRoots?: string[];
  maxMediaFiles?: number;
  maxEnrichmentItems?: number;
  sourceScope?: string;
};

type DataLakeProviderStatus = {
  mode: "auto" | "openai" | "local";
  openAiAvailable: boolean;
  localWhisperAvailable: boolean;
  localOllamaAvailable: boolean;
  audioProvider: "openai" | "local-whisper" | "none";
  imageProvider: "openai" | "local-ollama" | "none";
};

type RankedTerm = {
  term: string;
  count: number;
};

type IntentSignal = {
  key: string;
  label: string;
  count: number;
  sample: string | null;
};

const SUPPORTED_AUDIO_EXTENSIONS = new Set([".aac", ".m4a", ".mp3", ".wav", ".ogg", ".oga", ".opus", ".mp4", ".mpeg", ".webm"]);
const SUPPORTED_IMAGE_EXTENSIONS = new Set([".jpg", ".jpeg", ".png", ".webp", ".heic"]);
const SUPPORTED_VIDEO_EXTENSIONS = new Set([".mp4", ".mov", ".m4v", ".webm"]);
const PORTUGUESE_STOPWORDS = new Set([
  "a",
  "agora",
  "ai",
  "ainda",
  "alguem",
  "algum",
  "alguma",
  "algumas",
  "alguns",
  "ali",
  "ao",
  "aos",
  "apos",
  "aquela",
  "aquelas",
  "aquele",
  "aqueles",
  "aquilo",
  "as",
  "ate",
  "bom",
  "cada",
  "com",
  "como",
  "contra",
  "da",
  "das",
  "de",
  "dela",
  "dele",
  "deles",
  "demais",
  "depois",
  "desse",
  "dessa",
  "desse",
  "deste",
  "do",
  "dos",
  "e",
  "ela",
  "elas",
  "ele",
  "eles",
  "em",
  "entre",
  "era",
  "essa",
  "essas",
  "esse",
  "esses",
  "esta",
  "estao",
  "estar",
  "este",
  "eu",
  "foi",
  "foram",
  "ha",
  "isso",
  "isto",
  "ja",
  "la",
  "lhe",
  "mais",
  "mas",
  "me",
  "mesmo",
  "meu",
  "meus",
  "minha",
  "muito",
  "na",
  "nao",
  "nas",
  "nem",
  "no",
  "nos",
  "nossa",
  "nosso",
  "num",
  "numa",
  "o",
  "oi",
  "ola",
  "olá",
  "os",
  "ou",
  "para",
  "pela",
  "pelas",
  "pelo",
  "pelos",
  "por",
  "pra",
  "pro",
  "q",
  "que",
  "quem",
  "se",
  "sem",
  "ser",
  "seu",
  "seus",
  "sua",
  "suas",
  "ta",
  "tambem",
  "também",
  "te",
  "tem",
  "tenho",
  "tipo",
  "to",
  "tô",
  "tu",
  "um",
  "uma",
  "umas",
  "uns",
  "vai",
  "vc",
  "vcs",
  "voce",
  "voces",
  "vocês"
]);

const TREND_SIGNAL_RULES: Array<{ key: string; label: string; pattern: RegExp }> = [
  { key: "agendamento", label: "Agendamento", pattern: /\b(agenda|agendar|agendamento|horario|horário|marcar|disponibilidade)\b/i },
  { key: "preco", label: "Preço", pattern: /\b(valor|preco|preço|custa|orcamento|orçamento|desconto)\b/i },
  { key: "procedimento", label: "Procedimentos", pattern: /\b(botox|peeling|melasma|laser|limpeza|procedimento|tratamento|toxina|bioestimulador)\b/i },
  { key: "resultado", label: "Resultados", pattern: /\b(resultado|antes e depois|melhorou|recuperacao|recuperação|duracao|duração)\b/i },
  { key: "duvida", label: "Dúvidas", pattern: /\b(duvida|dúvida|como funciona|posso|pode|explica|explicar)\b/i },
  { key: "pos_venda", label: "Pós-atendimento", pattern: /\b(retorno|pos|pós|revisao|revisão|manutencao|manutenção)\b/i }
];

function nowIso() {
  return new Date().toISOString();
}

function hashString(input: string) {
  return createHash("sha1").update(input).digest("hex").slice(0, 12);
}

function hashFile(filePath: string) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function normalizeSourcePaths(paths: string[]) {
  return [...new Set(paths.map((entry) => path.resolve(entry)).filter((entry) => existsSync(entry)))];
}

function sourceIdForRoot(sourceType: string, rootPath: string) {
  return `data-lake-source:${sourceType}:${hashString(rootPath)}`;
}

function defaultInstagramRoots() {
  return normalizeSourcePaths([path.join(homedir(), "Downloads")]);
}

function defaultMediaRoots() {
  return normalizeSourcePaths([path.join(homedir(), "Downloads", "Nuoma"), path.join(homedir(), "Downloads", "media")]);
}

function ensureDataLakeSource(sourceType: string, rootPath: string, label: string) {
  return upsertDataLakeSource({
    id: sourceIdForRoot(sourceType, rootPath),
    sourceType,
    label,
    rootPath,
    status: "active",
    config: {}
  });
}

function walkFiles(rootPath: string, collector: string[] = []) {
  if (!existsSync(rootPath)) {
    return collector;
  }

  const stats = statSync(rootPath);
  if (stats.isFile()) {
    collector.push(rootPath);
    return collector;
  }

  for (const entry of readdirSync(rootPath, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) {
      continue;
    }

    const fullPath = path.join(rootPath, entry.name);
    if (entry.isDirectory()) {
      walkFiles(fullPath, collector);
      continue;
    }

    if (entry.isFile()) {
      collector.push(fullPath);
    }
  }

  return collector;
}

function normalizeAnalysisText(input?: string | null) {
  return String(input ?? "")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("pt-BR");
}

function tokenizeText(input?: string | null) {
  return normalizeAnalysisText(input)
    .split(/[^a-z0-9@]+/g)
    .map((token) => token.trim())
    .filter((token) => token.length >= 3 && !PORTUGUESE_STOPWORDS.has(token) && !/^\d+$/.test(token));
}

function takeTopTerms(counts: Map<string, number>, limit: number) {
  return [...counts.entries()]
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0], "pt-BR"))
    .slice(0, limit)
    .map(([term, count]) => ({ term, count }));
}

function collectSearchText(asset: DataLakeAssetRecord) {
  return [asset.textContent, asset.transcriptText, asset.summaryText].filter(Boolean).join(" ").trim();
}

function guessMimeType(filePath: string) {
  const extension = path.extname(filePath).toLocaleLowerCase("en-US");
  const imageMimeMap: Record<string, string> = {
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".webp": "image/webp",
    ".heic": "image/heic"
  };
  const audioMimeMap: Record<string, string> = {
    ".aac": "audio/aac",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".wav": "audio/wav",
    ".ogg": "audio/ogg",
    ".oga": "audio/ogg",
    ".opus": "audio/ogg",
    ".webm": "audio/webm",
    ".mpeg": "audio/mpeg",
    ".mp4": "audio/mp4"
  };
  const videoMimeMap: Record<string, string> = {
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".m4v": "video/x-m4v",
    ".webm": "video/webm"
  };

  return imageMimeMap[extension] ?? audioMimeMap[extension] ?? videoMimeMap[extension] ?? "application/octet-stream";
}

function guessAssetKind(filePath: string) {
  const extension = path.extname(filePath).toLocaleLowerCase("en-US");
  if (SUPPORTED_AUDIO_EXTENSIONS.has(extension)) {
    return "audio";
  }
  if (SUPPORTED_IMAGE_EXTENSIONS.has(extension)) {
    return "image";
  }
  if (SUPPORTED_VIDEO_EXTENSIONS.has(extension)) {
    return "video";
  }
  return "file";
}

function copyIntoDataLake(rawRoot: string, sourcePath: string, sha256: string) {
  const extension = path.extname(sourcePath).toLocaleLowerCase("en-US");
  const shardDir = path.join(rawRoot, sha256.slice(0, 2));
  ensureDir(shardDir);
  const destinationPath = path.join(shardDir, `${sha256}${extension}`);
  if (!existsSync(destinationPath)) {
    copyFileSync(sourcePath, destinationPath);
  }
  return destinationPath;
}

function parseJson<T>(input: string | null | undefined, fallback: T) {
  if (!input) {
    return fallback;
  }

  try {
    return JSON.parse(input) as T;
  } catch {
    return fallback;
  }
}

function extractResponseText(payload: any): string {
  if (typeof payload?.output_text === "string" && payload.output_text.trim()) {
    return payload.output_text.trim();
  }

  if (!Array.isArray(payload?.output)) {
    return "";
  }

  const fragments: string[] = [];
  for (const item of payload.output) {
    const contents = Array.isArray(item?.content) ? item.content : [];
    for (const content of contents) {
      if (typeof content?.text === "string" && content.text.trim()) {
        fragments.push(content.text.trim());
      }
    }
  }

  return fragments.join("\n").trim();
}

async function buildOpenAiError(response: Response, label: string) {
  const fallback = `${label} failed with status ${response.status}`;

  try {
    const payload = (await response.json()) as { error?: { message?: string } };
    const message = String(payload?.error?.message ?? "").trim();
    return message ? `${fallback}: ${message}` : fallback;
  } catch {
    return fallback;
  }
}

function inferMediaStatus(assetKind: string) {
  if (assetKind === "audio" || assetKind === "image" || assetKind === "video") {
    return "pending_ai";
  }

  return "ready";
}

function commandExists(command: string) {
  try {
    execFileSync("which", [command], {
      stdio: ["ignore", "pipe", "ignore"]
    });
    return true;
  } catch {
    return false;
  }
}

export function getDataLakeProviderStatus(): DataLakeProviderStatus {
  const env = loadEnv();
  const openAiAvailable = Boolean(env.OPENAI_API_KEY);
  const localWhisperAvailable = existsSync(env.WHISPER_MODEL_PATH) && commandExists(env.WHISPER_BIN);
  const localOllamaAvailable = commandExists("ollama");

  let audioProvider: DataLakeProviderStatus["audioProvider"] = "none";
  let imageProvider: DataLakeProviderStatus["imageProvider"] = "none";

  if (env.AI_PROVIDER === "local") {
    audioProvider = localWhisperAvailable ? "local-whisper" : "none";
    imageProvider = localOllamaAvailable ? "local-ollama" : "none";
  } else if (env.AI_PROVIDER === "openai") {
    audioProvider = openAiAvailable ? "openai" : "none";
    imageProvider = openAiAvailable ? "openai" : "none";
  } else {
    audioProvider = localWhisperAvailable ? "local-whisper" : openAiAvailable ? "openai" : "none";
    imageProvider = localOllamaAvailable ? "local-ollama" : openAiAvailable ? "openai" : "none";
  }

  return {
    mode: env.AI_PROVIDER,
    openAiAvailable,
    localWhisperAvailable,
    localOllamaAvailable,
    audioProvider,
    imageProvider
  };
}

function buildAudioTranscriptionPath(filePath: string) {
  const extension = path.extname(filePath).toLocaleLowerCase("en-US");
  if ([".wav", ".mp3", ".ogg", ".flac"].includes(extension)) {
    return {
      convertedPath: filePath,
      cleanup: () => undefined
    };
  }

  const tempOutput = path.join(loadEnv().TEMP_DIR, `${hashString(filePath)}-${Date.now()}.wav`);
  execFileSync("afconvert", ["-f", "WAVE", "-d", "LEI16@16000", filePath, tempOutput], {
    stdio: ["ignore", "pipe", "pipe"]
  });
  return {
    convertedPath: tempOutput,
    cleanup: () => {
      rmSync(tempOutput, { force: true });
    }
  };
}

async function transcribeAudioWithOpenAi(asset: DataLakeAssetRecord) {
  const env = loadEnv();
  if (!env.OPENAI_API_KEY || !asset.storagePath) {
    return null;
  }

  const { convertedPath, cleanup } = buildAudioTranscriptionPath(asset.storagePath);
  try {
    const fileBuffer = readFileSync(convertedPath);
    const form = new FormData();
    form.append("model", env.OPENAI_TRANSCRIPTION_MODEL);
    form.append("file", new globalThis.Blob([fileBuffer], { type: guessMimeType(convertedPath) }), path.basename(convertedPath));

    const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.OPENAI_API_KEY}`
      },
      body: form
    });

    if (!response.ok) {
      throw new Error(await buildOpenAiError(response, "OpenAI transcription"));
    }

    const payload = (await response.json()) as { text?: string };
    return typeof payload.text === "string" ? payload.text.trim() : "";
  } finally {
    cleanup();
  }
}

async function transcribeAudioLocally(asset: DataLakeAssetRecord) {
  const env = loadEnv();
  if (!asset.storagePath) {
    return null;
  }

  const { convertedPath, cleanup } = buildAudioTranscriptionPath(asset.storagePath);
  try {
    const output = execFileSync(
      env.WHISPER_BIN,
      ["-m", env.WHISPER_MODEL_PATH, "-l", "pt", "-nt", "-np", "-f", convertedPath],
      {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        maxBuffer: 1024 * 1024 * 32
      }
    );

    return output.replace(/\s+/g, " ").trim();
  } finally {
    cleanup();
  }
}

async function describeImageWithOpenAi(asset: DataLakeAssetRecord) {
  const env = loadEnv();
  if (!env.OPENAI_API_KEY || !asset.storagePath) {
    return null;
  }

  const fileBuffer = readFileSync(asset.storagePath);
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.OPENAI_API_KEY}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OPENAI_VISION_MODEL,
      input: [
        {
          role: "user",
          content: [
            {
              type: "input_text",
              text: "Descreva a imagem em portugues, destacando contexto comercial, objetos, pessoas e possiveis temas de conversa."
            },
            {
              type: "input_image",
              image_url: `data:${asset.mimeType ?? "image/jpeg"};base64,${fileBuffer.toString("base64")}`
            }
          ]
        }
      ]
    })
  });

  if (!response.ok) {
    throw new Error(await buildOpenAiError(response, "OpenAI vision"));
  }

  return extractResponseText(await response.json());
}

async function describeImageWithOllama(asset: DataLakeAssetRecord) {
  const env = loadEnv();
  if (!asset.storagePath) {
    return null;
  }

  const fileBuffer = readFileSync(asset.storagePath);
  const response = await fetch(`${env.OLLAMA_HOST.replace(/\/$/, "")}/api/generate`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: env.OLLAMA_VISION_MODEL,
      prompt: "Descreva a imagem em português, destacando contexto comercial, objetos, pessoas, resultado visual e possíveis temas de conversa.",
      stream: false,
      images: [fileBuffer.toString("base64")]
    })
  });

  if (!response.ok) {
    throw new Error(await buildOpenAiError(response, "Ollama vision"));
  }

  const payload = (await response.json()) as { response?: string };
  return String(payload.response ?? "").replace(/\s+/g, " ").trim();
}

function touchSourceScan(sourceType: string, rootPath: string, label: string) {
  return upsertDataLakeSource({
    id: sourceIdForRoot(sourceType, rootPath),
    sourceType,
    label,
    rootPath,
    status: "active",
    lastScanAt: nowIso(),
    config: {}
  });
}

export function ingestConversationMessagesFromDatabase() {
  const db = getDb();
  const source = ensureDataLakeSource("database-conversations", loadEnv().DATABASE_PATH, "SQLite conversations");
  const rows = db
    .prepare(
      `
        SELECT
          m.id,
          m.conversation_id,
          m.contact_id,
          m.channel,
          m.external_id,
          m.direction,
          m.content_type,
          m.body,
          m.sent_at,
          m.created_at,
          m.meta_json,
          conv.title,
          conv.external_thread_id,
          conv.metadata_json AS conversation_meta_json
        FROM messages m
        INNER JOIN conversations conv ON conv.id = m.conversation_id
        ORDER BY datetime(COALESCE(m.sent_at, m.created_at)) DESC
      `
    )
    .all() as Array<Record<string, unknown>>;

  let indexed = 0;
  for (const row of rows) {
    upsertDataLakeAsset({
      sourceId: source?.id ?? null,
      originKey: `db-message:${row.id}`,
      sourceType: "database-conversations",
      assetKind: "conversation_message",
      channel: (row.channel as string | null) ?? null,
      externalId: (row.external_id as string | null) ?? String(row.id),
      contactId: (row.contact_id as string | null) ?? null,
      title: String(row.title ?? ""),
      textContent: String(row.body ?? ""),
      capturedAt: (row.sent_at as string | null) ?? (row.created_at as string | null) ?? null,
      enrichmentStatus: "ready",
      metadata: {
        conversationId: row.conversation_id,
        externalThreadId: row.external_thread_id,
        direction: row.direction,
        contentType: row.content_type,
        messageMeta: parseJson<Record<string, unknown>>(row.meta_json as string | null, {}),
        conversationMeta: parseJson<Record<string, unknown>>(row.conversation_meta_json as string | null, {})
      }
    });
    indexed += 1;
  }

  touchSourceScan("database-conversations", loadEnv().DATABASE_PATH, "SQLite conversations");
  return {
    indexed
  };
}

export function ingestInstagramArchiveToDataLake(zipPath: string) {
  const resolvedZipPath = path.resolve(zipPath);
  const source = ensureDataLakeSource("instagram-export", path.dirname(resolvedZipPath), "Instagram exports");
  const snapshot = extractInstagramConversationSnapshots(resolvedZipPath);
  let indexedMessages = 0;
  let indexedThreads = 0;

  for (const thread of snapshot.threads) {
    indexedThreads += 1;
    thread.messages.forEach((message, messageIndex) => {
      const capturedAt = message.timestampMs ? new Date(message.timestampMs).toISOString() : null;
      upsertDataLakeAsset({
        sourceId: source?.id ?? null,
        originKey: `ig-export:${resolvedZipPath}:${thread.threadKey}:${messageIndex}:${message.timestampMs ?? "na"}`,
        sourceType: "instagram-export",
        assetKind: "conversation_message",
        channel: "instagram",
        externalId: `${thread.threadKey}:${messageIndex}`,
        contactId: null,
        title: thread.title || thread.instagramHandle || thread.threadDirName,
        textContent: message.content,
        capturedAt,
        enrichmentStatus: "ready",
        metadata: {
          archivePath: resolvedZipPath,
          instagramHandle: thread.instagramHandle,
          participants: thread.participants,
          senderName: message.senderName,
          direction: message.direction
        }
      });
      indexedMessages += 1;
    });
  }

  touchSourceScan("instagram-export", path.dirname(resolvedZipPath), "Instagram exports");
  return {
    zipPath: resolvedZipPath,
    threads: snapshot.threads.length,
    indexedThreads,
    indexedMessages,
    ownAliases: snapshot.ownAliases
  };
}

export function ingestLocalMediaRoots(inputRoots?: string[], maxFiles = 400) {
  const env = loadEnv();
  const roots = normalizeSourcePaths(inputRoots?.length ? inputRoots : defaultMediaRoots());
  const rawRoot = path.join(env.DATA_LAKE_DIR, "raw");
  ensureDir(rawRoot);

  let scannedFiles = 0;
  let indexedFiles = 0;
  let pendingAiAssets = 0;

  for (const rootPath of roots) {
    const source = ensureDataLakeSource("local-media", rootPath, "Local media roots");
    const files = walkFiles(rootPath).slice(0, Math.max(1, maxFiles));

    for (const filePath of files) {
      const assetKind = guessAssetKind(filePath);
      if (assetKind === "file") {
        continue;
      }

      const stats = statSync(filePath);
      const sha256 = hashFile(filePath);
      const storagePath = copyIntoDataLake(rawRoot, filePath, sha256);
      const enrichmentStatus = inferMediaStatus(assetKind);
      upsertDataLakeAsset({
        sourceId: source?.id ?? null,
        originKey: `local-media:${filePath}:${stats.mtimeMs}:${stats.size}`,
        sourceType: "local-media",
        assetKind,
        title: path.basename(filePath),
        textContent: "",
        mimeType: guessMimeType(filePath),
        sizeBytes: stats.size,
        sha256,
        originalPath: filePath,
        storagePath,
        enrichmentStatus,
        capturedAt: new Date(stats.mtimeMs).toISOString(),
        metadata: {
          sourceRoot: rootPath
        }
      });
      scannedFiles += 1;
      indexedFiles += 1;
      if (enrichmentStatus === "pending_ai") {
        pendingAiAssets += 1;
      }
    }

    touchSourceScan("local-media", rootPath, "Local media roots");
  }

  return {
    roots,
    scannedFiles,
    indexedFiles,
    pendingAiAssets
  };
}

export async function enrichPendingDataLakeAssets(maxItems = 24) {
  const env = loadEnv();
  const providerStatus = getDataLakeProviderStatus();
  const assets = listDataLakeAssets({
    assetKinds: ["audio", "image", "video"],
    enrichmentStatuses: ["pending_ai", "failed"],
    limit: Math.max(1, Math.min(200, maxItems))
  });

  if (providerStatus.audioProvider === "none" && providerStatus.imageProvider === "none") {
    return {
      provider: "none",
      processed: 0,
      transcriptsCompleted: 0,
      imagesDescribed: 0,
      failed: 0,
      pendingProvider: assets.length
    };
  }

  let processed = 0;
  let transcriptsCompleted = 0;
  let imagesDescribed = 0;
  let failed = 0;
  let pendingProvider = 0;

  for (const asset of assets) {
    try {
      if (asset.assetKind === "audio") {
        if (providerStatus.audioProvider === "none") {
          pendingProvider += 1;
          continue;
        }

        const transcriptText =
          providerStatus.audioProvider === "local-whisper" ? await transcribeAudioLocally(asset) : await transcribeAudioWithOpenAi(asset);
        if (transcriptText) {
          upsertDataLakeAsset({
            originKey: asset.originKey,
            sourceType: asset.sourceType,
            assetKind: asset.assetKind,
            sourceId: asset.sourceId,
            title: asset.title,
            textContent: asset.textContent,
            transcriptText,
            summaryText: asset.summaryText,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            sha256: asset.sha256,
            originalPath: asset.originalPath,
            storagePath: asset.storagePath,
            enrichmentStatus: "completed",
            enrichmentModel: providerStatus.audioProvider === "local-whisper" ? `whisper.cpp:${path.basename(env.WHISPER_MODEL_PATH)}` : env.OPENAI_TRANSCRIPTION_MODEL,
            enrichmentError: null,
            capturedAt: asset.capturedAt,
            metadata: asset.metadata
          });
          transcriptsCompleted += 1;
        }
        processed += 1;
        continue;
      }

      if (asset.assetKind === "image") {
        if (providerStatus.imageProvider === "none") {
          pendingProvider += 1;
          continue;
        }

        const summaryText = providerStatus.imageProvider === "local-ollama" ? await describeImageWithOllama(asset) : await describeImageWithOpenAi(asset);
        if (summaryText) {
          upsertDataLakeAsset({
            originKey: asset.originKey,
            sourceType: asset.sourceType,
            assetKind: asset.assetKind,
            sourceId: asset.sourceId,
            title: asset.title,
            textContent: asset.textContent,
            transcriptText: asset.transcriptText,
            summaryText,
            mimeType: asset.mimeType,
            sizeBytes: asset.sizeBytes,
            sha256: asset.sha256,
            originalPath: asset.originalPath,
            storagePath: asset.storagePath,
            enrichmentStatus: "completed",
            enrichmentModel: providerStatus.imageProvider === "local-ollama" ? env.OLLAMA_VISION_MODEL : env.OPENAI_VISION_MODEL,
            enrichmentError: null,
            capturedAt: asset.capturedAt,
            metadata: asset.metadata
          });
          imagesDescribed += 1;
        }
        processed += 1;
        continue;
      }

      pendingProvider += 1;
    } catch (error) {
      processed += 1;
      upsertDataLakeAsset({
        originKey: asset.originKey,
        sourceType: asset.sourceType,
        assetKind: asset.assetKind,
        sourceId: asset.sourceId,
        title: asset.title,
        textContent: asset.textContent,
        transcriptText: asset.transcriptText,
        summaryText: asset.summaryText,
        mimeType: asset.mimeType,
        sizeBytes: asset.sizeBytes,
        sha256: asset.sha256,
        originalPath: asset.originalPath,
        storagePath: asset.storagePath,
        enrichmentStatus: "failed",
        enrichmentModel: asset.enrichmentModel,
        enrichmentError: error instanceof Error ? error.message : String(error),
        capturedAt: asset.capturedAt,
        metadata: asset.metadata
      });
      failed += 1;
    }
  }

  return {
    provider: providerStatus.audioProvider === "local-whisper" ? "local-whisper" : providerStatus.imageProvider === "openai" ? "openai" : "mixed",
    processed,
    transcriptsCompleted,
    imagesDescribed,
    failed,
    pendingProvider
  };
}

export function buildDataLakeTrendReport(sourceScope = "default") {
  const corpus = listDataLakeTextCorpus(5000);
  const keywordCounts = new Map<string, number>();
  const bigramCounts = new Map<string, number>();
  const senderCounts = new Map<string, number>();
  const threadCounts = new Map<string, number>();
  const timelineCounts = new Map<string, number>();
  const intentSignals = new Map<string, IntentSignal>();

  for (const asset of corpus) {
    const searchText = collectSearchText(asset);
    if (!searchText) {
      continue;
    }

    const normalizedText = normalizeAnalysisText(searchText);
    const tokens = tokenizeText(searchText);
    tokens.forEach((token) => {
      keywordCounts.set(token, (keywordCounts.get(token) ?? 0) + 1);
    });

    for (let index = 0; index < tokens.length - 1; index += 1) {
      const pair = `${tokens[index]} ${tokens[index + 1]}`;
      bigramCounts.set(pair, (bigramCounts.get(pair) ?? 0) + 1);
    }

    const senderName = String(asset.metadata.senderName ?? "").trim();
    if (senderName) {
      senderCounts.set(senderName, (senderCounts.get(senderName) ?? 0) + 1);
    }

    const threadTitle = asset.title.trim();
    if (threadTitle) {
      threadCounts.set(threadTitle, (threadCounts.get(threadTitle) ?? 0) + 1);
    }

    const bucketDate = String((asset.capturedAt ?? asset.updatedAt).slice(0, 10));
    timelineCounts.set(bucketDate, (timelineCounts.get(bucketDate) ?? 0) + 1);

    for (const rule of TREND_SIGNAL_RULES) {
      if (!rule.pattern.test(normalizedText)) {
        continue;
      }

      const current = intentSignals.get(rule.key);
      if (current) {
        current.count += 1;
      } else {
        intentSignals.set(rule.key, {
          key: rule.key,
          label: rule.label,
          count: 1,
          sample: searchText.slice(0, 220)
        });
      }
    }
  }

  const topKeywords = takeTopTerms(keywordCounts, 12);
  const topBigrams = takeTopTerms(bigramCounts, 8);
  const topSenders = takeTopTerms(senderCounts, 8);
  const topThreads = takeTopTerms(threadCounts, 8);
  const rankedSignals = [...intentSignals.values()].sort((left, right) => right.count - left.count || left.label.localeCompare(right.label, "pt-BR"));
  const timeline = [...timelineCounts.entries()]
    .sort((left, right) => left[0].localeCompare(right[0], "en"))
    .slice(-30)
    .map(([date, count]) => ({ date, count }));

  const leadingKeywords = topKeywords.slice(0, 3).map((item) => item.term);
  const leadingSignal = rankedSignals[0];
  const summaryText =
    corpus.length === 0
      ? "O data lake ainda nao tem registros textuais suficientes para detectar tendencias."
      : `A base tem ${corpus.length} registros textuais indexados. Os termos mais recorrentes são ${leadingKeywords.join(", ") || "sem destaque"}${leadingSignal ? `, com maior concentração em ${leadingSignal.label.toLowerCase()}` : ""}.`;

  return createDataLakeReport({
    sourceScope,
    summaryText,
    topKeywords: topKeywords as Array<Record<string, unknown>>,
    topBigrams: topBigrams as Array<Record<string, unknown>>,
    topSenders: topSenders as Array<Record<string, unknown>>,
    topThreads: topThreads as Array<Record<string, unknown>>,
    intentSignals: rankedSignals as Array<Record<string, unknown>>,
    timeline: timeline as Array<Record<string, unknown>>,
    totals: {
      totalDocuments: corpus.length,
      uniqueThreads: threadCounts.size,
      uniqueSenders: senderCounts.size
    },
    metadata: {
      generatedAt: nowIso()
    }
  });
}

export function getDataLakeOverview() {
  const db = getDb();
  const byKind = db
    .prepare(
      `
        SELECT asset_kind, COUNT(*) AS count
        FROM data_lake_assets
        GROUP BY asset_kind
      `
    )
    .all() as Array<{ asset_kind: string; count: number }>;
  const byStatus = db
    .prepare(
      `
        SELECT enrichment_status, COUNT(*) AS count
        FROM data_lake_assets
        GROUP BY enrichment_status
      `
    )
    .all() as Array<{ enrichment_status: string; count: number }>;

  return {
    countsByKind: Object.fromEntries(byKind.map((item) => [item.asset_kind, Number(item.count)])),
    countsByStatus: Object.fromEntries(byStatus.map((item) => [item.enrichment_status, Number(item.count)])),
    sources: listDataLakeSources(),
    latestReport: getLatestDataLakeReport(),
    recentAssets: listDataLakeAssets({ limit: 16 }),
    pendingAssets: listDataLakeAssets({
      enrichmentStatuses: ["pending_ai", "failed"],
      limit: 16
    })
  };
}

export async function runDataLakePipeline(options?: DataLakeRunOptions) {
  const startedAt = nowIso();
  const includeDatabaseMessages = options?.includeDatabaseMessages ?? true;
  const includeInstagramExports = options?.includeInstagramExports ?? true;
  const instagramRoots = normalizeSourcePaths(options?.instagramRoots?.length ? options.instagramRoots : defaultInstagramRoots());
  const mediaRoots = normalizeSourcePaths(options?.mediaRoots?.length ? options.mediaRoots : defaultMediaRoots());

  const databaseSummary = includeDatabaseMessages ? ingestConversationMessagesFromDatabase() : { indexed: 0 };
  let instagramArchiveThreads = 0;
  let instagramArchiveMessages = 0;
  const scannedArchives: string[] = [];

  if (includeInstagramExports) {
    for (const rootPath of instagramRoots) {
      const archives = listInstagramExportFiles(rootPath);
      for (const archivePath of archives) {
        const result = ingestInstagramArchiveToDataLake(archivePath);
        if (result.indexedMessages > 0) {
          instagramArchiveThreads += result.indexedThreads;
          instagramArchiveMessages += result.indexedMessages;
          scannedArchives.push(result.zipPath);
        }
      }
      touchSourceScan("instagram-export", rootPath, "Instagram exports");
    }
  }

  const mediaSummary = ingestLocalMediaRoots(mediaRoots, options?.maxMediaFiles ?? 400);
  const enrichmentSummary = await enrichPendingDataLakeAssets(options?.maxEnrichmentItems ?? 24);
  const report = buildDataLakeTrendReport(options?.sourceScope ?? "default");

  const summary = {
    startedAt,
    finishedAt: nowIso(),
    databaseMessagesIndexed: databaseSummary.indexed,
    instagramArchiveThreads,
    instagramArchiveMessages,
    scannedArchives,
    mediaFilesIndexed: mediaSummary.indexedFiles,
    pendingAiAssets: mediaSummary.pendingAiAssets,
    enrichmentSummary,
    reportId: report?.id ?? null,
    sourceRoots: {
      instagramRoots,
      mediaRoots
    }
  };

  recordSystemEvent("data-lake", "info", "Data lake atualizado com sucesso", summary);
  return {
    summary,
    overview: getDataLakeOverview()
  };
}
