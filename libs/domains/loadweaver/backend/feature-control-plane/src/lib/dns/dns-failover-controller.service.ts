import { resolve4, resolveNs } from 'node:dns/promises';

import { nodeGroupSpecSchema, siteSpecSchema } from '@forepath/loadweaver/shared/util-model';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Not } from 'typeorm';

import { DnsFailoverStateEntity, ProbeResultEntity } from '../entities/dns-failover.entity';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { AuditLogService } from '../services/audit-log.service';
import { NetworkStateService } from '../services/network-state.service';
import { plannerNodes } from '../services/workload-planner.service';
import { hasControlPlaneQuorum } from '../utils/control-plane-membership.utils';
import { DnsReconcilerService } from './dns-reconciler.service';
import { dnsFailovers, evaluateFailover, probeId, type ProbeVote } from './dns-failover.utils';
import { zoneFor } from './dns-desired.utils';
import { dnsProviders, dnsZones } from './dns.service';
import { bind9Nodes, nameServerAddresses } from './hosted-zones.utils';
import { queryAuthoritative, verifyPropagation, type AuthoritativeQuery } from './propagation';
import { chooseLatency } from './steering.utils';
import { writesPaused } from '../database-handover/database-target.runtime';

const TICK_MS = 5_000;
const ADVISORY_LOCK_DNS_FAILOVER = 0x4c57000f;

/**
 * The DNS failover engine (3.28), leader-elected: one round per tick from the probe results the agents report,
 * a switch needs a probe majority and control-plane quorum, every switch is audited (and alerts, 3.18) and pushed to
 * every provider of the zone and the hosted bind9.
 */
