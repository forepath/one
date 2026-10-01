import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';

import { VNC_TICKET_TTL_MS } from '../constants/vnc.constants';

export interface VncTicketRecord {
  ticket: string;
  agentId: string;
  containerId: string;
  expiresAt: number;
  consumed: boolean;
}

@Injectable()
export class VncTicketService {
  private readonly tickets = new Map<string, VncTicketRecord>();

  mint(agentId: string, containerId: string, ttlMs = VNC_TICKET_TTL_MS): { ticket: string; expiresIn: number } {
    this.purgeExpired();

    const ticket = randomBytes(32).toString('base64url');
    const expiresIn = Math.max(1, Math.floor(ttlMs / 1000));
    const expiresAt = Date.now() + expiresIn * 1000;

    this.tickets.set(ticket, {
      ticket,
      agentId,
      containerId,
      expiresAt,
      consumed: false,
    });

    return { ticket, expiresIn };
  }

  /**
   * Consume a ticket for a single WebSocket connection.
   * Throws UnauthorizedException when missing, expired, already used, or agent mismatch.
   *
   * Process-local store: run a single agent-manager replica (or sticky sessions) so REST mint
   * and the subsequent `/vnc` WebSocket upgrade reach the same process.
   */
  consume(ticket: string, expectedAgentId?: string): VncTicketRecord {
    this.purgeExpired();

    const record = this.tickets.get(ticket);

    if (!record || record.consumed || record.expiresAt <= Date.now()) {
      this.tickets.delete(ticket);
      throw new UnauthorizedException('Invalid or expired VNC ticket');
    }

    if (expectedAgentId && record.agentId !== expectedAgentId) {
      throw new UnauthorizedException('Invalid or expired VNC ticket');
    }

    record.consumed = true;
    this.tickets.delete(ticket);

    return record;
  }

  peek(ticket: string): VncTicketRecord | undefined {
    this.purgeExpired();

    const record = this.tickets.get(ticket);

    if (!record || record.consumed || record.expiresAt <= Date.now()) {
      return undefined;
    }

    return record;
  }

  private purgeExpired(): void {
    const now = Date.now();

    for (const [key, value] of this.tickets.entries()) {
      if (value.consumed || value.expiresAt <= now) {
        this.tickets.delete(key);
      }
    }
  }
}
