import { createHash } from 'crypto';

import {
  AGENSTRA_OPENCODE_PLATFORM_WIRE_VERSION,
  prepareConfigForSync,
  type JsonObject,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  OpencodeConfigSyncStatus,
  OpencodeConfigSyncTargetEntity,
} from '../entities/opencode-config-sync-target.entity';

import { ClientAgentProxyService } from './client-agent-proxy.service';
import { OpencodeEffectiveConfigSyncService } from './opencode-effective-config-sync.service';

export interface OpencodeConfigSyncSummaryDto {
  syncStatus: OpencodeConfigSyncStatus;
  desiredRevision?: string;
  appliedRevision?: string | null;
  lastError?: string | null;
  lastSyncedAt?: Date | null;
}

/**
 * Durable per-agent OpenCode config sync targets (filter-rules pattern).
 * Marks pending on config changes; coordinator/unit jobs retry pending+failed.
 */
@Injectable()
export class OpencodeConfigSyncTargetsService {
  private readonly logger = new Logger(OpencodeConfigSyncTargetsService.name);

  constructor(
    @InjectRepository(OpencodeConfigSyncTargetEntity)
    private readonly targetsRepo: Repository<OpencodeConfigSyncTargetEntity>,
    private readonly effectiveConfigSync: OpencodeEffectiveConfigSyncService,
    private readonly clientAgentProxy: ClientAgentProxyService,
  ) {}

  /**
   * Hash desired worker wire + secrets.
   * Includes platform wire version and prepareConfigForSync output so inject/materialize
   * deploys rematch even when stored overlays are unchanged.
   */
  static hashRevision(config: Record<string, unknown>, secrets: Record<string, string>): string {
    const sortedSecrets: Record<string, string> = {};

    for (const key of Object.keys(secrets).sort()) {
      sortedSecrets[key] = secrets[key];
    }

    const prepared = prepareConfigForSync(config as JsonObject);

    return createHash('sha256')
      .update(
        JSON.stringify({
          platformWireVersion: AGENSTRA_OPENCODE_PLATFORM_WIRE_VERSION,
          config: prepared,
          secrets: sortedSecrets,
        }),
      )
      .digest('hex');
  }

  async getSummaryForAgent(agentId: string): Promise<OpencodeConfigSyncSummaryDto | null> {
    const target = await this.targetsRepo.findOne({ where: { agentId } });

    if (!target) {
      return null;
    }

    return {
      syncStatus: target.syncStatus,
      desiredRevision: target.desiredRevision,
      appliedRevision: target.appliedRevision,
      lastError: target.lastError ?? null,
      lastSyncedAt: target.lastSyncedAt ?? null,
    };
  }

  /** Recompute desired revision and set pending for one agent. */
  async markAgentPending(clientId: string, agentId: string): Promise<OpencodeConfigSyncTargetEntity> {
    const { effective, secrets } = await this.effectiveConfigSync.buildEffectivePayload(clientId, agentId);
    const desiredRevision = OpencodeConfigSyncTargetsService.hashRevision(effective, secrets);

    let target = await this.targetsRepo.findOne({ where: { agentId } });

    if (!target) {
      target = this.targetsRepo.create({
        clientId,
        agentId,
        desiredRevision,
        syncStatus: 'pending',
        lastError: null,
      });
    } else {
      target.clientId = clientId;
      target.desiredRevision = desiredRevision;
      target.syncStatus = 'pending';
      target.lastError = null;
    }

    return await this.targetsRepo.save(target);
  }

  /** Mark every agent for a workspace pending (paged). */
  async markClientPending(clientId: string): Promise<number> {
    let marked = 0;
    const pageSize = 100;
    let offset = 0;

    for (;;) {
      const agents = await this.clientAgentProxy.getClientAgents(clientId, pageSize, offset);

      if (agents.length === 0) {
        break;
      }

      for (const agent of agents) {
        try {
          await this.markAgentPending(clientId, agent.id);
          marked += 1;
        } catch (error: unknown) {
          const err = error as { message?: string };

          this.logger.warn(`Failed to mark OpenCode sync pending for agent ${agent.id}: ${err.message ?? 'unknown'}`);
        }
      }

      if (agents.length < pageSize) {
        break;
      }

      offset += pageSize;
    }

    return marked;
  }

  /** Mark every agent across all clients pending. */
  async markAllPending(): Promise<number> {
    const clientIds = await this.effectiveConfigSync.listClientIds();
    let marked = 0;

    for (const clientId of clientIds) {
      marked += await this.markClientPending(clientId);
    }

    return marked;
  }

