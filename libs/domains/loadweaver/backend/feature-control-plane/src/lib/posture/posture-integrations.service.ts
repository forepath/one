import type { RequestWithUser } from '@forepath/identity/backend';
import { POSTURE_INTEGRATION_NAME } from '@forepath/loadweaver/shared/util-model';
import { enqueueUnitJob } from '@forepath/shared/backend';
import { InjectQueue } from '@nestjs/bullmq';
import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import type { Queue } from 'bullmq';
import { DataSource } from 'typeorm';

import { LOADWEAVER_QUEUE_NAME } from '../notifications/loadweaver-notification.events';
import { PostureIntegrationEntity } from '../entities/posture-integration.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VpnClientEntity } from '../entities/vpn-client.entity';
import {
  HOSTNAME_MATCH_WARNING,
  POSTURE_MATCH_KEYS,
  PosturePluginRegistry,
  type PostureMatchKey,
  type PosturePluginFactory,
  type PostureVendorDevice,
} from '../remote-access/posture-plugin';
import {
  clientGroups,
  clientValid,
  clientLabel,
  effectiveGroups,
  postureFailures,
} from '../remote-access/remote-access.utils';
import { actorFromRequest, AuditLogService, type AuditActor } from '../services/audit-log.service';
import { ClusterAccessService } from '../services/cluster-access.service';
import { NetworkStateService } from '../services/network-state.service';
import {
  indexVendorDevices,
  integrationFact,
  matchDevice,
  type DeviceIdentifiers,
  type IntegrationFact,
} from './posture-facts';
import { PostureHttp, safeErrorMessage, type FetchLike } from './posture-http';

export const POSTURE_SYNC_COORDINATOR_JOB = 'posture-sync.coordinator';
export const POSTURE_SYNC_UNIT_JOB = 'posture-sync.unit';

export interface PostureSyncPayload {
  integrationId: string;
  /** Slot the job id was built from (idempotent per schedule slot / manual minute). */
  slot: string;
}

const MAX_INTEGRATIONS = 16;
/** A claim older than this is considered abandoned (crashed worker). */
const CLAIM_TIMEOUT_MS = 15 * 60_000;
const MAX_BACKOFF_MS = 6 * 3_600_000;
const SYNC_DEADLINE_MS = 10 * 60_000;

export interface PostureIntegrationDto {
  id: string;
  name: string;
  type: string;
  displayName: string;
  category: 'mdm' | 'edr';
  enabled: boolean;
  /** Non-secret configuration values; secret fields are listed in `secretsSet` instead. */
  config: Record<string, string>;
  secretsSet: string[];
  matchBy: PostureMatchKey[];
  /** The vendor's device user must match the VPN client's owner (plugins with `supportsUserMatch`). */
  requireUserMatch: boolean;
  /** Weak settings worth a warning (matching by hostname, no user match). */
  warnings: string[];
  intervalMinutes: number;
  maxAgeMinutes: number;
  status: 'ok' | 'failing' | 'pending' | 'disabled';
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  failures: number;
  nextSyncAt: string | null;
  vendorDevices: number;
  matchedDevices: number;
}

export interface PostureIntegrationInput {
  name?: string;
  type?: string;
  enabled?: boolean;
  config?: Record<string, string>;
  matchBy?: string[];
  requireUserMatch?: boolean;
  intervalMinutes?: number;
  maxAgeMinutes?: number;
}

export interface PostureSyncOutcome {
  integration: string;
  vendorDevices: number;
  matchedDevices: number;
  changedDevices: number;
}

/** Backoff after consecutive failed syncs: the interval doubled per failure, at most 6 hours. */
export function syncBackoffMs(intervalMinutes: number, failures: number): number {
  return Math.min(MAX_BACKOFF_MS, intervalMinutes * 60_000 * 2 ** Math.max(0, failures - 1));
}

/** Schedule slot of a sync (the job id's idempotency key). */
export function syncSlot(now: number, intervalMinutes: number): string {
  return String(Math.floor(now / (intervalMinutes * 60_000)));
}

/**
 * Identifiers a client offers for matching: only the pinned ones (set at the first report, unique among valid
 * clients). An unpinned value from the last report is never used — it could be another device's.
 */
export function deviceIdentifiers(client: Pick<VpnClientEntity, 'posture'>): DeviceIdentifiers {
  return {
    serial: client.posture?.serialNumber,
    deviceId: client.posture?.deviceId,
    hostname: client.posture?.hostname,
  };
}

