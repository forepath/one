import { createHash } from 'node:crypto';

/** Stable full ticket reference hash (sha1 of ticket id). */
export function deriveProjectTicketLongSha(ticketId: string): string {
  return createHash('sha1').update(ticketId).digest('hex');
}

export function shortShaFromLong(longSha: string): string {
  return longSha.slice(0, 7);
}
