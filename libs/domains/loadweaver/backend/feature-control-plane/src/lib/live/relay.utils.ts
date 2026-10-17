import { createHmac, hkdfSync, timingSafeEqual } from 'node:crypto';

/** The relay key (3.19): derived from the cluster's encryption key every control-plane replica holds. */
export function relayKey(encryptionKey: string | undefined): Buffer | null {
  if (!encryptionKey) return null;

  return Buffer.from(
    hkdfSync('sha256', Buffer.from(encryptionKey, 'utf8'), Buffer.alloc(0), 'loadweaver/live-relay', 32),
  );
}

/** `<hex mac>.<body>`: database users can NOTIFY, but only replicas can sign. */
export function signRelay(key: Buffer, body: string): string {
  return `${createHmac('sha256', key).update(body).digest('hex')}.${body}`;
}

export function verifyRelay(key: Buffer, signed: string): string | null {
  const dot = signed.indexOf('.');

  if (dot !== 64) return null;

  const mac = Buffer.from(signed.slice(0, dot), 'hex');
  const body = signed.slice(dot + 1);
  const expected = createHmac('sha256', key).update(body).digest();

  return mac.length === expected.length && timingSafeEqual(mac, expected) ? body : null;
}

/** Out-of-order messages a channel may hold back before it is given up. */
export const MAX_PENDING = 1_000;

/**
 * Per-channel ordering for relayed messages: small ones travel inline in NOTIFY, large ones through a table, so they
 * can overtake each other. Senders number them; this delivers them in order, holding back what arrives early.
 */
export class ReorderBuffer<T> {
  private next = 0;
  private readonly pending = new Map<number, T>();

  /** The messages that are now deliverable, in order; `null` when too many are held back (the channel is broken). */
  push(seq: number, message: T): T[] | null {
    if (seq < this.next || this.pending.has(seq)) return [];

    this.pending.set(seq, message);

    if (this.pending.size > MAX_PENDING) return null;

    const ready: T[] = [];

    while (this.pending.has(this.next)) {
      ready.push(this.pending.get(this.next) as T);
      this.pending.delete(this.next);
      this.next++;
    }

    return ready;
  }

  get waiting(): boolean {
    return this.pending.size > 0;
  }
}
