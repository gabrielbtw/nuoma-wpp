import path from "node:path";
import { loadEnv } from "../config/env.js";
import { getAttendantById } from "../repositories/attendant-repository.js";

export function getAttendantSamplesDir(attendantId: string): string {
  const env = loadEnv();
  return path.join(env.UPLOADS_DIR, "media", "attendant", "samples", attendantId);
}

export function assertAttendantReady(attendantId: string) {
  const attendant = getAttendantById(attendantId);
  if (!attendant) {
    throw new Error(`Atendente ${attendantId} não encontrado.`);
  }
  if (attendant.voiceSamples.length === 0) {
    throw new Error(`Atendente "${attendant.name}" não possui amostras de voz. Envie ao menos uma amostra.`);
  }
  return attendant;
}
