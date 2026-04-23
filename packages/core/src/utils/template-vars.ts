import type { ContactRecord } from "../types/domain.js";

const VAR_PATTERN = /\{\{(\w+)\}\}/g;

const GLOBAL_VAR_MAP: Record<string, () => string> = {
  saudacao: () => {
    const h = Number(new Date().toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", hour: "numeric", hour12: false }));
    if (h < 12) return "Bom dia";
    if (h < 18) return "Boa tarde";
    return "Boa noite";
  }
};

const CONTACT_VAR_MAP: Record<string, (contact: ContactRecord) => string> = {
  nome: (c) => c.name || "",
  telefone: (c) => (c.phone ?? "").trim(),
  email: (c) => (c.email ?? "").trim(),
  instagram: (c) => (c.instagram ?? "").trim(),
  procedimento: (c) => {
    const labels: Record<string, string> = { yes: "Sim", no: "Não", unknown: "Indefinido" };
    return labels[c.procedureStatus] ?? c.procedureStatus;
  },
  status: (c) => c.status,
  primeiro_nome: (c) => (c.name || "").split(" ")[0] || ""
};

/**
 * Substitui variaveis {{nome}}, {{telefone}}, etc. no texto usando dados do contato.
 * Variaveis desconhecidas sao mantidas como estao.
 */
export function resolveTemplateVars(text: string, contact: ContactRecord): string {
  return text.replace(VAR_PATTERN, (match, varName: string) => {
    const key = varName.toLowerCase();

    // Check global vars first (time-based, etc.)
    const globalResolver = GLOBAL_VAR_MAP[key];
    if (globalResolver) {
      return globalResolver();
    }

    // Then check contact-specific vars
    const contactResolver = CONTACT_VAR_MAP[key];
    if (contactResolver) {
      const value = contactResolver(contact);
      return value || match; // se vazio, mantem a variavel
    }
    return match;
  });
}

/**
 * Extrai as variaveis usadas em um texto.
 */
export function extractTemplateVars(text: string): string[] {
  const vars: string[] = [];
  let match;
  while ((match = VAR_PATTERN.exec(text)) !== null) {
    if (!vars.includes(match[1])) {
      vars.push(match[1]);
    }
  }
  return vars;
}

/**
 * Lista todas as variaveis disponiveis com descricao.
 */
export function listAvailableVars(): Array<{ name: string; description: string }> {
  return [
    { name: "saudacao", description: "Saudação por horário (Bom dia/Boa tarde/Boa noite)" },
    { name: "nome", description: "Nome completo do contato" },
    { name: "primeiro_nome", description: "Primeiro nome do contato" },
    { name: "telefone", description: "Telefone do contato" },
    { name: "email", description: "Email do contato" },
    { name: "instagram", description: "Instagram do contato" },
    { name: "procedimento", description: "Status do procedimento (Sim/Não/Indefinido)" },
    { name: "status", description: "Status do contato" }
  ];
}
