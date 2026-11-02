import {
  agentMessage,
  logEntrySchema,
  type Envelope,
  type LogEntry,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable, OnModuleDestroy } from '@nestjs/common';

const FLUSH_MS = 1_000;
const BATCH = 500;
/** Lines kept while the control plane is unreachable (~10 MB); the oldest go first, and are counted. */
export const MAX_QUEUED = 20_000;
const MAX_MESSAGE = 16_384;

/** An unacknowledged batch is sent again after this long. */
const ACK_TIMEOUT_MS = 30_000;
/** After the control plane couldn't store a batch (log store down), wait this long before the next try. */
const RETRY_MS = 5_000;

/**
 * Ships log lines off the node right away (3.14), so the logs of a node that just died are still readable: batches
 * every second over the agent stream, one at a time, each kept until the control plane confirms it stored it; while
 * disconnected or while the log store is down they queue up (bounded) and are sent once it works again.
 */
@Injectable()
export class LogShipper implements OnModuleDestroy {
  private queue: LogEntry[] = [];
  private dropped = 0;
  private send: ((envelope: Envelope) => boolean) | null = null;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: { id: string; count: number; dropped: number; at: number } | null = null;
  private retryAt = 0;

  /** `send` returns false while there is no established stream. */
  attach(send: (envelope: Envelope) => boolean): void {
    this.send = send;
    this.timer ??= setInterval(() => this.flush(), FLUSH_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  push(entry: LogEntry): void {
    const line =
      entry.message.length > MAX_MESSAGE ? { ...entry, message: entry.message.slice(0, MAX_MESSAGE) } : entry;

    // A malformed line must never block the batch it would be in.
    if (!logEntrySchema.safeParse(line).success) {
      this.dropped++;

      return;
    }

    this.queue.push(line);

    if (this.queue.length > MAX_QUEUED) {
      const excess = this.queue.length - MAX_QUEUED;

      this.queue.splice(0, excess);
      this.dropped += excess;

      // The batch in flight lost lines from its head: send it again rather than confirm the wrong ones.
      if (this.inFlight) this.inFlight = null;
    }
  }

  queued(): number {
    return this.queue.length;
  }

  /** The control plane's answer to a batch. */
  ack(id: string | undefined, ok: boolean, now = Date.now()): void {
    if (!this.inFlight || id !== this.inFlight.id) return;

    if (ok) {
      this.queue.splice(0, this.inFlight.count);
      this.dropped = Math.max(0, this.dropped - this.inFlight.dropped);
    } else this.retryAt = now + RETRY_MS;

    this.inFlight = null;

    if (ok) this.flush(now);
  }

  /** Sends the next batch when none is waiting for its confirmation. */
  flush(now = Date.now()): void {
    if (this.inFlight && now - this.inFlight.at < ACK_TIMEOUT_MS) return;

    this.inFlight = null;

    if (!this.send || this.queue.length === 0 || now < this.retryAt) return;

    const entries = this.queue.slice(0, BATCH);
    const envelope = agentMessage('logBatch', { entries, ...(this.dropped ? { dropped: this.dropped } : {}) });

    if (this.send(envelope)) this.inFlight = { id: envelope.id, count: entries.length, dropped: this.dropped, at: now };
  }
}
