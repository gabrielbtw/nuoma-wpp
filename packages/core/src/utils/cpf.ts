function digitsOnly(input: string) {
  return input.replace(/\D/g, "");
}

export function normalizeCpf(input?: string | null) {
  if (!input) {
    return null;
  }

  const digits = digitsOnly(input);
  return digits.length > 0 ? digits : null;
}

export function isValidCpf(input?: string | null) {
  const digits = normalizeCpf(input);
  if (!digits || digits.length !== 11) {
    return false;
  }

  if (/^(\d)\1{10}$/.test(digits)) {
    return false;
  }

  let sum = 0;
  for (let index = 0; index < 9; index += 1) {
    sum += Number(digits[index]) * (10 - index);
  }

  let remainder = (sum * 10) % 11;
  if (remainder === 10) {
    remainder = 0;
  }

  if (remainder !== Number(digits[9])) {
    return false;
  }

  sum = 0;
  for (let index = 0; index < 10; index += 1) {
    sum += Number(digits[index]) * (11 - index);
  }

  remainder = (sum * 10) % 11;
  if (remainder === 10) {
    remainder = 0;
  }

  return remainder === Number(digits[10]);
}
