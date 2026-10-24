/** Formate un montant en centimes au format français : 1234 -> "12,34 €". */
export function formatCents(cents: number, currency = 'EUR'): string {
  if (!Number.isInteger(cents)) throw new Error('Le montant doit être un entier en centimes');
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const euros = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '\u202f');
  const rest = (abs % 100).toString().padStart(2, '0');
  const symbol = currency === 'EUR' ? '€' : currency;
  return `${negative ? '-' : ''}${euros},${rest}\u00a0${symbol}`;
}

/**
 * Convertit une saisie utilisateur ("12,5", "12.50", "12") en centimes.
 * Retourne null si la saisie est invalide. N'utilise pas de flottants.
 */
export function parseEurosToCents(input: string): number | null {
  const trimmed = input
    .trim()
    .replace(/\s|\u202f|€/g, '')
    .replace(',', '.');
  const match = /^(\d{1,7})(?:\.(\d{1,2}))?$/.exec(trimmed);
  if (!match) return null;
  const euros = parseInt(match[1]!, 10);
  const decimals = (match[2] ?? '').padEnd(2, '0');
  return euros * 100 + parseInt(decimals, 10);
}
