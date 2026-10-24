import { BadRequestException } from '@nestjs/common';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from '@snapmarket/shared';

export interface CursorPayload {
  /** Valeur de la clé de tri (date ISO ou nombre). */
  v: string | number;
  id: string;
}

export function encodeCursor(payload: CursorPayload): string {
  return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(cursor: string | undefined): CursorPayload | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as unknown;
    if (
      typeof parsed === 'object' &&
      parsed !== null &&
      'id' in parsed &&
      'v' in parsed &&
      typeof (parsed as CursorPayload).id === 'string' &&
      ['string', 'number'].includes(typeof (parsed as CursorPayload).v)
    ) {
      return parsed as CursorPayload;
    }
  } catch {
    // ignoré : traité ci-dessous
  }
  throw new BadRequestException('Curseur invalide');
}

export function pageSize(limit: number | undefined): number {
  if (!limit) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(1, limit), MAX_PAGE_SIZE);
}

/** Découpe une liste récupérée avec take = limit + 1 en page + curseur suivant. */
export function paginate<T>(
  rows: T[],
  limit: number,
  cursorOf: (row: T) => CursorPayload,
): { items: T[]; nextCursor: string | null } {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? encodeCursor(cursorOf(last)) : null };
}
