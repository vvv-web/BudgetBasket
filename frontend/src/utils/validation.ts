export const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^\+7 \(\d{3}\) \d{3}-\d{2}-\d{2}$/;

export function lettersOnly(value: string): string {
  return value.replace(/[^\p{L}\s-]/gu, '').replace(/\s{2,}/g, ' ');
}

export function formatPhone(value: string): string {
  let digits = value.replace(/\D/g, '');
  if (digits.startsWith('8')) digits = `7${digits.slice(1)}`;
  if (digits.startsWith('7')) digits = digits.slice(1);
  digits = digits.slice(0, 10);
  if (!digits) return '';
  const groups = [digits.slice(0, 3), digits.slice(3, 6), digits.slice(6, 8), digits.slice(8, 10)];
  let result = `+7 (${groups[0]}`;
  if (digits.length >= 3) result += ')';
  if (groups[1]) result += ` ${groups[1]}`;
  if (groups[2]) result += `-${groups[2]}`;
  if (groups[3]) result += `-${groups[3]}`;
  return result;
}

export function normalizePositiveAmount(value: string): string {
  const normalized = value.replace(',', '.').replace(/[^\d.]/g, '');
  const [integer = '', ...fractionParts] = normalized.split('.');
  const fraction = fractionParts.join('').slice(0, 2);
  const trimmedInteger = integer.replace(/^0+(?=\d)/, '');
  const result = fractionParts.length ? `${trimmedInteger}.${fraction}` : trimmedInteger;
  return Number(result) === 0 ? '' : result;
}