/** Warnings for weak matching settings (shown by the API and the console). */
export function integrationWarnings(
  matchBy: readonly string[],
  requireUserMatch: boolean,
  supportsUserMatch: boolean,
): string[] {
  const warnings: string[] = [];

  if (matchBy.includes('hostname')) warnings.push(HOSTNAME_MATCH_WARNING);

  if (supportsUserMatch && !requireUserMatch)
    warnings.push(
      "The device user isn't compared with the VPN client's owner: a device enrolled by someone else could inherit this verdict.",
    );

  return warnings;
}

/** User to require for a client, or `undefined` = no user check (integration setting off / unsupported / machines). */
export function requiredUser(
  client: Pick<VpnClientEntity, 'kind' | 'ownerLabel'>,
  requireUserMatch: boolean,
  supportsUserMatch: boolean,
): string | null | undefined {
  // Machines are enrolled by admins and have no owning user to compare.
  if (!requireUserMatch || !supportsUserMatch || client.kind !== 'user') return undefined;

  return client.ownerLabel.includes('@') ? client.ownerLabel : null;
}

function parseConfig(text: string): Record<string, string> {
  try {
    const parsed = JSON.parse(text) as Record<string, unknown>;

    return Object.fromEntries(Object.entries(parsed).filter(([, v]) => typeof v === 'string')) as Record<
      string,
      string
    >;
  } catch {
    return {};
  }
}

/**
 * Posture integrations (3.31): MDM / EDR connections configured by cluster admins (configuration encrypted at rest,
 * secrets never returned), a connection test, and polling through the queue — a coordinator enqueues one unit job
 * per due integration with an idempotent id; each unit fetches the vendor inventory once (bounded requests,
 * retries / backoff in the HTTP client), matches it to enrolled devices, stores normalized results with the
 * clients and re-evaluates posture: devices that fail move to their restricted group (recompile), with audit
 * entries; the built-in alerts pick up restricted devices and failing integrations.
 */