  /**
   * Mark pending and immediately attempt sync (Save feels instant for running agents).
   * Durable retry covers misses via BullMQ.
   */
  async markAndProcessAgent(clientId: string, agentId: string): Promise<OpencodeConfigSyncSummaryDto> {
    const target = await this.markAgentPending(clientId, agentId);

    await this.processTargetById(target.id);

    const updated = await this.targetsRepo.findOne({ where: { id: target.id } });

    return {
      syncStatus: updated?.syncStatus ?? 'pending',
      desiredRevision: updated?.desiredRevision,
      appliedRevision: updated?.appliedRevision,
      lastError: updated?.lastError ?? null,
      lastSyncedAt: updated?.lastSyncedAt ?? null,
    };
  }

  /** Mark all agents for a client pending, then process each immediately (best-effort). */
  async markAndProcessClient(clientId: string): Promise<void> {
    await this.markClientPending(clientId);
    const ids = await this.findPendingTargetIdsForClient(clientId, 200);

    for (const targetId of ids) {
      await this.processTargetById(targetId);
    }
  }

  /** Mark every agent pending, then process a first batch immediately. */
  async markAndProcessAll(): Promise<void> {
    await this.markAllPending();
    const ids = await this.findPendingTargetIds(50);

    for (const targetId of ids) {
      await this.processTargetById(targetId);
    }
  }

  async findPendingTargetIds(max: number): Promise<string[]> {
    const rows = await this.targetsRepo.find({
      where: { syncStatus: In(['pending', 'failed']) },
      order: { updatedAt: 'ASC' },
      take: max,
      select: ['id'],
    });

    return rows.map((row) => row.id);
  }

  /**
   * Recompute desired revisions for synced targets; mark pending when platform wire / overlays drift.
   * Returns ids newly marked pending (capped by max).
   */
  async reconcileOutdatedSyncedTargets(max: number): Promise<string[]> {
    if (max <= 0) {
      return [];
    }

    const synced = await this.targetsRepo.find({
      where: { syncStatus: 'synced' },
      order: { updatedAt: 'ASC' },
      take: Math.max(max * 4, max),
    });
    const pendingIds: string[] = [];

    for (const target of synced) {
      if (pendingIds.length >= max) {
        break;
      }

      try {
        const { effective, secrets } = await this.effectiveConfigSync.buildEffectivePayload(
          target.clientId,
          target.agentId,
        );
        const desiredRevision = OpencodeConfigSyncTargetsService.hashRevision(effective, secrets);

        if (desiredRevision === target.appliedRevision && desiredRevision === target.desiredRevision) {
          continue;
        }

        target.desiredRevision = desiredRevision;
        target.syncStatus = 'pending';
        target.lastError = null;
        await this.targetsRepo.save(target);
        pendingIds.push(target.id);
      } catch (error: unknown) {
        const err = error as { message?: string };

        this.logger.warn(`Failed to reconcile OpenCode sync target ${target.id}: ${err.message ?? 'unknown'}`);
      }
    }

    return pendingIds;
  }

  async findPendingTargetIdsForClient(clientId: string, max: number): Promise<string[]> {
    const rows = await this.targetsRepo.find({
      where: { clientId, syncStatus: In(['pending', 'failed']) },
      order: { updatedAt: 'ASC' },
      take: max,
      select: ['id'],
    });

    return rows.map((row) => row.id);
  }

  async processTargetById(targetId: string): Promise<void> {
    const target = await this.targetsRepo.findOne({ where: { id: targetId } });

    if (!target) {
      return;
    }

    if (target.syncStatus === 'synced' && target.appliedRevision === target.desiredRevision) {
      return;
    }

    try {
      const result = await this.effectiveConfigSync.syncAgent(target.clientId, target.agentId);

      if (result.ok) {
        target.syncStatus = 'synced';
        target.appliedRevision = target.desiredRevision;
        target.lastError = null;
        target.lastSyncedAt = new Date();
      } else {
        // No container / not healthy → keep pending for retry; hard apply errors → failed.
        const defer = result.defer === true;

        target.syncStatus = defer ? 'pending' : 'failed';
        target.lastError = result.error ?? 'sync failed';
      }

      await this.targetsRepo.save(target);
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : String(error);

      this.logger.warn(`OpenCode config sync failed for target ${target.id}: ${msg}`);
      target.syncStatus = 'failed';
      target.lastError = msg;
      await this.targetsRepo.save(target);
    }
  }
}
