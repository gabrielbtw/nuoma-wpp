import type { AutomationStatus, CampaignStatus } from "@nuoma/contracts";
import type { BadgeVariant } from "@nuoma/ui";

export function campaignStatusLabel(status: CampaignStatus | string): string {
  switch (status) {
    case "draft":
      return "Rascunho";
    case "scheduled":
      return "Agendada";
    case "running":
      return "Em execução";
    case "paused":
      return "Pausada";
    case "completed":
      return "Concluída";
    case "archived":
      return "Arquivada";
    default:
      return status;
  }
}

export function campaignStatusVariant(status: CampaignStatus | string): BadgeVariant {
  switch (status) {
    case "running":
      return "success";
    case "scheduled":
      return "info";
    case "paused":
      return "warning";
    case "completed":
      return "neutral";
    case "archived":
      return "neutral";
    default:
      return "neutral";
  }
}

export function automationStatusLabel(status: AutomationStatus | string): string {
  switch (status) {
    case "draft":
      return "Rascunho";
    case "active":
      return "Ativa";
    case "paused":
      return "Pausada";
    case "archived":
      return "Arquivada";
    default:
      return status;
  }
}

export function automationStatusVariant(status: AutomationStatus | string): BadgeVariant {
  switch (status) {
    case "active":
      return "success";
    case "paused":
      return "warning";
    default:
      return "neutral";
  }
}
