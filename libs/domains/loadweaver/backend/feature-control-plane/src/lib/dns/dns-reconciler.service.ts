import type { DesiredState } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { DnsProviderSpec, DnsZoneSpec } from '@forepath/loadweaver/shared/util-model';
import { DnsProviderRegistry, type DnsProvider } from '@forepath/shared/backend/util-hosting-providers';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { ClusterEntity } from '../entities/cluster.entity';
import { DnsZoneStatusEntity } from '../entities/dns-zone-status.entity';
import { DnsFailoverStateEntity } from '../entities/dns-failover.entity';
import { NodeDesiredStateEntity } from '../entities/node-desired-state.entity';
import { PublicAddressEntity } from '../entities/public-address.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { PlatformCredentialsService } from '../services/platform-credentials.service';
import { reconcileZone } from './dns-reconcile.utils';
import { DnsService, dnsProviders, dnsZones } from './dns.service';
import { querySoaSerial, secondaryDrift, type SoaQuery } from './propagation';
import { writesPaused } from '../database-handover/database-target.runtime';

const TICK_MS = 30_000;
const ADVISORY_LOCK_DNS = 0x4c57000e;

/**
 * Keeps the providers' zones in line with the desired records (3.15), leader-elected: every API provider of a zone
 * (primary and secondaries) gets the same records; names other owners manage are reported, never changed. The
 * hosted bind9 receives rendered zones through the desired state instead.
 */
