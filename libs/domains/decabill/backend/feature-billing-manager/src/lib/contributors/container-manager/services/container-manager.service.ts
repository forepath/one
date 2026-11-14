import { isIP } from 'node:net';

import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';

import { ProvisioningStatus, type SubscriptionItemEntity } from '../../../entities/subscription-item.entity';
import { BillingNotificationPublisher } from '../../../notifications/billing-notification.publisher';
import { ContainerStatsSamplesRepository } from '../../../repositories/container-stats-samples.repository';
import { ContainerStatsSummariesRepository } from '../../../repositories/container-stats-summaries.repository';
import { ServicePlansRepository } from '../../../repositories/service-plans.repository';
import { SubscriptionAddonsRepository } from '../../../repositories/subscription-addons.repository';
import { SubscriptionItemsRepository } from '../../../repositories/subscription-items.repository';
import { SubscriptionsRepository } from '../../../repositories/subscriptions.repository';
import { AddonModuleRegistryService } from '../../../services/addon-module-registry.service';
import { SshExecutorService } from '../../../services/ssh-executor.service';
import {
  mergeHostNetworkingIntoTopology,
  parseIpAddrJson,
  parseIpRouteJson,
} from '../../../utils/container-manager-host-network.utils';
import { CONTAINER_MANAGER_MODULE_KEY } from '../../../utils/plan-addons.utils';
import { isLiveAccessibleSubscriptionStatus } from '../../../utils/subscription-live-access.utils';
import {
  CONTAINER_MANAGER_HISTORY_MAX_POINTS,
  DOCKER_CONTAINER_ID_PATTERN,
} from '../constants/container-manager.constants';
import type {
  ContainerManagerContainersResponseDto,
  ContainerManagerLogsResponseDto,
  ContainerManagerNetworkDto,
  ContainerManagerNetworksResponseDto,
  ContainerManagerStatsHistoryResponseDto,
} from '../dto/container-manager.dto';

const SSH_USER = 'root';
const SSH_PORT = 22;
const DEFAULT_SSH_TIMEOUT_MS = 60_000;
const DEFAULT_LOG_TAIL = 200;
const MAX_LOG_TAIL = 500;
/** Soft cap on combined log payload returned to clients. */
const MAX_LOG_PAYLOAD_CHARS = 256_000;

@Injectable()
export class ContainerManagerService {
  private readonly logger = new Logger(ContainerManagerService.name);

  constructor(
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly subscriptionItemsRepository: SubscriptionItemsRepository,
    private readonly subscriptionAddonsRepository: SubscriptionAddonsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly sshExecutor: SshExecutorService,
    private readonly addonModuleRegistry: AddonModuleRegistryService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly samplesRepository: ContainerStatsSamplesRepository,
    private readonly summariesRepository: ContainerStatsSummariesRepository,
  ) {}

  async getCachedSummary(itemId: string): Promise<{
    containerCount: number;
    healthyCount: number;
    lastCollectedAt: string | null;
  } | null> {
    return await this.summariesRepository.findByItemId(itemId);
  }

  async listContainers(
    subscriptionId: string,
    itemId: string,
    options?: { userId?: string; asAdmin?: boolean },
  ): Promise<ContainerManagerContainersResponseDto> {
    const item = await this.assertContainerManagerAccess(subscriptionId, itemId, options);

    try {
      return await this.collectLiveContainersForItem(item);
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      await this.notifyCollectionFailed(subscriptionId, itemId, error);
      throw new BadRequestException('Unable to collect container information');
    }
  }

