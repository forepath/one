import { UserEntity } from '@forepath/identity/backend';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import { FleetAuditEventEntity } from '../entities/fleet-audit-event.entity';
import type { FleetCaller } from '../utils/fleet-access.utils';

export interface FleetAuditEntryDto {
  seq: string;
  at: string;
  actorType: string;
  actorId: string | null;
  /**
   * The acting user's email for `actorType: 'user'` (`null`: deleted user / other actor types), resolved server-side
   * from the fleet's identity users like Agenstra's ticket activity `actorEmail` (the list is fleet-admin only).
   */
  actorEmail: string | null;
  action: string;
  clusterId: string | null;
  target: string;
  details: Record<string, unknown>;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function auditActor(caller: FleetCaller | null): Pick<FleetAuditEventEntity, 'actorType' | 'actorId'> {
  if (!caller) return { actorType: 'system', actorId: null };

  if (caller.isApiKey) return { actorType: 'api-key', actorId: null };

  return { actorType: 'user', actorId: caller.userId };
}

/** Audit log of the fleet (connections, grants, relayed changes, operations, Cloud hooks). */
@Injectable()
export class FleetAuditService {
  private readonly logger = new Logger(FleetAuditService.name);

  constructor(
    @InjectRepository(FleetAuditEventEntity) private readonly repo: Repository<FleetAuditEventEntity>,
    @InjectRepository(UserEntity) private readonly users: Repository<UserEntity>,
  ) {}

  async record(
    caller: FleetCaller | null,
    action: string,
    target: string,
    details: Record<string, unknown> = {},
    clusterId: string | null = null,
  ): Promise<void> {
    await this.repo.insert({ ...auditActor(caller), action, target, details, clusterId, at: new Date() });
  }

  /** Recording must never break a relayed response that already went out. */
  async recordQuietly(...args: Parameters<FleetAuditService['record']>): Promise<void> {
    try {
      await this.record(...args);
    } catch (error) {
      this.logger.warn(`Audit ${args[1]}: ${error instanceof Error ? error.message : error}`);
    }
  }

  async list(filter: {
    clusterId?: string;
    action?: string;
    before?: string;
    limit?: number;
  }): Promise<FleetAuditEntryDto[]> {
    const query = this.repo.createQueryBuilder('a');

    if (filter.clusterId) query.andWhere('a.cluster_id = :cluster', { cluster: filter.clusterId });

    if (filter.action) query.andWhere('a.action = :action', { action: filter.action });

    if (filter.before && /^\d{1,19}$/.test(filter.before)) query.andWhere('a.seq < :before', { before: filter.before });

    const rows = await query
      .orderBy('a.seq', 'DESC')
      .limit(Math.min(Math.max(filter.limit ?? 100, 1), 500))
      .getMany();
    const emails = await this.userEmails(rows.filter((r) => r.actorType === 'user').map((r) => r.actorId));

    return rows.map((r) => ({
      seq: String(r.seq),
      at: new Date(r.at).toISOString(),
      actorType: r.actorType,
      actorId: r.actorId,
      actorEmail: r.actorType === 'user' && r.actorId ? (emails.get(r.actorId) ?? null) : null,
      action: r.action,
      clusterId: r.clusterId,
      target: r.target,
      details: r.details,
    }));
  }

  /** One batched lookup of the page's acting users (no query per row); unknown ids (deleted users) stay out. */
  private async userEmails(ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => !!id && UUID.test(id)))];

    if (!wanted.length) return new Map();

    const users = await this.users.find({ where: { id: In(wanted) }, select: { id: true, email: true } });

    return new Map(users.filter((u) => !!u.email).map((u) => [u.id, u.email]));
  }
}