@Injectable()
export class DnsReconcilerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DnsReconcilerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private readonly zoneIds = new Map<string, string>();
  /** Overridable for tests. */
  soaQuery: SoaQuery = querySoaSerial;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly dns: DnsService,
    private readonly providers: DnsProviderRegistry,
    private readonly credentials: PlatformCredentialsService,
  ) {}

  onApplicationBootstrap(): void {
    if ((process.env.LOADWEAVER_WORKLOAD_CONTROLLER ?? 'on') === 'off') return;

    this.timer = setInterval(() => void this.safeTick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (writesPaused('DNS', this.logger)) return;

    if (this.running) return;

    this.running = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`DNS: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  private async zoneId(provider: DnsProvider, key: string, zone: string, configured?: string): Promise<string> {
    if (configured) return configured;

    const cached = this.zoneIds.get(key);

    if (cached) return cached;

    const found = (await provider.listZones()).find((z) => z.name === zone);

    if (!found) throw new Error(`zone ${zone} does not exist at the provider`);

    this.zoneIds.set(key, found.id);

    return found.id;
  }

  /** One pass over every zone and provider; returns the number of changes made. */
  async tick(): Promise<number> {
    const runner = this.dataSource.createQueryRunner();

    await runner.connect();

    try {
      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [ADVISORY_LOCK_DNS]);

      if (!locked) return 0;

      try {
        return await this.reconcile();
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_DNS]);
      }
    } finally {
      await runner.release();
    }
  }

  private async reconcile(): Promise<number> {
    const resources = await this.dataSource.getRepository(ResourceEntity).find();
    const cluster = await this.dataSource.getRepository(ClusterEntity).findOneOrFail({ where: {} });
    const addresses = await this.dataSource.getRepository(PublicAddressEntity).find({ where: { state: 'assigned' } });
    const failoverStates = new Map(
      (await this.dataSource.getRepository(DnsFailoverStateEntity).find()).map((r) => [r.name, r.state]),
    );
    const desired = this.dns.desired(resources, addresses, failoverStates);
    const zones = dnsZones(resources);
    const providers = dnsProviders(resources);
    const statusRepo = this.dataSource.getRepository(DnsZoneStatusEntity);
    let total = 0;

    if (desired.errors.length > 0)
      this.logger.warn(`DNS desired state has errors, keeping zones as they are: ${desired.errors.join('; ')}`);

    const hostedOn = await this.hostedAddresses();

    for (const [zoneName, zone] of zones) {
      await this.checkTransfers(zoneName, zone, providers, hostedOn.get(zone.zone) ?? []);

      for (const providerName of [zone.provider, ...zone.secondaries]) {
        const spec = providers.get(providerName);

        if (!spec || spec.type === 'bind9' || spec.type === 'axfr' || !spec.credentials) continue;

        const status = statusRepo.create({
          zone: zoneName,
          provider: providerName,
          syncedAt: null,
          error: null,
          conflicts: [],
          changes: 0,
          drift: null,
        });

        try {
          if (desired.errors.length > 0) throw new Error('desired records have errors');

          const provider = this.providers.create(spec.type, {
            ...(spec.options ?? {}),
            ...(await this.credentials.providerConfig(spec.credentials)),
          });
          const zoneId = await this.zoneId(
            provider,
            `${providerName}/${zone.zone}`,
            zone.zone,
            providerName === zone.provider ? zone.providerZoneId : undefined,
          );
          const ops = reconcileZone(
            desired.records.filter((r) => r.zone === zoneName),
            await provider.listRecords(zoneId),
            cluster.clusterId,
          );

          for (const record of ops.upsert) await provider.upsertRecord(zoneId, record);

          for (const id of ops.delete) await provider.deleteRecord(zoneId, id);

          Object.assign(status, {
            syncedAt: new Date(),
            conflicts: ops.conflicts,
            changes: ops.upsert.length + ops.delete.length,
          });
          total += status.changes;
        } catch (error) {
          status.error = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
          this.logger.warn(`DNS zone ${zone.zone} at ${providerName}: ${status.error}`);
        }

        await statusRepo.save(status);
      }
    }

    return total;
  }

  /** Addresses the hosted bind9 instances answer a zone on, from their desired state. */
  private async hostedAddresses(): Promise<Map<string, string[]>> {
    const rows = await this.dataSource.getRepository(NodeDesiredStateEntity).find();
    const result = new Map<string, string[]>();

    for (const row of rows) {
      const dns = (row.state as DesiredState).authoritativeDns;

      for (const zone of dns?.zones ?? [])
        result.set(zone.name, [...new Set([...(result.get(zone.name) ?? []), ...dns!.listen])].sort());
    }

    return result;
  }

  /**
   * Zone transfers (3.15): AXFR secondaries pulling from hosted bind9, or hosted bind9 pulling from an external
   * primary. The secondaries' SOA serials are compared with the primary's; drift is reported on the zone.
   */
  private async checkTransfers(
    zoneName: string,
    zone: DnsZoneSpec,
    providers: ReadonlyMap<string, DnsProviderSpec>,
    hosted: readonly string[],
  ): Promise<void> {
    const primary = providers.get(zone.provider);
    const pairs: { provider: string; primaries: readonly string[]; secondaries: readonly string[] }[] = [];

    if (primary?.type === 'axfr') {
      const bind9 = zone.secondaries.find((s) => providers.get(s)?.type === 'bind9');

      if (bind9) pairs.push({ provider: bind9, primaries: primary.servers ?? [], secondaries: hosted });
    } else if (primary?.type === 'bind9') {
      for (const s of zone.secondaries.filter((p) => providers.get(p)?.type === 'axfr'))
        pairs.push({ provider: s, primaries: hosted, secondaries: providers.get(s)?.servers ?? [] });
    }

    for (const pair of pairs) {
      const status = this.dataSource.getRepository(DnsZoneStatusEntity).create({
        zone: zoneName,
        provider: pair.provider,
        syncedAt: new Date(),
        error: null,
        conflicts: [],
        changes: 0,
        drift: null,
      });

      try {
        status.drift = await secondaryDrift(zone.zone, pair.primaries, pair.secondaries, this.soaQuery);
      } catch (error) {
        status.error = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      }

      if (status.drift) this.logger.warn(`DNS zone ${zone.zone}: secondary drift at ${pair.provider}: ${status.drift}`);

      await this.dataSource.getRepository(DnsZoneStatusEntity).save(status);
    }
  }
}
