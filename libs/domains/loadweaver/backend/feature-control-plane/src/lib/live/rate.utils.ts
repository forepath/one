/** A token bucket: `rate` per second, up to `burst` at once. */
export class TokenBucket {
  private tokens: number;
  private at: number;

  constructor(
    private readonly rate: number,
    private readonly burst: number,
    now = Date.now(),
  ) {
    this.tokens = burst;
    this.at = now;
  }

  take(amount: number, now = Date.now()): boolean {
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) / 1000) * this.rate);
    this.at = now;

    if (amount > this.tokens) return false;

    this.tokens -= amount;

    return true;
  }
}

/** Packets socket.io holds for a client that doesn't read: beyond this the session is ended (no backpressure). */
export const MAX_CLIENT_BUFFERED_PACKETS = 1_000;

export function clientBacklog(socket: { conn?: unknown }): number {
  return (socket.conn as { writeBuffer?: unknown[] } | undefined)?.writeBuffer?.length ?? 0;
}
