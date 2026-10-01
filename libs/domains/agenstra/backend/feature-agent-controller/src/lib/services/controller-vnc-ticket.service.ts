import { Injectable, UnauthorizedException } from '@nestjs/common';
import { randomBytes } from 'crypto';
import type { UserRole } from '@forepath/identity/backend';
import { RedisCacheService } from '@forepath/shared/backend/util-redis-cache';

import { CONTROLLER_VNC_TICKET_TTL_MS } from '../constants/vnc.constants';

export interface ControllerVncTicketRecord {
  ticket: string;
  clientId: string;
  agentId: string;
  subject: string;
  isApiKeyAuth: boolean;
  userRole?: UserRole;
  managerTicket: string;
  managerWsUrl: string;
  clientAuthHeader: string;
  expiresAt: number;
  consumed: boolean;
}

const REDIS_KEY_PREFIX = 'agenstra:vnc-ticket:';

/**
 * One-time VNC tickets for browser → controller upgrades.
 * Prefers Redis so mint (REST) and consume (WebSocket) work across replicas;
 * falls back to process-local memory when Redis is unavailable (dev/single-instance).
 */
@Injectable()
export class ControllerVncTicketService {
  private readonly memoryTickets = new Map<string, ControllerVncTicketRecord>();

  constructor(private readonly redisCache: RedisCacheService) {}

  async mint(input: {
    clientId: string;
    agentId: string;
    subject: string;
    isApiKeyAuth: boolean;
    userRole?: UserRole;
    managerTicket: string;
    managerWsUrl: string;
    clientAuthHeader: string;
    ttlMs?: number;
  }): Promise<{ ticket: string; expiresIn: number }> {
    this.purgeExpiredMemory();

    const ttlMs = input.ttlMs ?? CONTROLLER_VNC_TICKET_TTL_MS;
    const ticket = randomBytes(32).toString('base64url');
    const expiresIn = Math.max(1, Math.floor(ttlMs / 1000));
    const record: ControllerVncTicketRecord = {
      ticket,
      clientId: input.clientId,
      agentId: input.agentId,
      subject: input.subject,
      isApiKeyAuth: input.isApiKeyAuth,
      userRole: input.userRole,
      managerTicket: input.managerTicket,
      managerWsUrl: input.managerWsUrl,
      clientAuthHeader: input.clientAuthHeader,
      expiresAt: Date.now() + expiresIn * 1000,
      consumed: false,
    };

    const redisStored = await this.redisCache.setJson(`${REDIS_KEY_PREFIX}${ticket}`, record, expiresIn);

    // Only keep a process-local copy when Redis did not store the ticket (dev / Redis down).
    // Dual-writing would allow a second consume on the minting replica after another replica
    // atomically takes the Redis key.
    if (!redisStored) {
      this.memoryTickets.set(ticket, record);
    }

    return { ticket, expiresIn };
  }

  async consume(ticket: string): Promise<ControllerVncTicketRecord> {
    this.purgeExpiredMemory();

    const redisRecord = await this.redisCache.takeJson<ControllerVncTicketRecord>(`${REDIS_KEY_PREFIX}${ticket}`);

    if (redisRecord) {
      this.memoryTickets.delete(ticket);

      if (redisRecord.consumed || redisRecord.expiresAt <= Date.now()) {
        throw new UnauthorizedException('Invalid or expired VNC ticket');
      }

      return redisRecord;
    }

    const record = this.memoryTickets.get(ticket);

    if (!record || record.consumed || record.expiresAt <= Date.now()) {
      this.memoryTickets.delete(ticket);
      throw new UnauthorizedException('Invalid or expired VNC ticket');
    }

    record.consumed = true;
    this.memoryTickets.delete(ticket);

    return record;
  }

  private purgeExpiredMemory(): void {
    const now = Date.now();

    for (const [key, value] of this.memoryTickets.entries()) {
      if (value.consumed || value.expiresAt <= now) {
        this.memoryTickets.delete(key);
      }
    }
  }
}
