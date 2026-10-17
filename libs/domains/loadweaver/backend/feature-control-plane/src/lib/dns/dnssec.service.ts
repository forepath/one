import { dnssecDs, dnssecKeyTag, formatDs, generateDnssecKey } from '@forepath/loadweaver/shared/util-pki';
import { RegistrarProviderRegistry } from '@forepath/shared/backend/util-hosting-providers';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In } from 'typeorm';

import { DnssecKeyEntity } from '../entities/dnssec-key.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { AuditLogService } from '../services/audit-log.service';
import { NetworkStateService } from '../services/network-state.service';
import { PlatformCredentialsService } from '../services/platform-credentials.service';
import { dnsProviders, dnsZones } from './dns.service';
import { currentKey, dnssecActions, dnssecMode, DNSSEC_ROLLOVER_AFTER_MS, expectedDs, sameDs } from './dnssec.utils';
import { lookupDsAtParent, type DsLookup } from './ds-lookup';

const TICK_MS = 10 * 60_000;
const ADVISORY_LOCK_DNSSEC = 0x4c570010;

export interface DnssecZoneSummary {
  zone: string;
  name: string;
  mode: 'signed' | 'insecure' | null;
  registrar: string | null;
  /** What the parent should publish now (by hand without a registrar). */
  expectedDs: string[];
  keys: {
    keyTag: number;
    state: 'active' | 'retired';
    createdAt: string;
    retiredAt: string | null;
    dsAtParent: boolean;
    dsCheckedAt: string | null;
    ds: string;
  }[];
  nextRolloverAt: string | null;
}

/**
 * DNSSEC for bind9-hosted zones (3.15): keys generated here and pushed to every bind9 instance, which sign with them;
 * yearly rollovers by adding a successor once the current key's DS is at the parent (bind then keeps both keys until
 * it sees the new DS at the parent itself); DS records published through a registrar plugin or shown for doing it by
 * hand; turning DNSSEC off goes insecure first. Leader-elected with a session lock (registrar calls take time).
 */
