type InstagramRelationshipState = {
  instagramFollowsMe: boolean | null;
  instagramFollowedByMe: boolean | null;
};

export type ContactProcedureStatus = "yes" | "no" | "unknown";

export const contactStatusLabelMap: Record<string, string> = {
  novo: "Novo",
  aguardando_resposta: "Aguardando resposta",
  em_atendimento: "Em atendimento",
  cliente: "Cliente",
  sem_retorno: "Sem retorno",
  perdido: "Perdido"
};

export const contactProcedureLabelMap: Record<ContactProcedureStatus, string> = {
  yes: "Sim",
  no: "Não",
  unknown: "Não definido"
};

export function contactStatusTone(status: string): "success" | "warning" | "danger" | "info" | "default" {
  switch (status) {
    case "cliente":
      return "success";
    case "aguardando_resposta":
    case "em_atendimento":
      return "warning";
    case "perdido":
      return "danger";
    default:
      return "default";
  }
}

export function formatInstagramRelationship(input: InstagramRelationshipState) {
  if (input.instagramFollowsMe === true && input.instagramFollowedByMe === true) {
    return "Mútuo";
  }
  if (input.instagramFollowsMe === true) {
    return "Segue você";
  }
  if (input.instagramFollowedByMe === true) {
    return "Você segue";
  }
  if (input.instagramFollowsMe === false && input.instagramFollowedByMe === false) {
    return "Sem vínculo";
  }
  return "Sem leitura";
}