@Injectable()
export class PostureIntegrationsService {
  private readonly logger = new Logger(PostureIntegrationsService.name);
  /** Tests inject a fake fetch. */
  fetchImpl: FetchLike | undefined;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly registry: PosturePluginRegistry,
    private readonly access: ClusterAccessService,
    private readonly audit: AuditLogService,
    private readonly network: NetworkStateService,
    @Optional() @InjectQueue(LOADWEAVER_QUEUE_NAME) private readonly queue?: Queue,
  ) {}

  plugins() {
    return this.registry.list();
  }

  private factory(type: string): PosturePluginFactory {
    if (!this.registry.has(type)) throw new BadRequestException(`unknown posture plugin ${type}`);

    return this.registry.get(type);
  }

  private dto(row: PostureIntegrationEntity): PostureIntegrationDto {
    const factory = this.registry.has(row.type) ? this.registry.get(row.type) : undefined;
    const config = parseConfig(row.config);
    const secretKeys = new Set((factory?.fields ?? []).filter((f) => f.secret).map((f) => f.key));

    return {
      id: row.id,
      name: row.name,
      type: row.type,
      displayName: factory?.displayName ?? row.type,
      category: factory?.category ?? 'mdm',
      enabled: row.enabled,
      // Unknown fields could be secrets of a removed plugin: only declared non-secret fields go out.
      config: Object.fromEntries(
        Object.entries(config).filter(
          ([k]) => !secretKeys.has(k) && (factory?.fields ?? []).some((f) => f.key === k && !f.secret),
        ),
      ),
      secretsSet: [...secretKeys].filter((k) => !!config[k]),
      matchBy: row.matchBy as PostureMatchKey[],
      requireUserMatch: row.requireUserMatch && factory?.supportsUserMatch === true,
      warnings: integrationWarnings(row.matchBy, row.requireUserMatch, factory?.supportsUserMatch === true),
      intervalMinutes: row.intervalMinutes,
      maxAgeMinutes: row.maxAgeMinutes,
      status: !row.enabled ? 'disabled' : row.failures > 0 ? 'failing' : row.lastSuccessAt ? 'ok' : 'pending',
      lastSyncAt: row.lastSyncAt?.toISOString() ?? null,
      lastSuccessAt: row.lastSuccessAt?.toISOString() ?? null,
      lastError: row.lastError,
      failures: row.failures,
      nextSyncAt: row.nextSyncAt?.toISOString() ?? null,
      vendorDevices: row.vendorDevices,
      matchedDevices: row.matchedDevices,
    };
  }

  async list(req: RequestWithUser | undefined): Promise<PostureIntegrationDto[]> {
    await this.access.assert(req, 'infra');

    return (await this.dataSource.getRepository(PostureIntegrationEntity).find({ order: { name: 'ASC' } })).map((r) =>
      this.dto(r),
    );
  }

  private async row(id: string): Promise<PostureIntegrationEntity> {
    const row = await this.dataSource.getRepository(PostureIntegrationEntity).findOne({ where: { id } });

    if (!row) throw new NotFoundException('posture integration not found');

    return row;
  }

  /** Validates a configuration with the plugin (throws 400 with the plugin's message). */
  private validated(factory: PosturePluginFactory, config: Record<string, string>): Record<string, string> {
    const known = new Set(factory.fields.map((f) => f.key));
    const clean = Object.fromEntries(
      Object.entries(config)
        .filter(([k, v]) => known.has(k) && typeof v === 'string' && v.length <= 4096)
        .map(([k, v]) => [k, v.trim()]),
    );

    try {
      factory.allowedHosts(clean);
    } catch (error) {
      throw new BadRequestException(error instanceof Error ? error.message : 'invalid configuration');
    }

    return clean;
  }

  private matchBy(input: string[] | undefined, factory: PosturePluginFactory): PostureMatchKey[] {
    const keys = input ?? [...factory.defaultMatchBy];
    const invalid = keys.filter((k) => !(POSTURE_MATCH_KEYS as readonly string[]).includes(k));

    if (invalid.length || keys.length === 0 || new Set(keys).size !== keys.length)
      throw new BadRequestException(`matchBy takes distinct values of ${POSTURE_MATCH_KEYS.join(', ')}`);

    return keys as PostureMatchKey[];
  }

  private requireUserMatch(input: boolean | undefined, factory: PosturePluginFactory, current?: boolean): boolean {
    const supported = factory.supportsUserMatch === true;

    if (input === true && !supported)
      throw new BadRequestException(`${factory.displayName} records carry no device user to match`);

    return supported && (input ?? current ?? true);
  }

  async create(req: RequestWithUser | undefined, input: PostureIntegrationInput): Promise<PostureIntegrationDto> {
    await this.access.assert(req, 'admin');

    const factory = this.factory(input.type ?? '');
    const name = input.name ?? '';

    if (!POSTURE_INTEGRATION_NAME.test(name)) throw new BadRequestException('invalid integration name');

    const config = this.validated(factory, input.config ?? {});
    const repo = this.dataSource.getRepository(PostureIntegrationEntity);

    if ((await repo.count()) >= MAX_INTEGRATIONS)
      throw new ConflictException(`at most ${MAX_INTEGRATIONS} posture integrations`);

    if (await repo.findOne({ where: { name } })) throw new ConflictException(`integration ${name} exists`);

    const row = await this.dataSource.transaction(async (manager) => {
      const saved = await manager.getRepository(PostureIntegrationEntity).save(
        manager.getRepository(PostureIntegrationEntity).create({
          name,
          type: factory.id,
          enabled: input.enabled ?? true,
          config: JSON.stringify(config),
          matchBy: this.matchBy(input.matchBy, factory),
          requireUserMatch: this.requireUserMatch(input.requireUserMatch, factory),
          intervalMinutes: input.intervalMinutes ?? 30,
          maxAgeMinutes: input.maxAgeMinutes ?? 1440,
          nextSyncAt: new Date(),
          syncStartedAt: null,
          lastSyncAt: null,
          lastSuccessAt: null,
          lastError: null,
          failures: 0,
          vendorDevices: 0,
          matchedDevices: 0,
        }),
      );

      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'posture.integration.create',
        target: `posture/${name}`,
        // Field names only, never values.
        details: { type: factory.id, fields: Object.keys(config).sort(), matchBy: saved.matchBy },
      });

      return saved;
    });

    return this.dto(row);
  }

  /** Changes settings; omitted secret fields keep their stored value, an empty string clears a field. */
  async update(
    req: RequestWithUser | undefined,
    id: string,
    input: PostureIntegrationInput,
  ): Promise<PostureIntegrationDto> {
    await this.access.assert(req, 'admin');

    const row = await this.row(id);
    const factory = this.factory(row.type);

    if (input.type && input.type !== row.type) throw new BadRequestException('the type of an integration is fixed');

    if (input.name && input.name !== row.name) throw new BadRequestException('the name of an integration is fixed');

    const merged = { ...parseConfig(row.config), ...(input.config ?? {}) };
    const config = this.validated(factory, Object.fromEntries(Object.entries(merged).filter(([, v]) => v !== '')));

    row.config = JSON.stringify(config);
    row.enabled = input.enabled ?? row.enabled;
    row.matchBy = input.matchBy ? this.matchBy(input.matchBy, factory) : row.matchBy;
    row.requireUserMatch = this.requireUserMatch(input.requireUserMatch, factory, row.requireUserMatch);
    row.intervalMinutes = input.intervalMinutes ?? row.intervalMinutes;
    row.maxAgeMinutes = input.maxAgeMinutes ?? row.maxAgeMinutes;

    if (input.config || input.matchBy || input.enabled || input.requireUserMatch !== undefined) {
      // New credentials / matching: sync soon, forget the failure streak.
      row.nextSyncAt = new Date();
      row.failures = 0;
      row.lastError = null;
    }

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(PostureIntegrationEntity).save(row);
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'posture.integration.update',
        target: `posture/${row.name}`,
        details: {
          fields: Object.keys(input.config ?? {}).sort(),
          enabled: row.enabled,
          matchBy: row.matchBy,
          requireUserMatch: row.requireUserMatch,
          intervalMinutes: row.intervalMinutes,
          maxAgeMinutes: row.maxAgeMinutes,
        },
      });
    });

    return this.dto(row);
  }

  /** Removes the integration and its results; devices re-evaluate at once (fail closed where conditions use it). */
  async remove(req: RequestWithUser | undefined, id: string): Promise<void> {
    await this.access.assert(req, 'admin');

    const row = await this.row(id);
    const before = await this.effectiveSnapshot();

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(PostureIntegrationEntity).delete({ id: row.id });
      await manager.query(`UPDATE lw_vpn_clients SET integration_posture = integration_posture - $1::text`, [row.name]);
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'posture.integration.delete',
        target: `posture/${row.name}`,
        details: { type: row.type },
      });
    });

    await this.applyChanges(before, { type: 'system', id: null });
  }

  /** Connection test: authenticates and reads one page. The answer never contains credentials. */
  async test(
    req: RequestWithUser | undefined,
    target: { id: string } | { type: string; config: Record<string, string> },
  ): Promise<{ ok: boolean; message: string }> {
    await this.access.assert(req, 'admin');

    let factory: PosturePluginFactory;
    let config: Record<string, string>;

    if ('id' in target) {
      const row = await this.row(target.id);

      factory = this.factory(row.type);
      config = this.validated(factory, parseConfig(row.config));
    } else {
      factory = this.factory(target.type);
      config = this.validated(factory, target.config);
    }

    try {
      const http = this.http(factory, config, 20);
      const message = await factory.create(config).testConnection({ http });

      return { ok: true, message: message.slice(0, 300) };
    } catch (error) {
      return { ok: false, message: safeErrorMessage(error) };
    }
  }

  /** Manual "sync now" (deduplicated per minute). */
  async requestSync(req: RequestWithUser | undefined, id: string): Promise<void> {
    await this.access.assert(req, 'admin');

    const row = await this.row(id);

    await this.enqueue(row.id, `manual-${Math.floor(Date.now() / 60_000)}`);
  }

  /** A device reported new identifiers: every enabled integration syncs (deduplicated per minute). */
  async syncSoon(now = Date.now()): Promise<void> {
    if (!this.queue) return;

    const rows = await this.dataSource.getRepository(PostureIntegrationEntity).find({ where: { enabled: true } });

    for (const row of rows) await this.enqueue(row.id, `device-${Math.floor(now / 60_000)}`);
  }

  private http(factory: PosturePluginFactory, config: Record<string, string>, maxRequests?: number): PostureHttp {
    return new PostureHttp({
      allowedHosts: factory.allowedHosts(config),
      ...(this.fetchImpl ? { fetchImpl: this.fetchImpl } : {}),
      ...(maxRequests ? { maxRequests } : {}),
    });
  }

  private async enqueue(integrationId: string, slot: string): Promise<void> {
    if (!this.queue) {
      // No queue in this process (tests, workers off): run inline.
      await this.sync({ integrationId, slot });

      return;
    }

    await enqueueUnitJob({
      queue: this.queue,
      jobName: POSTURE_SYNC_UNIT_JOB,
      payload: { integrationId, slot } satisfies PostureSyncPayload,
      jobIdNamespace: 'posture-sync',
      jobIdParts: [integrationId, slot],
    });
  }

  /** Coordinator: one unit job per enabled integration that is due. */
  async coordinate(now = Date.now()): Promise<number> {
    const due: PostureIntegrationEntity[] = await this.dataSource
      .getRepository(PostureIntegrationEntity)
      .createQueryBuilder('i')
      .where('i.enabled = true')
      .andWhere('(i.next_sync_at IS NULL OR i.next_sync_at <= :now)', { now: new Date(now) })
      .getMany();

    for (const row of due) await this.enqueue(row.id, syncSlot(now, row.intervalMinutes));

    return due.length;
  }

  /** Snapshot of every valid client's effective groups (to detect posture changes). */
  private async effectiveSnapshot(now = Date.now()): Promise<Map<string, string>> {
    const groups = clientGroups(
      await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'ClientGroup' } }),
    );
    const clients = await this.dataSource.getRepository(VpnClientEntity).find();

    return new Map(
      clients.filter((c) => clientValid(c, now)).map((c) => [c.id, effectiveGroups(c, groups, now).join(',')]),
    );
  }

  /** Audits devices whose effective groups changed and recompiles once (gateways and routes follow). */
  private async applyChanges(before: Map<string, string>, actor: AuditActor, now = Date.now()): Promise<number> {
    const groups = clientGroups(
      await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'ClientGroup' } }),
    );
    const clients = await this.dataSource.getRepository(VpnClientEntity).find();
    let changed = 0;

    for (const client of clients) {
      if (!clientValid(client, now) || !before.has(client.id)) continue;

      const after = effectiveGroups(client, groups, now).join(',');

      if (after === before.get(client.id)) continue;

      changed++;

      const failing = Object.fromEntries(
        client.groups
          .map((g) => [g, postureFailures(groups.get(g)?.posture, client, now)] as const)
          .filter(([, reasons]) => reasons.length > 0),
      );

      await this.audit.recordStandalone({
        actor,
        action: 'vpn.posture',
        target: `vpn/${client.id}`,
        details: { device: clientLabel(client), before: before.get(client.id), after, failing, source: 'integration' },
      });
    }

    if (changed > 0) await this.network.recompile();

    return changed;
  }

  /** Claims the integration for this run; false while another worker holds a fresh claim or it is disabled. */
  private async claim(id: string, now: Date): Promise<boolean> {
    const rows: unknown[] = await this.dataSource.query(
      `UPDATE lw_posture_integrations SET sync_started_at = $2
         WHERE id = $1 AND enabled AND (sync_started_at IS NULL OR sync_started_at < $3)
         RETURNING id`,
      [id, now, new Date(now.getTime() - CLAIM_TIMEOUT_MS)],
    );

    return (Array.isArray(rows[0]) ? (rows[0] as unknown[]) : rows).length > 0;
  }

  /** The unit job: one integration, one run. Idempotent: a duplicate finds the claim held or the work done. */
  async sync(payload: PostureSyncPayload, now = Date.now()): Promise<PostureSyncOutcome | null> {
    const repo = this.dataSource.getRepository(PostureIntegrationEntity);
    const row = await repo.findOne({ where: { id: payload.integrationId } });

    if (!row || !row.enabled) return null;

    if (!(await this.claim(row.id, new Date(now)))) return null;

    const factory = this.registry.has(row.type) ? this.registry.get(row.type) : undefined;

    try {
      if (!factory) throw new Error(`posture plugin ${row.type} is not installed`);

      const config = parseConfig(row.config);
      const http = this.http(factory, config);
      const plugin = factory.create(config);
      const vendor = await withDeadline(plugin.fetchDevices({ http }), SYNC_DEADLINE_MS);
      const index = indexVendorDevices(vendor);
      const clients = (await this.dataSource.getRepository(VpnClientEntity).find()).filter((c) => clientValid(c, now));
      const supportsUserMatch = factory.supportsUserMatch === true;
      const matches = new Map(
        clients.map((c) => {
          const requireUser = requiredUser(c, row.requireUserMatch, supportsUserMatch);

          return [
            c.id,
            matchDevice(
              index,
              deviceIdentifiers(c),
              row.matchBy as PostureMatchKey[],
              requireUser === undefined ? {} : { requireUser },
            ),
          ];
        }),
      );
      const matched = [...new Set([...matches.values()].flatMap((m) => (m && 'device' in m ? [m.device] : [])))];
      let enriched = new Map<PostureVendorDevice, PostureVendorDevice>();

      if (plugin.enrich && matched.length) {
        const details = await withDeadline(plugin.enrich({ http }, matched), SYNC_DEADLINE_MS);

        enriched = new Map(matched.map((d, i) => [d, details[i] ?? d]));
      }

      const staleAfterMs = row.maxAgeMinutes * 60_000;
      const facts = new Map<string, IntegrationFact>();

      for (const client of clients) {
        const match = matches.get(client.id) ?? null;
        const resolved =
          match && 'device' in match ? { ...match, device: enriched.get(match.device) ?? match.device } : match;

        facts.set(
          client.id,
          integrationFact(
            {
              name: row.name,
              type: row.type,
              category: factory.category,
              displayName: factory.displayName,
              staleAfterMs,
            },
            resolved,
            now,
          ),
        );
      }

      const before = await this.effectiveSnapshot(now);

      await this.dataSource.transaction(async (manager) => {
        for (const [clientId, fact] of facts)
          await manager.query(
            `UPDATE lw_vpn_clients SET integration_posture = integration_posture || jsonb_build_object($2::text, $3::jsonb) WHERE id = $1`,
            [clientId, row.name, JSON.stringify(fact)],
          );

        await manager.query(
          `UPDATE lw_posture_integrations SET sync_started_at = NULL, last_sync_at = $2, last_success_at = $2,
             last_error = NULL, failures = 0, next_sync_at = $3, vendor_devices = $4, matched_devices = $5
           WHERE id = $1`,
          [row.id, new Date(now), new Date(now + row.intervalMinutes * 60_000), vendor.length, matched.length],
        );
      });

      const changedDevices = await this.applyChanges(before, { type: 'system', id: null }, now);

      return { integration: row.name, vendorDevices: vendor.length, matchedDevices: matched.length, changedDevices };
    } catch (error) {
      const message = safeErrorMessage(error);
      const failures = row.failures + 1;

      this.logger.warn(`Posture integration ${row.name} sync failed: ${message}`);
      await this.dataSource.query(
        `UPDATE lw_posture_integrations SET sync_started_at = NULL, last_sync_at = $2, last_error = $3,
           failures = $4, next_sync_at = $5 WHERE id = $1`,
        [row.id, new Date(now), message, failures, new Date(now + syncBackoffMs(row.intervalMinutes, failures))],
      );

      if (failures === 1 || failures % 10 === 0)
        await this.audit.recordStandalone({
          actor: { type: 'system', id: null },
          action: 'posture.integration.failing',
          target: `posture/${row.name}`,
          details: { failures, error: message },
        });

      return null;
    }
  }

  /** Devices restricted by posture right now (built-in alert `builtin:device-restricted`). */
  async restrictedDevices(now = Date.now()): Promise<{ id: string; label: string; reasons: string[] }[]> {
    const groups = clientGroups(
      await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'ClientGroup' } }),
    );
    const clients = await this.dataSource.getRepository(VpnClientEntity).find();

    return clients
      .filter((c) => clientValid(c, now))
      .map((c) => ({
        id: c.id,
        label: clientLabel(c),
        reasons: c.groups.flatMap((g) => postureFailures(groups.get(g)?.posture, c, now).map((r) => `${g}: ${r}`)),
      }))
      .filter((d) => d.reasons.length > 0);
  }

  /** Integrations failing three times in a row (built-in alert `builtin:posture-integration-failing`). */
  async failingIntegrations(): Promise<
    { name: string; failures: number; lastError: string | null; maxAgeMinutes: number }[]
  > {
    return (await this.dataSource.getRepository(PostureIntegrationEntity).find({ where: { enabled: true } }))
      .filter((r) => r.failures >= 3)
      .map((r) => ({ name: r.name, failures: r.failures, lastError: r.lastError, maxAgeMinutes: r.maxAgeMinutes }));
  }
}

async function withDeadline<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`sync exceeded ${Math.round(ms / 60_000)} minutes`)), ms);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}