@Injectable()
export class DnssecService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DnssecService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Overridable for tests. */
  dsLookup: DsLookup = lookupDsAtParent;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly network: NetworkStateService,
    private readonly credentials: PlatformCredentialsService,
    private readonly registrars: RegistrarProviderRegistry,
    private readonly audit: AuditLogService,
  ) {}

  onApplicationBootstrap(): void {
    if ((process.env.LOADWEAVER_WORKLOAD_CONTROLLER ?? 'on') === 'off') return;

    this.timer = setInterval(() => void this.safeTick(), TICK_MS);
    // New zones get their key without waiting for the first interval.
    setTimeout(() => void this.safeTick(), 5_000).unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (this.running) return;

    this.running = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`DNSSEC: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** One pass over every zone; returns whether keys changed (and the name servers got new ones). */
  async tick(now = new Date()): Promise<boolean> {
    const runner = this.dataSource.createQueryRunner();

    await runner.connect();

    try {
      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [ADVISORY_LOCK_DNSSEC]);

      if (!locked) return false;

      try {
        return await this.reconcile(now);
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_DNSSEC]);
      }
    } finally {
      await runner.release();
    }
  }

  private async reconcile(now: Date): Promise<boolean> {
    const resources = await this.dataSource
      .getRepository(ResourceEntity)
      .find({ where: { kind: In(['DnsZone', 'DnsProvider']) } });
    const zones = dnsZones(resources);
    const providers = dnsProviders(resources);
    const repo = this.dataSource.getRepository(DnssecKeyEntity);
    const all = await repo.find();
    let changed = false;

    // Keys of zones that no longer exist go with them.
    const orphans = all.filter((k) => !zones.has(k.zone));

    if (orphans.length > 0) {
      await repo.delete({ id: In(orphans.map((k) => k.id)) });
      changed = true;
    }

    for (const [name, zone] of zones) {
      let keys = all.filter((k) => k.zone === name);
      const signedHere = providers.get(zone.provider)?.type === 'bind9';

      if (!signedHere || (!zone.dnssec && keys.length === 0)) continue;

      if (keys.length > 0) await this.checkParent(zone.zone, keys, now);

      for (const action of dnssecActions(zone.dnssec, keys, now)) {
        if (action.type === 'create') {
          let material = generateDnssecKey();

          // A key tag shared with another key of the zone would share its file names on the name servers.
          while (keys.some((k) => k.keyTag === dnssecKeyTag(material.publicKey))) material = generateDnssecKey();

          const created = await repo.save(
            repo.create({
              zone: name,
              keyTag: dnssecKeyTag(material.publicKey),
              publicKey: material.publicKey,
              privateKey: material.privateKey,
              // Successors must be newer than the key they replace: bind picks the newest as successor.
              createdAt: now,
            }),
          );

          keys = [...keys, created];
          await this.audit.recordStandalone({
            actor: { type: 'system' },
            action: keys.length > 1 ? 'dnssec.rollover-started' : 'dnssec.key-created',
            target: `dns-zone/${name}`,
            details: { keyTag: created.keyTag, ds: formatDs(zone.zone, dnssecDs(zone.zone, created.publicKey)) },
          });
        } else if (action.type === 'retire') {
          await repo.update({ id: action.id }, { retiredAt: now });
          keys = keys.map((k) => (k.id === action.id ? { ...k, retiredAt: now } : k));
        } else {
          const removed = keys.find((k) => k.id === action.id);

          await repo.delete({ id: action.id });
          keys = keys.filter((k) => k.id !== action.id);
          await this.audit.recordStandalone({
            actor: { type: 'system' },
            action: 'dnssec.key-removed',
            target: `dns-zone/${name}`,
            details: { keyTag: removed?.keyTag },
          });
        }

        changed = true;
      }

      // Also when DNSSEC was turned off: the registrar withdraws the DS, then the keys can go.
      if (zone.registrar && (zone.dnssec || keys.length > 0))
        await this.publishDs(name, zone.zone, zone.registrar, zone.dnssec, keys, now);
    }

    if (changed) this.network.requestRecompile('DNSSEC keys');

    return changed;
  }

  /** Records which keys' DS the parent publishes; a failed lookup changes nothing. */
  private async checkParent(zone: string, keys: DnssecKeyEntity[], now: Date): Promise<void> {
    const ds = await this.dsLookup(zone).catch(() => null);

    if (ds === null) return;

    const repo = this.dataSource.getRepository(DnssecKeyEntity);

    for (const key of keys) {
      const own = dnssecDs(zone, key.publicKey);
      const at = ds.some(
        (d) =>
          d.keyTag === own.keyTag &&
          d.algorithm === own.algorithm &&
          d.digestType === own.digestType &&
          d.digest.toUpperCase() === own.digest,
      );

      key.dsAtParent = at;
      key.dsAbsentSince = at ? null : (key.dsAbsentSince ?? now);
      key.dsPresentSince = at ? (key.dsPresentSince ?? now) : null;
      key.dsCheckedAt = now;
      await repo.update(
        { id: key.id },
        {
          dsAtParent: key.dsAtParent,
          dsAbsentSince: key.dsAbsentSince,
          dsPresentSince: key.dsPresentSince,
          dsCheckedAt: now,
        },
      );
    }
  }

  private async publishDs(
    name: string,
    zone: string,
    registrar: { type: string; credentials: string; options?: Record<string, string> },
    enabled: boolean,
    keys: readonly DnssecKeyEntity[],
    now: Date,
  ): Promise<void> {
    const expected = expectedDs(zone, enabled, keys, now);

    // Signing but no key yet: nothing to publish. Not signing: publish "none".
    if (enabled && expected.length === 0) return;

    try {
      const provider = this.registrars.create(registrar.type, {
        ...(registrar.options ?? {}),
        ...(await this.credentials.providerConfig(registrar.credentials)),
      });

      if (sameDs(await provider.listDs(zone), expected)) return;

      await provider.setDs(zone, expected);
      await this.audit.recordStandalone({
        actor: { type: 'system' },
        action: 'dnssec.ds-published',
        target: `dns-zone/${name}`,
        details: { registrar: registrar.type, ds: expected.map((d) => formatDs(zone, d)) },
      });
    } catch (error) {
      this.logger.warn(
        `DNSSEC: DS for ${zone} at ${registrar.type}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  /** Keys the name servers of a zone get (private keys separately, at push time). */
  async zoneKeys(): Promise<Map<string, { mode: 'signed' | 'insecure'; keys: DnssecKeyEntity[] }>> {
    const resources = await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'DnsZone' } });
    const zones = dnsZones(resources);
    const keys = await this.dataSource.getRepository(DnssecKeyEntity).find({ order: { createdAt: 'ASC' } });
    const result = new Map<string, { mode: 'signed' | 'insecure'; keys: DnssecKeyEntity[] }>();

    for (const [name, zone] of zones) {
      const own = keys.filter((k) => k.zone === name);
      const mode = dnssecMode(zone.dnssec, own);

      if (mode) result.set(zone.zone, { mode, keys: own });
    }

    return result;
  }

  /** Private keys by public key, for the push to the name servers. */
  async privateKeys(publicKeys: readonly string[]): Promise<Map<string, string>> {
    if (publicKeys.length === 0) return new Map();

    const rows = await this.dataSource
      .getRepository(DnssecKeyEntity)
      .find({ where: { publicKey: In([...new Set(publicKeys)]) } });

    return new Map(rows.map((r) => [r.publicKey, r.privateKey]));
  }

  async summary(): Promise<DnssecZoneSummary[]> {
    const resources = await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'DnsZone' } });
    const zones = dnsZones(resources);
    const keys = await this.dataSource.getRepository(DnssecKeyEntity).find({ order: { createdAt: 'ASC' } });
    const now = new Date();

    return [...zones]
      .filter(([name, zone]) => zone.dnssec || keys.some((k) => k.zone === name))
      .map(([name, zone]) => {
        const own = keys.filter((k) => k.zone === name);
        const current = currentKey(own);

        return {
          zone: zone.zone,
          name,
          mode: dnssecMode(zone.dnssec, own),
          registrar: zone.registrar?.type ?? null,
          expectedDs: expectedDs(zone.zone, zone.dnssec, own, now).map((d) => formatDs(zone.zone, d)),
          keys: own.map((k) => ({
            keyTag: k.keyTag,
            state: k.retiredAt ? ('retired' as const) : ('active' as const),
            createdAt: k.createdAt.toISOString(),
            retiredAt: k.retiredAt?.toISOString() ?? null,
            dsAtParent: k.dsAtParent,
            dsCheckedAt: k.dsCheckedAt?.toISOString() ?? null,
            ds: formatDs(zone.zone, dnssecDs(zone.zone, k.publicKey)),
          })),
          nextRolloverAt:
            zone.dnssec && current
              ? new Date(current.createdAt.getTime() + DNSSEC_ROLLOVER_AFTER_MS).toISOString()
              : null,
        };
      });
  }
}