  /**
   * Live SSH docker ps + stats for a provisioned item. Does not persist graph history.
   * Callers must enforce eligibility/authz before invoking.
   */
  async collectLiveContainersForItem(item: SubscriptionItemEntity): Promise<ContainerManagerContainersResponseDto> {
    const host = this.resolvePublicIp(item);
    const privateKey = item.sshPrivateKey;

    if (!privateKey) {
      throw new BadRequestException('SSH access is not available for this service');
    }

    await this.sshExecutor.waitUntilReachable(host, SSH_PORT, { timeoutMs: DEFAULT_SSH_TIMEOUT_MS });
    const listRaw = await this.execDockerJson(host, privateKey, `docker ps -a --format '{{json .}}'`);
    const containersMeta = this.parseNdjson(listRaw);
    const statsRaw = await this.execDockerJson(host, privateKey, `docker stats --no-stream --format '{{json .}}'`);
    const statsByName = new Map<string, Record<string, unknown>>();

    for (const row of this.parseNdjson(statsRaw)) {
      const name = typeof row['Name'] === 'string' ? row['Name'] : null;

      if (name) {
        statsByName.set(name.replace(/^\//, ''), row);
      }
    }

    const collectedAt = new Date().toISOString();
    const containers = containersMeta.map((row) => {
      const id = String(row['ID'] ?? row['Id'] ?? '');
      const name = String(row['Names'] ?? row['Name'] ?? '').replace(/^\//, '');
      const state = String(row['State'] ?? '');
      const status = String(row['Status'] ?? '');
      const statsRow = statsByName.get(name) ?? null;
      const stats = statsRow ? this.mapStatsRow(statsRow) : null;

      return {
        id,
        name,
        image: String(row['Image'] ?? ''),
        state,
        status,
        createdAt: typeof row['CreatedAt'] === 'string' ? row['CreatedAt'] : null,
        stats,
      };
    });

    return { containers, collectedAt };
  }

  async getStatsHistory(
    subscriptionId: string,
    itemId: string,
    containerId: string,
    options?: { userId?: string; asAdmin?: boolean },
  ): Promise<ContainerManagerStatsHistoryResponseDto> {
    await this.assertContainerManagerAccess(subscriptionId, itemId, options);
    const safeContainerId = this.assertSafeDockerContainerId(containerId);
    const points = await this.samplesRepository.findLatestPoints(
      itemId,
      safeContainerId,
      CONTAINER_MANAGER_HISTORY_MAX_POINTS,
    );

    return {
      containerId: safeContainerId,
      points,
    };
  }

  async getLogs(
    subscriptionId: string,
    itemId: string,
    containerId: string,
    options?: { userId?: string; asAdmin?: boolean; tail?: number },
  ): Promise<ContainerManagerLogsResponseDto> {
    const item = await this.assertContainerManagerAccess(subscriptionId, itemId, options);
    const safeContainerId = this.assertSafeDockerContainerId(containerId);
    const tail = this.normalizeLogTail(options?.tail);
    const host = this.resolvePublicIp(item);
    const privateKey = item.sshPrivateKey;

    if (!privateKey) {
      throw new BadRequestException('SSH access is not available for this service');
    }

    try {
      await this.sshExecutor.waitUntilReachable(host, SSH_PORT, { timeoutMs: DEFAULT_SSH_TIMEOUT_MS });
      // Merge stderr into stdout so container stderr lines are included in one stream.
      const raw = await this.execDockerJson(
        host,
        privateKey,
        `docker logs --timestamps --tail ${tail} ${safeContainerId} 2>&1`,
      );
      const { lines, truncated } = this.normalizeLogOutput(raw);

      return {
        containerId: safeContainerId,
        lines,
        collectedAt: new Date().toISOString(),
        truncated,
        tail,
      };
    } catch (error: unknown) {
      if (error instanceof BadRequestException) {
        throw error;
      }

      await this.publishCollectionFailed(subscriptionId, itemId, error);
      throw new BadRequestException('Unable to collect container logs');
    }
  }

  async notifyCollectionFailed(subscriptionId: string, itemId: string, error: unknown): Promise<void> {
    await this.publishCollectionFailed(subscriptionId, itemId, error);
  }

  async listNetworks(
    subscriptionId: string,
    itemId: string,
    options?: { userId?: string; asAdmin?: boolean },
  ): Promise<ContainerManagerNetworksResponseDto> {
    const item = await this.assertContainerManagerAccess(subscriptionId, itemId, options);
    const host = this.resolvePublicIp(item);
    const privateKey = item.sshPrivateKey;

    if (!privateKey) {
      throw new BadRequestException('SSH access is not available for this service');
    }

    try {
      await this.sshExecutor.waitUntilReachable(host, SSH_PORT, { timeoutMs: DEFAULT_SSH_TIMEOUT_MS });
      const listRaw = await this.execDockerJson(host, privateKey, `docker network ls --format '{{json .}}'`);
      const networksMeta = this.parseNdjson(listRaw);
      const networks: ContainerManagerNetworkDto[] = [];

      for (const row of networksMeta) {
        const id = String(row['ID'] ?? '');
        const name = String(row['Name'] ?? '');

        if (!id || !name) {
          continue;
        }

        let inspectRaw: string;

        try {
          inspectRaw = await this.execDockerJson(host, privateKey, `docker network inspect ${this.shellQuote(name)}`);
        } catch (inspectError: unknown) {
          // Skip networks with unsafe names rather than aborting the whole collection.
          const inspectMessage = inspectError instanceof Error ? inspectError.message : String(inspectError);

          this.logger.warn(`Skipping docker network inspect for item ${itemId}: ${inspectMessage}`);
          continue;
        }

        const inspected = this.parseJsonArray(inspectRaw)[0] as Record<string, unknown> | undefined;
        const driver = String(inspected?.['Driver'] ?? row['Driver'] ?? '');
        const scope = String(inspected?.['Scope'] ?? row['Scope'] ?? '');
        const isOverlay = driver === 'overlay';
        const containersObj =
          inspected && typeof inspected['Containers'] === 'object' && inspected['Containers']
            ? (inspected['Containers'] as Record<string, Record<string, unknown>>)
            : {};
        const containers = Object.values(containersObj)
          .map((c) => (typeof c['Name'] === 'string' ? c['Name'] : null))
          .filter((n): n is string => !!n);
        const ipam = inspected?.['IPAM'] as { Config?: Array<{ Gateway?: string; Subnet?: string }> } | undefined;
        const routes = (ipam?.Config ?? []).map((cfg) => ({
          destination: cfg.Subnet ?? '',
          gateway: cfg.Gateway,
        }));
        const exitNodes = routes.map((r) => r.gateway).filter((g): g is string => !!g);

        networks.push({
          id,
          name,
          driver,
          scope,
          isOverlay,
          containers,
          exitNodes,
          routes: routes.filter((r) => r.destination),
        });
      }

      const nodes: ContainerManagerNetworksResponseDto['topology']['nodes'] = [];
      const edges: ContainerManagerNetworksResponseDto['topology']['edges'] = [];
      const seenNodes = new Set<string>();
      const ensureNode = (
        id: string,
        label: string,
        kind: ContainerManagerNetworksResponseDto['topology']['nodes'][number]['kind'],
      ): void => {
        if (seenNodes.has(id)) {
          return;
        }

        seenNodes.add(id);
        nodes.push({ id, label, kind });
      };

      for (const network of networks) {
        ensureNode(`net:${network.id}`, network.name, 'network');

        for (const containerName of network.containers) {
          const containerNodeId = `ctr:${containerName}`;

          ensureNode(containerNodeId, containerName, 'container');
          edges.push({
            id: `${network.id}-${containerName}`,
            from: containerNodeId,
            to: `net:${network.id}`,
            label: network.driver,
          });
        }

        for (const exit of network.exitNodes) {
          const exitId = `exit:${exit}`;

          ensureNode(exitId, exit, 'exit');
          edges.push({
            id: `${network.id}-exit-${exit}`,
            from: `net:${network.id}`,
            to: exitId,
            label: 'exit',
          });
        }

        for (const route of network.routes) {
          const routeId = `route:${network.id}:${route.destination}`;

          ensureNode(routeId, route.destination, 'route');
          edges.push({
            id: `${network.id}-route-${route.destination}`,
            from: `net:${network.id}`,
            to: routeId,
            label: route.gateway ? `via ${route.gateway}` : undefined,
          });
        }
      }

      let hostInterfaces: ContainerManagerNetworksResponseDto['hostInterfaces'] = [];
      let hostRoutes: ContainerManagerNetworksResponseDto['hostRoutes'] = [];
      let topologyNodes = nodes;
      let topologyEdges = edges;

      try {
        hostInterfaces = parseIpAddrJson(await this.execHostJson(host, privateKey, 'ip -j addr'));
      } catch (addrError: unknown) {
        const addrMessage = addrError instanceof Error ? addrError.message : String(addrError);

        this.logger.warn(`Host address collection unavailable for item ${itemId}: ${addrMessage}`);
      }

      try {
        // Prefer IPv4 table so default egress is present even when mixed-family JSON omits it.
        let routeRaw = '';

        try {
          routeRaw = await this.execHostJson(host, privateKey, 'ip -4 -j route');
        } catch {
          routeRaw = await this.execHostJson(host, privateKey, 'ip -j route');
        }

        hostRoutes = parseIpRouteJson(routeRaw);
      } catch (routeError: unknown) {
        const routeMessage = routeError instanceof Error ? routeError.message : String(routeError);

        this.logger.warn(`Host route collection unavailable for item ${itemId}: ${routeMessage}`);
      }

      if (hostInterfaces.length > 0 || hostRoutes.length > 0) {
        const merged = mergeHostNetworkingIntoTopology({
          nodes,
          edges,
          hostInterfaces,
          hostRoutes,
        });

        topologyNodes = merged.nodes;
        topologyEdges = merged.edges;
      }

      return {
        networks,
        topology: { nodes: topologyNodes, edges: topologyEdges },
        hostInterfaces,
        hostRoutes,
        collectedAt: new Date().toISOString(),
      };
    } catch (error: unknown) {
      await this.publishCollectionFailed(subscriptionId, itemId, error);
      throw new BadRequestException('Unable to collect network information');
    }
  }

  private async assertContainerManagerAccess(
    subscriptionId: string,
    itemId: string,
    options?: { userId?: string; asAdmin?: boolean },
  ) {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);

    if (!options?.asAdmin) {
      if (!options?.userId || subscription.userId !== options.userId) {
        throw new NotFoundException(`Subscription item ${itemId} not found`);
      }
    }

    if (!isLiveAccessibleSubscriptionStatus(subscription.status)) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    if (!this.addonModuleRegistry.has(CONTAINER_MANAGER_MODULE_KEY)) {
      throw new BadRequestException('Container Manager module is not registered');
    }

    const activeAddons = await this.subscriptionAddonsRepository.findActiveBySubscriptionId(subscriptionId);
    const hasModule = activeAddons.some(
      (row) =>
        row.status === 'active' &&
        row.addon?.implementationType === 'module' &&
        row.addon.moduleKey === CONTAINER_MANAGER_MODULE_KEY,
    );

    if (!hasModule) {
      throw new NotFoundException('Container Manager is not enabled for this service');
    }

    const item = await this.subscriptionItemsRepository.findByIdAndSubscriptionId(itemId, subscriptionId);

    if (!item || item.provisioningStatus !== ProvisioningStatus.ACTIVE || !item.providerReference?.trim()) {
      throw new NotFoundException(`Subscription item ${itemId} not found`);
    }

    return item;
  }

  private resolvePublicIp(item: { serverInfoSnapshot?: Record<string, unknown> | null }): string {
    const snapshot = item.serverInfoSnapshot;
    const ip = snapshot && typeof snapshot['publicIp'] === 'string' ? snapshot['publicIp'].trim() : '';

    // Only allow literal IPv4/IPv6 hosts — blocks hostnames / shell metacharacters if a snapshot is poisoned.
    if (!ip || isIP(ip) === 0) {
      throw new BadRequestException('Service public IP is not available');
    }

    return ip;
  }

  private assertSafeDockerContainerId(containerId: string): string {
    const trimmed = containerId.trim();

    if (!DOCKER_CONTAINER_ID_PATTERN.test(trimmed)) {
      throw new BadRequestException('Invalid container id');
    }

    return trimmed;
  }

  private normalizeLogTail(raw: number | undefined): number {
    if (raw == null || !Number.isFinite(raw)) {
      return DEFAULT_LOG_TAIL;
    }

    const rounded = Math.trunc(raw);

    if (rounded < 1) {
      return DEFAULT_LOG_TAIL;
    }

    return Math.min(rounded, MAX_LOG_TAIL);
  }

  private normalizeLogOutput(raw: string): { lines: string[]; truncated: boolean } {
    const normalized = raw.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    let truncated = false;
    let payload = normalized;

    if (payload.length > MAX_LOG_PAYLOAD_CHARS) {
      truncated = true;
      payload = payload.slice(payload.length - MAX_LOG_PAYLOAD_CHARS);
      const firstNewline = payload.indexOf('\n');

      if (firstNewline >= 0 && firstNewline < payload.length - 1) {
        payload = payload.slice(firstNewline + 1);
      }
    }

    const lines = payload.split('\n').filter((line, index, all) => !(index === all.length - 1 && line === ''));

    return { lines, truncated };
  }

  private async execDockerJson(host: string, privateKey: string, command: string): Promise<string> {
    const result = await this.sshExecutor.exec(host, SSH_PORT, SSH_USER, privateKey, command, {
      commandTimeoutMs: DEFAULT_SSH_TIMEOUT_MS,
    });

    if (result.code !== 0) {
      this.logger.warn(`Docker command failed on ${host}: exit ${result.code}`);
      throw new Error('Docker command failed');
    }

    return result.stdout ?? '';
  }

  /** Read-only host commands (`ip -j …`); same SSH timeout/quoting rules as Docker JSON exec. */
  private async execHostJson(host: string, privateKey: string, command: string): Promise<string> {
    const result = await this.sshExecutor.exec(host, SSH_PORT, SSH_USER, privateKey, command, {
      commandTimeoutMs: DEFAULT_SSH_TIMEOUT_MS,
    });

    if (result.code !== 0) {
      this.logger.warn(`Host command failed on ${host}: exit ${result.code}`);
      throw new Error('Host command failed');
    }

    return result.stdout ?? '';
  }

  private parseNdjson(raw: string): Array<Record<string, unknown>> {
    return raw
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line) as Record<string, unknown>;
        } catch {
          return null;
        }
      })
      .filter((row): row is Record<string, unknown> => row !== null);
  }

  private parseJsonArray(raw: string): unknown[] {
    try {
      const parsed = JSON.parse(raw) as unknown;

      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }

  private mapStatsRow(row: Record<string, unknown>) {
    const cpuPercent = this.parsePercent(row['CPUPerc'] ?? row['cpu_percent']);
    const memPerc = this.parsePercent(row['MemPerc'] ?? row['memory_percent']);
    const memUsage = this.parseMemUsage(String(row['MemUsage'] ?? ''));
    const blockIo = this.parsePairBytes(String(row['BlockIO'] ?? ''));
    const netIo = this.parsePairBytes(String(row['NetIO'] ?? ''));

    return {
      cpuPercent,
      memoryUsageBytes: memUsage.used,
      memoryLimitBytes: memUsage.limit,
      memoryPercent: memPerc,
      blockReadBytes: blockIo.a,
      blockWriteBytes: blockIo.b,
      networkRxBytes: netIo.a,
      networkTxBytes: netIo.b,
    };
  }

  private parsePercent(value: unknown): number | null {
    if (typeof value === 'number' && Number.isFinite(value)) {
      return value;
    }

    if (typeof value !== 'string') {
      return null;
    }

    const n = Number.parseFloat(value.replace('%', '').trim());

    return Number.isFinite(n) ? n : null;
  }

  private parseMemUsage(raw: string): { used: number | null; limit: number | null } {
    const parts = raw.split('/').map((p) => p.trim());

    return {
      used: parts[0] ? this.parseByteSize(parts[0]) : null,
      limit: parts[1] ? this.parseByteSize(parts[1]) : null,
    };
  }

  private parsePairBytes(raw: string): { a: number | null; b: number | null } {
    const parts = raw.split('/').map((p) => p.trim());

    return {
      a: parts[0] ? this.parseByteSize(parts[0]) : null,
      b: parts[1] ? this.parseByteSize(parts[1]) : null,
    };
  }

  private parseByteSize(raw: string): number | null {
    const match = raw.trim().match(/^([\d.]+)\s*([KMGTP]?i?B)?$/i);

    if (!match) {
      return null;
    }

    const value = Number.parseFloat(match[1]);
    const unit = (match[2] ?? 'B').toUpperCase();

    if (!Number.isFinite(value)) {
      return null;
    }

    const factors: Record<string, number> = {
      B: 1,
      KB: 1000,
      MB: 1000 ** 2,
      GB: 1000 ** 3,
      TB: 1000 ** 4,
      KIB: 1024,
      MIB: 1024 ** 2,
      GIB: 1024 ** 3,
      TIB: 1024 ** 4,
    };

    return value * (factors[unit] ?? 1);
  }

  private shellQuote(value: string): string {
    // Reject values that cannot be safely represented in a single-quoted SSH remote command.
    if (!value || value.includes('\0') || /[\r\n]/.test(value)) {
      throw new BadRequestException('Invalid docker network name');
    }

    return `'${value.replace(/'/g, `'\\''`)}'`;
  }

  private async publishCollectionFailed(subscriptionId: string, itemId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);

    this.logger.warn(`Container Manager collection failed for item ${itemId}: ${message}`);

    try {
      const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
      const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);
      const addons = await this.subscriptionAddonsRepository.findActiveBySubscriptionId(subscriptionId);
      const row = addons.find((a) => a.addon?.moduleKey === CONTAINER_MANAGER_MODULE_KEY);

      if (!row?.addon) {
        return;
      }

      this.billingNotificationPublisher.publish(
        'addon.collection_failed',
        {
          subscriptionId,
          itemId,
          addonId: row.addon.id,
          addonKey: row.addon.key,
          addonName: row.addon.name,
          planId: plan.id,
          planName: plan.name,
          errorMessage: 'Unable to collect container information',
        },
        subscription.userId,
      );
    } catch (publishError: unknown) {
      const publishMessage = publishError instanceof Error ? publishError.message : String(publishError);

      this.logger.warn(`Failed to publish container manager collection failure: ${publishMessage}`);
    }
  }
}
