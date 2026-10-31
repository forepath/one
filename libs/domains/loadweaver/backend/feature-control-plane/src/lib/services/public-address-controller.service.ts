import { nodeGroupSpecSchema } from '@forepath/loadweaver/shared/util-model';
import { FailoverIpProviderRegistry } from '@forepath/shared/backend/util-hosting-providers';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';

import { NodeEntity } from '../entities/node.entity';
import { PublicAddressEntity } from '../entities/public-address.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { ipPools } from '../ipam/public-address.service';
import { holderNodes } from '../ipam/public-address-state.utils';
import { chooseHolder, holderCandidates } from '../ipam/public-ipam.utils';
import { AuditLogService } from './audit-log.service';
import { NetworkStateService } from './network-state.service';
import { PlatformCredentialsService } from './platform-credentials.service';
import { writesPaused } from '../database-handover/database-target.runtime';

const TICK_MS = 5_000;
const ADVISORY_LOCK_PUBLIC_ADDRESS_CONTROLLER = 0x4c57000c;
/** Provider label of a node's server id; without it the server is looked up by the node name. */
export const PROVIDER_SERVER_ID_LABEL = 'loadweaver.com/provider-server-id';

/**
 * Keeps every public address on a healthy holder (3.6), leader-elected: picks holders from the pool's node group
 * (the current one stays while it can), and moves provider failover IPs through the provider API. VRRP and BGP
 * addresses fail over on the nodes themselves within seconds; the holder here only sets their preference.
 */
@Injectable()
export class PublicAddressControllerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PublicAddressControllerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly network: NetworkStateService,
    private readonly audit: AuditLogService,
    private readonly credentials: PlatformCredentialsService,
    private readonly providers: FailoverIpProviderRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if ((process.env.LOADWEAVER_WORKLOAD_CONTROLLER ?? 'on') === 'off') return;

    this.timer = setInterval(() => void this.safeTick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (writesPaused('Public addresses', this.logger)) return;

    if (this.running) return;

    this.running = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`Public addresses: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** One pass; returns the addresses whose holder changed. */
  async tick(now = Date.now()): Promise<string[]> {
    const moved = await this.dataSource.transaction(async (manager) => {
      const [{ locked }] = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        ADVISORY_LOCK_PUBLIC_ADDRESS_CONTROLLER,
      ]);

      if (!locked) return [];

      const resources = await manager
        .getRepository(ResourceEntity)
        .find({ where: [{ kind: 'IpPool' }, { kind: 'NodeGroup' }] });
      const pools = ipPools(resources);
      const groups = new Map(
        resources.filter((r) => r.kind === 'NodeGroup').map((r) => [r.name, nodeGroupSpecSchema.parse(r.spec)]),
      );
      const nodes = await manager
        .getRepository(NodeEntity)
        .find({ where: { lifecycle: Not('left') }, order: { name: 'ASC' } });
      const holders = holderNodes(nodes, now);
      const repo = manager.getRepository(PublicAddressEntity);
      const changed: string[] = [];

      for (const row of await repo.find({ where: { state: 'assigned' } })) {
        const pool = pools.get(row.pool);

        if (!pool) continue;

        const next = chooseHolder(row.holder, holderCandidates(groups.get(pool.nodeGroup), holders));

        if (next === row.holder) continue;

        if (pool.failover === 'provider' && pool.provider && next) {
          const node = nodes.find((n) => n.name === next);
          const serverId = node?.labels?.[PROVIDER_SERVER_ID_LABEL];
          // The provider call happens before the holder is recorded: a failed call is retried on the next tick.
          const provider = this.providers.create(pool.provider.type, {
            ...(pool.provider.options ?? {}),
            ...(await this.credentials.providerConfig(pool.provider.credentials)),
          });

          await provider.assign(row.address, serverId ? { id: serverId } : { name: next });
        }

        await repo.update({ address: row.address }, { holder: next });
        await this.audit.record(manager, {
          actor: { type: 'system' },
          action: 'public-address.holder',
          target: `public-address/${row.address}`,
          details: { from: row.holder, to: next, failover: pool.failover },
        });
        changed.push(row.address);
      }

      return changed;
    });

    if (moved.length > 0) this.network.requestRecompile('public address holders');

    return moved;
  }
}
