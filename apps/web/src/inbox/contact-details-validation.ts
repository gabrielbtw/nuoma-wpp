import { normalizePhone } from "@nuoma/contracts";

export interface ContactDetailsDraft {
  name: string;
  phone: string;
  email: string;
  instagramHandle: string;
}

export interface NormalizedContactDetailsDraft {
  name: string;
  phone: string | null;
  email: string | null;
  instagramHandle: string | null;
}

export interface ContactDetailsDraftErrors {
  name?: string;
  phone?: string;
  email?: string;
  instagramHandle?: string;
}

export function validateContactDetailsDraft(input: ContactDetailsDraft): {
  errors: ContactDetailsDraftErrors;
  values: NormalizedContactDetailsDraft;
  valid: boolean;
} {
  const name = input.name.trim();
  const rawPhone = input.phone.trim();
  const phone = rawPhone ? normalizePhone(rawPhone) : null;
  const email = input.email.trim().toLowerCase() || null;
  const instagramHandle = input.instagramHandle.trim().replace(/^@/, "") || null;
  const errors: ContactDetailsDraftErrors = {};

  if (!name) {
    errors.name = "Informe um nome visível para o contato.";
  }
  if (rawPhone && !phone) {
    errors.phone = "Use um WhatsApp com DDD, ex: 31982066263 ou +55 31 9 8206-6263.";
  }
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    errors.email = "Use um email válido ou deixe o campo em branco.";
  }
  if (instagramHandle && !/^[A-Za-z0-9._]{1,30}$/.test(instagramHandle)) {
    errors.instagramHandle = "Use apenas o @handle, sem espaços ou URL.";
  }

  return {
    errors,
    values: {
      name,
      phone,
      email,
      instagramHandle,
    },
    valid: Object.keys(errors).length === 0,
  };
}
