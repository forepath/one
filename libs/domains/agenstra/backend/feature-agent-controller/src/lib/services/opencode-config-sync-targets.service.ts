import { createHash } from 'crypto';

import {
  AGENSTRA_OPENCODE_PLATFORM_WIRE_VERSION,
  prepareConfigForSync,
  stablePlatformPolicyJson,
  type EffectivePlatformSecurityPolicy,
  type JsonObject,
} from '@forepath/agenstra/shared/util-opencode-config';
import { Injectable, Logger, NotFoundException, Optional } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import {
  OpencodeConfigSyncStatus,
  OpencodeConfigSyncTargetEntity,
} from '../entities/opencode-config-sync-target.entity';

import { AgenstraNotificationPublisher } from '../notifications/agenstra-notification.publisher';

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
 * Durable per-agent OpenCode config sync targets.
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
    @Optional()
    private readonly notificationPublisher?: AgenstraNotificationPublisher,
  ) {}

  /** Hash of the effective egress policy alone (provenance excluded). */
  static hashEgressRevision(platformPolicy: EffectivePlatformSecurityPolicy | null | undefined): string | null {
    if (!platformPolicy) {
      return null;
    }

    return createHash('sha256')
      .update(stablePlatformPolicyJson({ ...platformPolicy.egress, scalarSources: undefined }))
      .digest('hex');
  }

  /**
   * Hash desired worker wire + secrets + platform security policy.
   * Includes platform wire version and prepareConfigForSync output so inject/materialize
   * deploys rematch even when stored overlays are unchanged. The platform policy (egress guard,
   * message filters) is stripped from the wire, so it is hashed separately.
   */
  static hashRevision(
    config: Record<string, unknown>,
    secrets: Record<string, string>,
    platformPolicy?: EffectivePlatformSecurityPolicy | null,
  ): string {
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
          ...(platformPolicy ? { platformPolicy: stablePlatformPolicyJson(platformPolicy) } : {}),
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
    const { effective, secrets, platformPolicy } = await this.effectiveConfigSync.buildEffectivePayload(
      clientId,
      agentId,
    );
    const desiredRevision = OpencodeConfigSyncTargetsService.hashRevision(effective, secrets, platformPolicy);

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
  /** Drop the sync target of an agent that was deleted (nothing left to sync). */
  async removeAgentTarget(clientId: string, agentId: string): Promise<void> {
    await this.targetsRepo.delete({ clientId, agentId });
  }

  /**
   * True only when the agent-manager explicitly reports the agent as missing. A bare 404 (e.g. an older manager
   * without the route) must not delete targets.
   */
  static isAgentGoneError(error: unknown, agentId: string): boolean {
    return (
      error instanceof NotFoundException && OpencodeConfigSyncTargetsService.isAgentGoneMessage(error.message, agentId)
    );
  }

  /** Manager wording for a missing agent (thrown 404 or `{ ok: false, error }` sync result), bound to this agent. */
  static isAgentGoneMessage(message: string | null | undefined, agentId: string): boolean {
    const match = /Agent with ID '?([0-9a-f-]{36})'? not found/i.exec(message ?? '');

    return match?.[1]?.toLowerCase() === agentId.toLowerCase();
  }

  /** Remove a target whose agent no longer exists on the manager (deleted out of band / manager reset). */
  private async pruneGoneTarget(target: OpencodeConfigSyncTargetEntity): Promise<void> {
    await this.targetsRepo.delete({ id: target.id });
    this.logger.log(
      `Removed OpenCode sync target ${target.id}: agent ${target.agentId} no longer exists on the agent-manager`,
    );
  }

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
        const { effective, secrets, platformPolicy } = await this.effectiveConfigSync.buildEffectivePayload(
          target.clientId,
          target.agentId,
        );
        const desiredRevision = OpencodeConfigSyncTargetsService.hashRevision(effective, secrets, platformPolicy);

        if (desiredRevision === target.appliedRevision && desiredRevision === target.desiredRevision) {
          continue;
        }

        target.desiredRevision = desiredRevision;
        target.syncStatus = 'pending';
        target.lastError = null;
        await this.targetsRepo.save(target);
        pendingIds.push(target.id);
      } catch (error: unknown) {
        if (OpencodeConfigSyncTargetsService.isAgentGoneError(error, target.agentId)) {
          await this.pruneGoneTarget(target);
          continue;
        }

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
      const previousError = target.lastError ?? null;

      if (result.ok) {
        target.syncStatus = 'synced';
        target.appliedRevision = target.desiredRevision;
        target.lastError = null;
        target.lastSyncedAt = new Date();
        this.notifyEgressApplied(target, result.platformPolicy);
      } else if (OpencodeConfigSyncTargetsService.isAgentGoneMessage(result.error, target.agentId)) {
        await this.pruneGoneTarget(target);

        return;
      } else {
        // No container / not healthy → keep pending for retry; hard apply errors → failed.
        const defer = result.defer === true;

        target.syncStatus = defer ? 'pending' : 'failed';
        target.lastError = result.error ?? 'sync failed';
        this.notifyEgressFailed(target, result.platformPolicy, previousError);
      }

      await this.targetsRepo.save(target);
    } catch (error: unknown) {
      if (OpencodeConfigSyncTargetsService.isAgentGoneError(error, target.agentId)) {
        await this.pruneGoneTarget(target);

        return;
      }

      const msg = error instanceof Error ? error.message : String(error);

      this.logger.warn(`OpenCode config sync failed for target ${target.id}: ${msg}`);
      target.syncStatus = 'failed';
      target.lastError = msg;
      await this.targetsRepo.save(target);
    }
  }

  /** `egress.policy_applied` once per new effective egress policy (not on every unrelated config sync). */
  private notifyEgressApplied(
    target: OpencodeConfigSyncTargetEntity,
    platformPolicy: EffectivePlatformSecurityPolicy | undefined,
  ): void {
    const egressRevision = OpencodeConfigSyncTargetsService.hashEgressRevision(platformPolicy);

    if (!egressRevision || egressRevision === target.appliedEgressRevision) {
      return;
    }

    const firstApplyOfDefault = !target.appliedEgressRevision && platformPolicy?.egress.mode === 'off';

    target.appliedEgressRevision = egressRevision;

    if (firstApplyOfDefault) {
      return;
    }

    this.notificationPublisher?.publishEgressPolicy('egress.policy_applied', target.clientId, {
      agentId: target.agentId,
      mode: platformPolicy?.egress.mode ?? 'off',
      revision: egressRevision,
    });
  }

  /** `egress.policy_failed` when the manager could not apply the egress policy (deduplicated per error). */
  private notifyEgressFailed(
    target: OpencodeConfigSyncTargetEntity,
    platformPolicy: EffectivePlatformSecurityPolicy | undefined,
    previousError: string | null,
  ): void {
    const error = target.lastError ?? '';

    if (!error.startsWith('Egress policy not applied') || error === previousError) {
      return;
    }

    this.notificationPublisher?.publishEgressPolicy('egress.policy_failed', target.clientId, {
      agentId: target.agentId,
      mode: platformPolicy?.egress.mode ?? 'off',
      revision: OpencodeConfigSyncTargetsService.hashEgressRevision(platformPolicy),
      error,
    });
  }
}
