import { agentMessage, type Envelope, type SecretValue } from '@forepath/loadweaver/shared/util-agent-protocol';
import { Injectable } from '@nestjs/common';

const SECRET_TIMEOUT_MS = 15_000;

interface Pending {
  resolve: (value: Buffer) => void;
  reject: (error: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * Fetches secret values over the agent stream (3.22): only for workloads assigned to this node, only when a
 * container is created, never cached on disk.
 */
@Injectable()
export class SecretBroker {
  private send: ((envelope: Envelope) => void) | null = null;
  private readonly pending = new Map<string, Pending>();

  attach(send: (envelope: Envelope) => void): void {
    this.send = send;
  }

  async fetch(workload: string, ref: string): Promise<Buffer> {
    if (!this.send) throw new Error('not connected to the control plane');

    const envelope = agentMessage('secretRequest', { workload, ref });

    return await new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(envelope.id);
        reject(new Error(`secret ${ref} not delivered in time`));
      }, SECRET_TIMEOUT_MS);

      this.pending.set(envelope.id, { resolve, reject, timer });
      this.send?.(envelope);
    });
  }

  /** Called by the connection for `secretValue` / `error` replies. */
  deliver(correlationId: string | undefined, value: SecretValue | null, error?: string): void {
    const pending = correlationId ? this.pending.get(correlationId) : undefined;

    if (!pending || !correlationId) return;

    clearTimeout(pending.timer);
    this.pending.delete(correlationId);

    if (value) pending.resolve(Buffer.from(value.valueBase64, 'base64'));
    else pending.reject(new Error(error ?? 'secret request rejected'));
  }
}
