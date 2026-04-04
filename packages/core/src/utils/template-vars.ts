import type { ContactRecord } from "../types/domain.js";

const VAR_PATTERN = /\{\{(\w+)\}\}/g;

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
    const resolver = CONTACT_VAR_MAP[varName.toLowerCase()];
    if (resolver) {
      const value = resolver(contact);
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
    { name: "nome", description: "Nome completo do contato" },
    { name: "primeiro_nome", description: "Primeiro nome do contato" },
    { name: "telefone", description: "Telefone do contato" },
    { name: "email", description: "Email do contato" },
    { name: "instagram", description: "Instagram do contato" },
    { name: "procedimento", description: "Status do procedimento (Sim/Não/Indefinido)" },
    { name: "status", description: "Status do contato" }
  ];
}
