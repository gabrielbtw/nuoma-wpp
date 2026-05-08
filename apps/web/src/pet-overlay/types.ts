export const OCTO_VISUAL_STATES = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
] as const;

export type OctoVisualState = (typeof OCTO_VISUAL_STATES)[number];

export const OCTO_EVENTS = [
  "campaign_created",
  "campaign_sending",
  "campaign_sent",
  "campaign_failed",
  "contacts_sync_started",
  "contacts_sync_completed",
  "flow_created",
  "flow_running",
  "flow_paused",
  "appointment_created",
  "appointment_waiting",
  "quick_reply_created",
  "template_reviewing",
  "lead_needs_attention",
  "api_connection_lost",
  "api_connection_restored",
] as const;

export type OctoEvent = (typeof OCTO_EVENTS)[number];

export const OCTO_EVENT_NAME = "nuoma:octo-event";

export interface OctoEventDetail {
  event: OctoEvent;
}

export const OCTO_EVENT_TO_STATE: Record<OctoEvent, OctoVisualState> = {
  campaign_created: "jumping",
  campaign_sending: "running",
  campaign_sent: "jumping",
  campaign_failed: "failed",
  contacts_sync_started: "running",
  contacts_sync_completed: "jumping",
  flow_created: "waving",
  flow_running: "running",
  flow_paused: "waiting",
  appointment_created: "jumping",
  appointment_waiting: "waiting",
  quick_reply_created: "waving",
  template_reviewing: "review",
  lead_needs_attention: "waiting",
  api_connection_lost: "failed",
  api_connection_restored: "jumping",
};

export const OCTO_EVENT_MESSAGES: Record<OctoEvent, string> = {
  campaign_created: "Campanha criada.",
  campaign_sending: "Enviando campanha.",
  campaign_sent: "Campanha enviada.",
  campaign_failed: "Alguns envios falharam.",
  contacts_sync_started: "Sincronizando contatos.",
  contacts_sync_completed: "Contatos atualizados.",
  flow_created: "Fluxo criado.",
  flow_running: "Fluxo em execução.",
  flow_paused: "Fluxo pausado.",
  appointment_created: "Agendamento criado.",
  appointment_waiting: "Aguardando horário.",
  quick_reply_created: "Resposta rápida salva.",
  template_reviewing: "Revisando template.",
  lead_needs_attention: "Lead precisa de atenção.",
  api_connection_lost: "Conexão perdida.",
  api_connection_restored: "Conexão restaurada.",
};

export const OCTO_STATE_LABELS: Record<OctoVisualState, string> = {
  idle: "Pronto",
  "running-right": "Indo para ação",
  "running-left": "Voltando",
  waving: "Chamando atenção",
  jumping: "Concluído",
  failed: "Falha",
  waiting: "Aguardando",
  running: "Trabalhando",
  review: "Revisando",
};

export const OCTO_EVENT_PRIORITY: Record<OctoEvent | "idle", number> = {
  api_connection_lost: 100,
  campaign_failed: 95,
  lead_needs_attention: 80,
  template_reviewing: 70,
  campaign_sending: 60,
  contacts_sync_started: 55,
  flow_running: 50,
  appointment_waiting: 45,
  campaign_created: 35,
  campaign_sent: 35,
  contacts_sync_completed: 35,
  appointment_created: 35,
  api_connection_restored: 35,
  flow_created: 25,
  quick_reply_created: 25,
  flow_paused: 20,
  idle: 10,
};

export const OCTO_STATE_TIMEOUTS: Partial<Record<OctoVisualState, number | null>> = {
  idle: null,
  "running-right": null,
  "running-left": null,
  waving: 1800,
  jumping: 2200,
  failed: 6000,
  waiting: null,
  running: null,
  review: null,
};

export function emitOctoEvent(event: OctoEvent): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<OctoEventDetail>(OCTO_EVENT_NAME, { detail: { event } }));
}
