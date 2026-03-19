import path from "node:path";
import { homedir } from "node:os";
import { basename } from "node:path";
import { recordSystemEvent } from "../repositories/system-repository.js";
import { ingestInstagramArchiveToDataLake } from "../services/data-lake-service.js";
import {
  enrichContactsFromWhatsAppConversations,
  enrichContactsFromWhatsAppMessageBodies,
  importInstagramContacts,
  importWhatsAppCsvContacts,
  listInstagramExportFiles,
  listPendingIncompleteInstagramDownloads,
  loadWhatsAppCsvLookup,
  reconcileInstagramContactNamesWithWhatsAppCsv,
  removeImportedInstagramSource
} from "../services/instagram-contact-import-service.js";

const inputPath = process.argv[2];

if (!inputPath) {
  console.error("Uso: npm run import:instagram --workspace @nuoma/core -- /caminho/para/export-ou-pasta [csv-whatsapp]");
  process.exit(1);
}

const csvPathArg = process.argv[3];
const resolvedInputPath = path.resolve(inputPath);
const fallbackCsvPath = path.join(homedir(), "Downloads", "Contacts CSV Results.csv");
const whatsappLookup = loadWhatsAppCsvLookup(csvPathArg ? path.resolve(csvPathArg) : fallbackCsvPath);
const whatsappCsvImport = importWhatsAppCsvContacts(whatsappLookup);

type ImportedFileSummary = ReturnType<typeof importInstagramContacts> & {
  deletedSource: boolean;
  dataLake?: {
    indexedThreads: number;
    indexedMessages: number;
  } | null;
};

const fileSummaries: ImportedFileSummary[] = [];

while (true) {
  const pendingFiles = listInstagramExportFiles(resolvedInputPath);
  if (pendingFiles.length === 0) {
    break;
  }

  const nextFile = pendingFiles[0];
  const summary = importInstagramContacts(nextFile, {
    whatsappLookup
  });
  const dataLake = ingestInstagramArchiveToDataLake(nextFile);
  removeImportedInstagramSource(nextFile);

  const fileSummary: ImportedFileSummary = {
    ...summary,
    deletedSource: true,
    dataLake: {
      indexedThreads: dataLake.indexedThreads,
      indexedMessages: dataLake.indexedMessages
    }
  };

  fileSummaries.push(fileSummary);
  recordSystemEvent("instagram-import", "info", `Importação concluída para ${basename(nextFile)}`, {
    eventType: "file",
    sourcePath: nextFile,
    deletedSource: true,
    csvPath: whatsappLookup?.csvPath ?? null,
    summary: fileSummary
  });
}

const whatsappConversationEnrichment = enrichContactsFromWhatsAppConversations();
const whatsappMessageEnrichment = enrichContactsFromWhatsAppMessageBodies();
const backfill = reconcileInstagramContactNamesWithWhatsAppCsv(whatsappLookup);
const pendingIncompleteFiles = listPendingIncompleteInstagramDownloads(resolvedInputPath);

const aggregate = fileSummaries.reduce(
  (accumulator, item) => ({
    processedFiles: accumulator.processedFiles + 1,
    created: accumulator.created + Number(item.created ?? 0),
    updated: accumulator.updated + Number(item.updated ?? 0),
    unchanged: accumulator.unchanged + Number(item.unchanged ?? 0),
    processedThreads: accumulator.processedThreads + Number(item.processedThreads ?? 0),
    processedFollowers: accumulator.processedFollowers + Number(item.processedFollowers ?? 0),
    processedFollowing: accumulator.processedFollowing + Number(item.processedFollowing ?? 0),
    skippedNoSupportedData: accumulator.skippedNoSupportedData + Number(item.skippedNoSupportedData ?? 0),
    relationshipSignalsUpdated: accumulator.relationshipSignalsUpdated + Number(item.relationshipSignalsUpdated ?? 0),
    messageSignalsUpdated: accumulator.messageSignalsUpdated + Number(item.messageSignalsUpdated ?? 0),
    phonesDiscovered: accumulator.phonesDiscovered + Number(item.phonesDiscovered ?? 0),
    whatsappCsvMatches: accumulator.whatsappCsvMatches + Number(item.whatsappCsvMatches ?? 0),
    whatsappCsvNamesApplied: accumulator.whatsappCsvNamesApplied + Number(item.whatsappCsvNamesApplied ?? 0),
    namesFromPhones: accumulator.namesFromPhones + Number(item.namesFromPhones ?? 0),
    deletedSources: accumulator.deletedSources + Number(Boolean(item.deletedSource))
  }),
  {
    processedFiles: 0,
    created: 0,
    updated: 0,
    unchanged: 0,
    processedThreads: 0,
    processedFollowers: 0,
    processedFollowing: 0,
    skippedNoSupportedData: 0,
    relationshipSignalsUpdated: 0,
    messageSignalsUpdated: 0,
    phonesDiscovered: 0,
    whatsappCsvMatches: 0,
    whatsappCsvNamesApplied: 0,
    namesFromPhones: 0,
    deletedSources: 0
  }
);

const batchMessage =
  whatsappCsvImport && (whatsappCsvImport.created > 0 || whatsappCsvImport.updated > 0 || aggregate.processedFiles === 0)
    ? `Lote de importação finalizado com ${aggregate.processedFiles} arquivo(s) e CSV de WhatsApp`
    : `Lote de importação finalizado com ${aggregate.processedFiles} arquivo(s)`;

recordSystemEvent(
  "instagram-import",
  pendingIncompleteFiles.length > 0 ? "warn" : "info",
  batchMessage,
  {
    eventType: "batch",
    targetPath: resolvedInputPath,
    csvPath: whatsappLookup?.csvPath ?? null,
    aggregate,
    whatsappCsvImport,
    whatsappConversationEnrichment,
    whatsappMessageEnrichment,
    backfill,
    pendingIncompleteFiles
  }
);

console.log(
  JSON.stringify(
    {
      targetPath: resolvedInputPath,
      csvPath: whatsappLookup?.csvPath ?? null,
      pendingIncompleteFiles,
      whatsappCsvImport,
      whatsappConversationEnrichment,
      whatsappMessageEnrichment,
      backfill,
      ...aggregate,
      fileSummaries
    },
    null,
    2
  )
);
