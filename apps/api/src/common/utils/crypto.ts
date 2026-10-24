import { createHash, randomBytes } from 'node:crypto';

/** Jeton opaque aléatoire (256 bits) encodé en base64url. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

/** Référence de commande lisible, non devinable : SM-XXXXXXXX. */
export function orderReference(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = randomBytes(8);
  let out = '';
  for (const b of bytes) out += alphabet[b % alphabet.length];
  return `SM-${out}`;
}