@Injectable()
export class DnsFailoverControllerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DnsFailoverControllerService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly network: NetworkStateService,
    private readonly dnsReconciler: DnsReconcilerService,
    private readonly audit: AuditLogService,
  ) {}

  onApplicationBootstrap(): void {
    if ((process.env.LOADWEAVER_WORKLOAD_CONTROLLER ?? 'on') === 'off') return;

    this.timer = setInterval(() => void this.safeTick(), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async safeTick(): Promise<void> {
    if (writesPaused('DNS failover', this.logger)) return;

    if (this.running) return;

    this.running = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`DNS failover: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** One round; returns the failovers whose answer changed. */
  async tick(now = new Date()): Promise<string[]> {
    const switched = await this.dataSource.transaction(async (manager) => {
      const [{ locked }] = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        ADVISORY_LOCK_DNS_FAILOVER,
      ]);

      if (!locked) return [];

      const resources = await manager
        .getRepository(ResourceEntity)
        .find({ where: { kind: In(['DnsFailover', 'Site']) } });
      const siteLocations = new Map(
        resources
          .filter((r) => r.kind === 'Site')
          .flatMap((r) => {
            const location = siteSpecSchema.parse(r.spec).location;

            return location ? [[r.name, location] as const] : [];
          }),
      );
      const failovers = dnsFailovers(resources);
      const nodes = await manager.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
      const reachable = new Set(
        plannerNodes(nodes, now.getTime())
          .filter((n) => n.reachable)
          .map((n) => n.name),
      );
      // Only the part of the cluster that holds quorum may fail endpoints over.
      const quorum = hasControlPlaneQuorum(nodes, reachable);
      const results = await manager.getRepository(ProbeResultEntity).find();
      const stateRepo = manager.getRepository(DnsFailoverStateEntity);
      const changed: string[] = [];

      for (const stale of (await stateRepo.find()).filter((s) => !failovers.has(s.name)))
        await stateRepo.delete({ name: stale.name });

      for (const [name, spec] of failovers) {
        const row = await stateRepo.findOne({ where: { name } });
        const votes = new Map<string, ProbeVote[]>(
          spec.endpoints.map((e) => [
            e.name,
            results.filter((r) => r.probeId === probeId(name, e.name)).map((r) => ({ ok: r.ok, at: r.at })),
          ]),
        );
        const decision = evaluateFailover(spec, row?.state, votes, now, quorum, row?.failbackConfirmed ?? false);

        // Latency steering (3.28): fresh latencies by probing site, decided with hysteresis.
        if (spec.mode === 'latency') {
          const siteOf = new Map(nodes.map((n) => [n.name, n.site]));
          const latency = new Map(
            spec.endpoints.map((e) => {
              const bySite = new Map<string, number[]>();

              for (const r of results.filter(
                (r) =>
                  r.probeId === probeId(name, e.name) &&
                  r.ok &&
                  r.latencyMs !== null &&
                  now.getTime() - r.at.getTime() <= spec.intervalSeconds * 3_000,
              )) {
                const site = siteOf.get(r.node);

                if (site) bySite.set(site, [...(bySite.get(site) ?? []), r.latencyMs as number]);
              }

              return [
                e.name,
                new Map([...bySite].map(([site, ms]) => [site, ms.reduce((a, b) => a + b, 0) / ms.length])),
              ] as const;
            }),
          );
          const choice = chooseLatency(decision.state.active, latency, siteLocations, row?.state.latency);

          if (JSON.stringify(choice) !== JSON.stringify(row?.state.latency ?? null)) decision.changed = !!row;

          decision.state = { ...decision.state, latency: choice };
        }
        const addresses = (names: string[]) => names.map((n) => spec.endpoints.find((e) => e.name === n)?.address);

        await stateRepo.save(
          stateRepo.create({
            name,
            state: decision.state,
            switchedAt: decision.changed && row ? now : (row?.switchedAt ?? null),
            failbackConfirmed: false,
          }),
        );

        if (decision.changed && row) {
          changed.push(name);
          await this.audit.record(manager, {
            actor: { type: 'system' },
            action: 'dns-failover.switch',
            target: `dns-failover/${name}`,
            details: {
              host: spec.host,
              from: addresses(row.state.active),
              to: addresses(decision.state.active),
              unhealthy: spec.endpoints.filter((e) => !decision.state.endpoints[e.name].healthy).map((e) => e.name),
            },
          });
        }
      }

      return changed;
    });

    if (switched.length > 0) {
      this.logger.log(`DNS failover switched: ${switched.join(', ')}`);
      this.network.requestRecompile('dns failover');
      void this.dnsReconciler
        .tick()
        .catch((error: unknown) =>
          this.logger.warn(`DNS sync after failover: ${error instanceof Error ? error.message : String(error)}`),
        )
        .then(() => Promise.all(switched.map((name) => this.verify(name))))
        .catch((error: unknown) =>
          this.logger.warn(`DNS propagation check: ${error instanceof Error ? error.message : String(error)}`),
        );
    }

    return switched;
  }

  /** Probe results from an agent, accepted only for probes assigned to that node. */
  async record(
    node: string,
    assigned: ReadonlySet<string>,
    results: { id: string; ok: boolean; latencyMs?: number; error?: string }[],
    at = new Date(),
  ): Promise<void> {
    const repo = this.dataSource.getRepository(ProbeResultEntity);

    for (const r of results.filter((x) => assigned.has(x.id))) {
      await repo.save(
        repo.create({ probeId: r.id, node, ok: r.ok, latencyMs: r.latencyMs ?? null, error: r.error ?? null, at }),
      );
    }
  }

  /** Authoritative servers of the zone holding a host: the hosted bind9 nodes and the zone's NS hosts. */
  protected async nameServers(host: string): Promise<string[]> {
    const resources = await this.dataSource
      .getRepository(ResourceEntity)
      .find({ where: [{ kind: 'DnsZone' }, { kind: 'DnsProvider' }, { kind: 'NodeGroup' }] });
    const zones = dnsZones(resources);
    const zone = zones.get(zoneFor(host, zones) ?? '');

    if (!zone) return [];

    const providers = dnsProviders(resources);
    const servers: string[] = [];
    const bind9 = [zone.provider, ...zone.secondaries].map((p) => providers.get(p)).find((p) => p?.type === 'bind9');

    if (bind9) {
      const groups = new Map(
        resources.filter((r) => r.kind === 'NodeGroup').map((r) => [r.name, nodeGroupSpecSchema.parse(r.spec)]),
      );
      const nodes = await this.dataSource.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });

      servers.push(...bind9Nodes(bind9, groups, nodes).flatMap(nameServerAddresses));
    }

    if ([zone.provider, ...zone.secondaries].some((p) => providers.get(p)?.type !== 'bind9')) {
      const ns = await resolveNs(zone.zone).catch(() => [] as string[]);

      for (const name of ns) servers.push(...(await resolve4(name).catch(() => [] as string[])));
    }

    return [...new Set(servers)];
  }

  /** A switch counts as done only once every authoritative server answers it (3.28); lagging ones alert. */
  async verify(name: string): Promise<void> {
    const spec = dnsFailovers(
      await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'DnsFailover' } }),
    ).get(name);
    const row = await this.dataSource.getRepository(DnsFailoverStateEntity).findOne({ where: { name } });

    if (!spec || !row) return;

    const expected = spec.endpoints.filter((e) => row.state.active.includes(e.name)).map((e) => e.address);
    const result = await verifyPropagation(spec.host, expected, await this.nameServers(spec.host), this.query, {
      ...this.propagationOptions,
      subset: spec.mode === 'weighted' || spec.mode === 'geo' || spec.mode === 'latency',
    });

    await this.dataSource.transaction(async (manager) => {
      await manager
        .getRepository(DnsFailoverStateEntity)
        .update({ name }, { propagation: { ...result, checkedAt: new Date().toISOString() } });

      if (!result.done) {
        await this.audit.record(manager, {
          actor: { type: 'system' },
          action: 'dns-failover.lagging',
          target: `dns-failover/${name}`,
          details: { host: spec.host, expected, lagging: result.lagging },
        });
      }
    });
  }

  /** Overridable for tests. */
  query: AuthoritativeQuery = queryAuthoritative;
  propagationOptions: { timeoutMs?: number; intervalMs?: number } = {};

  async states(): Promise<DnsFailoverStateEntity[]> {
    return await this.dataSource.getRepository(DnsFailoverStateEntity).find({ order: { name: 'ASC' } });
  }

  /** Operator confirmation for a `manual` fail-back (e.g. after data was synced back). */
  async confirmFailback(name: string, actor: { type: string; id?: string }): Promise<boolean> {
    return await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(DnsFailoverStateEntity);
      const row = await repo.findOne({ where: { name } });

      if (!row?.state.failbackPending) return false;

      await repo.update({ name }, { failbackConfirmed: true });
      await this.audit.record(manager, {
        actor: actor as never,
        action: 'dns-failover.failback-confirmed',
        target: `dns-failover/${name}`,
      });

      return true;
    });
  }
}
