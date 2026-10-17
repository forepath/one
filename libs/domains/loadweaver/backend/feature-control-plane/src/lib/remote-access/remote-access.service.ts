import { getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import type { VpnSessions } from '@forepath/loadweaver/shared/util-agent-protocol';
import { compileNetwork } from '@forepath/loadweaver/shared/util-policy-compiler';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnApplicationBootstrap,
  OnModuleDestroy,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, In } from 'typeorm';

import { PublicAddressEntity } from '../entities/public-address.entity';
import { ResourceEntity } from '../entities/resource.entity';
import {
  VpnClientEntity,
  VpnGatewayKeyEntity,
  type PostureReport,
  type PostureState,
} from '../entities/vpn-client.entity';
import { egressGateways } from '../ipam/public-ipam.utils';
import { AuditLogService, actorFromRequest } from '../services/audit-log.service';
import { ClusterAccessService } from '../services/cluster-access.service';
import { NetworkStateService } from '../services/network-state.service';
import { PlatformCredentialsService } from '../services/platform-credentials.service';
import { ADVISORY_LOCK_VPN, ensureVpnGatewayKey, GATEWAY_KEY_ID } from './gateway-key';
import { PosturePluginRegistry } from './posture-plugin';
import {
  allocateClientAddress,
  clientGroups,
  clientValid,
  effectiveGroups,
  groupsForRoles,
  hasMfa,
  keyLifetimeMs,
  postureFailures,
  remoteAccessSettings,
  renderClientConfig,
  subnetIssues,
  VPN_ADDRESS_OWNER,
  WIREGUARD_KEY,
} from './remote-access.utils';

const TICK_MS = 60_000;
const PLUGIN_TIMEOUT_MS = 10_000;
const MAX_DEVICES_PER_USER = 20;
const MAX_ENROLLMENTS_PER_DAY = 20;
/** A revoked / expired client's address stays reserved this long (stale peers), its row is removed after a while. */
const ADDRESS_GRACE_MS = 7 * 86_400_000;
const CLIENT_RETENTION_MS = 90 * 86_400_000;

export interface VpnClientSummary {
  id: string;
  kind: 'user' | 'machine';
  name: string;
  owner: string;
  address: string;
  subnets: string[];
  groups: string[];
  /** Groups after posture (failing ones replaced by their restricted group). */
  effectiveGroups: string[];
  /** Why the device is restricted, per failing group. */
  restrictions: Record<string, string[]>;
  status: 'active' | 'expired' | 'revoked';
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastHandshakeAt: string | null;
  lastEndpoint: string | null;
}

export interface VpnClientConfigResponse {
  client: VpnClientSummary;
  /** wg-quick configuration without the private key (it never leaves the device). */
  config: string;
  routes: string[];
  dns: string;
  names: string[];
}

interface Caller {
  userId: string;
  label: string;
  roles: string[];
  amr: string[];
}

/**
 * Remote access (3.31): self-service enrollment of user devices (public key from the device), machine clients and
 * offices by admins, expiry and renewal after a fresh interactive login, instant revocation, posture reports with
 * plugin verdicts, and the sessions the gateways report. Every change recompiles the network, so gateways and
 * policies follow at once.
 */
@Injectable()
export class RemoteAccessService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RemoteAccessService.name);
  private timer: NodeJS.Timeout | null = null;
  /** Effective client set at the last check: expiries and stale posture reports change it without any request. */
  private fingerprint: string | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly network: NetworkStateService,
    private readonly access: ClusterAccessService,
    private readonly audit: AuditLogService,
    private readonly credentials: PlatformCredentialsService,
    private readonly plugins: PosturePluginRegistry,
  ) {}

  onApplicationBootstrap(): void {
    if ((process.env.LOADWEAVER_WORKLOAD_CONTROLLER ?? 'on') === 'off') return;

    this.timer = setInterval(() => void this.tick().catch(() => undefined), TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Recompiles when a key expired or a posture report went stale since the last check. */
  async tick(now = Date.now()): Promise<boolean> {
    // Old revoked / expired clients go away for good (addresses were free again after the grace period).
    await this.dataSource
      .getRepository(VpnClientEntity)
      .createQueryBuilder()
      .delete()
      .where('COALESCE(revoked_at, expires_at) < :before', { before: new Date(now - CLIENT_RETENTION_MS) })
      .execute();

    const resources = await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'ClientGroup' } });
    const groups = clientGroups(resources);
    const clients = await this.dataSource.getRepository(VpnClientEntity).find({ order: { id: 'ASC' } });
    const fingerprint = clients
      .filter((c) => clientValid(c, now))
      .map((c) => `${c.id}:${effectiveGroups(c, groups, now).join(',')}`)
      .join('|');
    // The first check after a start compares with what the last compilation saw: a recompile is cheap when nothing changed.
    const changed = fingerprint !== this.fingerprint;

    this.fingerprint = fingerprint;

    if (changed) this.network.requestRecompile('remote access clients expired or changed posture');

    return changed;
  }

  /** Enrollment and renewal need an interactive login of a user (no API key, no access token). */
  private caller(req?: RequestWithUser): Caller {
    const info = getUserFromRequest(req || ({} as RequestWithUser));
    const amr = info.amr ?? [];

    if (info.isApiKeyAuth || !info.userId || amr.includes('pat'))
      throw new ForbiddenException('remote access enrollment needs an interactive login');

    return {
      userId: info.userId,
      label: req?.user?.email ?? req?.user?.username ?? info.userId,
      roles: req?.user?.roles ?? [],
      amr,
    };
  }

  private async resources(manager: EntityManager): Promise<ResourceEntity[]> {
    return await manager.getRepository(ResourceEntity).find({ where: [{ kind: 'Cluster' }, { kind: 'ClientGroup' }] });
  }

  private settingsOrFail(resources: readonly ResourceEntity[]) {
    const settings = remoteAccessSettings(resources);

    if (!settings) throw new ConflictException('remote access is not configured (Cluster spec.remoteAccess)');

    return settings;
  }

  /** The gateway private key for a push to a gateway (3.31); never stored with the desired state. */
  async gatewayPrivateKey(): Promise<string | null> {
    return (
      (await this.dataSource.getRepository(VpnGatewayKeyEntity).findOne({ where: { id: GATEWAY_KEY_ID } }))
        ?.privateKey ?? null
    );
  }

  private summary(client: VpnClientEntity, groups: ReturnType<typeof clientGroups>, now: number): VpnClientSummary {
    return {
      id: client.id,
      kind: client.kind,
      name: client.name,
      owner: client.ownerLabel,
      address: client.address,
      subnets: client.subnets,
      groups: client.groups,
      effectiveGroups: clientValid(client, now) ? effectiveGroups(client, groups, now) : [],
      restrictions: Object.fromEntries(
        client.groups
          .map((g) => [g, postureFailures(groups.get(g)?.posture, client.posture, now)] as const)
          .filter(([, reasons]) => reasons.length > 0),
      ),
      status: client.revokedAt ? 'revoked' : clientValid(client, now) ? 'active' : 'expired',
      createdAt: client.createdAt.toISOString(),
      expiresAt: client.expiresAt.toISOString(),
      revokedAt: client.revokedAt?.toISOString() ?? null,
      lastHandshakeAt: client.lastHandshakeAt?.toISOString() ?? null,
      lastEndpoint: client.lastEndpoint,
    };
  }

  private async newClient(
    manager: EntityManager,
    clientNetwork: string,
    fields: Pick<VpnClientEntity, 'kind' | 'name' | 'userId' | 'ownerLabel' | 'publicKey' | 'subnets' | 'groups'>,
    lifetimeMs: number,
    now: Date,
  ): Promise<VpnClientEntity> {
    await manager.query('SELECT pg_advisory_xact_lock($1)', [ADVISORY_LOCK_VPN]);

    const repo = manager.getRepository(VpnClientEntity);

    if (!WIREGUARD_KEY.test(fields.publicKey)) throw new BadRequestException('invalid WireGuard public key');

    if (await repo.findOne({ where: { publicKey: fields.publicKey } }))
      throw new ConflictException('this public key is already enrolled');

    // Addresses of revoked / expired clients are free again after a grace period.
    const address = allocateClientAddress(
      clientNetwork,
      (await repo.find())
        .filter((c) => (c.revokedAt ?? c.expiresAt).getTime() > now.getTime() - ADDRESS_GRACE_MS)
        .map((c) => c.address),
    );

    if (!address) throw new ConflictException('the client network is full');

    return await repo.save(
      repo.create({
        ...fields,
        address,
        posture: null,
        renewedAt: now,
        expiresAt: new Date(now.getTime() + lifetimeMs),
        revokedAt: null,
        lastHandshakeAt: null,
        lastEndpoint: null,
        lastGateway: null,
      }),
    );
  }

  /** Self-service enrollment of a user device: the key pair was generated on the device (3.31). */
  async enroll(req: RequestWithUser | undefined, name: string, publicKey: string): Promise<VpnClientConfigResponse> {
    const caller = this.caller(req);
    const now = new Date();
    const client = await this.dataSource.transaction(async (manager) => {
      const resources = await this.resources(manager);
      const settings = this.settingsOrFail(resources);
      const groups = clientGroups(resources);
      const mine = groupsForRoles(caller.roles, groups);

      if (mine.length === 0) throw new ForbiddenException('you are not in any client group');

      if (mine.some((g) => groups.get(g)?.requireMfa) && !hasMfa(caller.amr))
        throw new ForbiddenException('enrollment needs a login with a second factor');

      const repo = manager.getRepository(VpnClientEntity);
      const devices = await repo.find({ where: { userId: caller.userId } });

      if (devices.some((d) => d.name === name && !d.revokedAt))
        throw new ConflictException(`you already have a device named ${name}`);

      if (devices.filter((d) => clientValid(d, now.getTime())).length >= MAX_DEVICES_PER_USER)
        throw new ConflictException(`at most ${MAX_DEVICES_PER_USER} active devices per user`);

      if (devices.filter((d) => d.createdAt.getTime() > now.getTime() - 86_400_000).length >= MAX_ENROLLMENTS_PER_DAY)
        throw new ConflictException(`at most ${MAX_ENROLLMENTS_PER_DAY} enrollments per day`);

      const created = await this.newClient(
        manager,
        settings.clientNetwork,
        {
          kind: 'user',
          name,
          userId: caller.userId,
          ownerLabel: caller.label,
          publicKey,
          subnets: [],
          groups: mine,
        },
        keyLifetimeMs(mine, groups),
        now,
      );

      await ensureVpnGatewayKey(manager);
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'vpn.enroll',
        target: `vpn/${created.id}`,
        details: { name, groups: mine, address: created.address },
      });

      return created;
    });

    await this.network.recompile();

    return await this.config(req, client.id);
  }

  /** Renewal after a fresh login: new expiry, groups from the current roles, optionally a new key (3.31). */
  async renew(req: RequestWithUser | undefined, id: string, publicKey?: string): Promise<VpnClientSummary> {
    const caller = this.caller(req);
    const now = new Date();
    const summary = await this.dataSource.transaction(async (manager) => {
      const resources = await this.resources(manager);

      this.settingsOrFail(resources);

      const groups = clientGroups(resources);
      const repo = manager.getRepository(VpnClientEntity);
      const client = await repo.findOne({ where: { id, userId: caller.userId, kind: 'user' } });

      if (!client || client.revokedAt) throw new NotFoundException('device not found');

      const mine = groupsForRoles(caller.roles, groups);

      if (mine.length === 0) throw new ForbiddenException('you are not in any client group');

      if (mine.some((g) => groups.get(g)?.requireMfa) && !hasMfa(caller.amr))
        throw new ForbiddenException('renewal needs a login with a second factor');

      if (publicKey && publicKey !== client.publicKey) {
        if (!WIREGUARD_KEY.test(publicKey)) throw new BadRequestException('invalid WireGuard public key');

        if (await repo.findOne({ where: { publicKey } }))
          throw new ConflictException('this public key is already enrolled');

        client.publicKey = publicKey;
      }

      client.groups = mine;
      client.ownerLabel = caller.label;
      client.renewedAt = now;
      client.expiresAt = new Date(now.getTime() + keyLifetimeMs(mine, groups));
      await repo.save(client);
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'vpn.renew',
        target: `vpn/${client.id}`,
        details: { groups: mine, keyRotated: !!publicKey },
      });

      return this.summary(client, groups, now.getTime());
    });

    await this.network.recompile();

    return summary;
  }

  /** Instant revocation by the owner or an admin: the gateways drop the peer with the next push. */
  async revoke(req: RequestWithUser | undefined, id: string): Promise<void> {
    const isAdmin = await this.access.can(req, 'infra');
    const userId = getUserFromRequest(req || ({} as RequestWithUser)).userId;

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(VpnClientEntity);
      const client = await repo.findOne({ where: { id } });

      if (!client || (!isAdmin && (client.kind !== 'user' || client.userId !== userId)))
        throw new NotFoundException('device not found');

      if (client.revokedAt) return;

      client.revokedAt = new Date();
      await repo.save(client);
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'vpn.revoke',
        target: `vpn/${client.id}`,
        details: { name: client.name, owner: client.ownerLabel },
      });
    });

    await this.network.recompile();
  }

  /** Machines and offices have no login to renew with: admins extend them (3.31). */
  async renewMachine(req: RequestWithUser | undefined, id: string, lifetimeDays = 365): Promise<VpnClientSummary> {
    await this.access.assert(req, 'infra');

    const now = new Date();
    const summary = await this.dataSource.transaction(async (manager) => {
      const groups = clientGroups(await this.resources(manager));
      const repo = manager.getRepository(VpnClientEntity);
      const client = await repo.findOne({ where: { id, kind: 'machine' } });

      if (!client || client.revokedAt) throw new NotFoundException('machine not found');

      client.renewedAt = now;
      client.expiresAt = new Date(now.getTime() + lifetimeDays * 86_400_000);
      await repo.save(client);
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'vpn.machine.renew',
        target: `vpn/${client.id}`,
        details: { name: client.name, expiresAt: client.expiresAt.toISOString() },
      });

      return this.summary(client, groups, now.getTime());
    });

    await this.network.recompile();

    return summary;
  }

  /** Offboarding: every device of a user, e.g. when the identity provider removed them. */
  async revokeUser(req: RequestWithUser | undefined, userId: string): Promise<number> {
    await this.access.assert(req, 'infra');

    const revoked = await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(VpnClientEntity);
      const devices = (await repo.find({ where: { userId } })).filter((d) => !d.revokedAt);

      for (const device of devices) {
        device.revokedAt = new Date();
        await repo.save(device);
      }

      if (devices.length > 0)
        await this.audit.record(manager, {
          actor: actorFromRequest(req),
          action: 'vpn.revoke-user',
          target: `user/${userId}`,
          details: { devices: devices.map((d) => d.id) },
        });

      return devices.length;
    });

    if (revoked > 0) await this.network.recompile();

    return revoked;
  }

  /** Machine clients and offices (site-to-site) by admins (3.31). */
  async createMachine(
    req: RequestWithUser | undefined,
    input: { name: string; publicKey: string; groups: string[]; subnets: string[]; lifetimeDays?: number },
  ): Promise<VpnClientConfigResponse> {
    await this.access.assert(req, 'infra');

    const now = new Date();
    const client = await this.dataSource.transaction(async (manager) => {
      const resources = await this.resources(manager);
      const settings = this.settingsOrFail(resources);
      const groups = clientGroups(resources);
      const unknown = input.groups.filter((g) => !groups.has(g));

      if (unknown.length > 0) throw new BadRequestException(`unknown client groups: ${unknown.join(', ')}`);

      const repo = manager.getRepository(VpnClientEntity);
      const machines = await repo.find({ where: { kind: 'machine' } });

      if (machines.some((m) => m.name === input.name && !m.revokedAt))
        throw new ConflictException(`machine ${input.name} exists`);

      const cluster = resources.find((r) => r.kind === 'Cluster');
      const network = (cluster?.spec as { network?: Record<string, string | undefined> } | undefined)?.network ?? {};
      const issues = subnetIssues(
        input.subnets,
        [settings.clientNetwork, network['podPoolV4'], network['servicePoolV4'], network['overlayPoolV4']].filter(
          (r): r is string => !!r,
        ),
        machines.filter((m) => clientValid(m, now.getTime())).map((m) => ({ name: m.name, subnets: m.subnets })),
      );

      if (issues.length > 0) throw new BadRequestException(issues.join('; '));

      const created = await this.newClient(
        manager,
        settings.clientNetwork,
        {
          kind: 'machine',
          name: input.name,
          userId: null,
          ownerLabel: 'machine',
          publicKey: input.publicKey,
          subnets: input.subnets,
          groups: [...input.groups].sort(),
        },
        (input.lifetimeDays ?? 365) * 86_400_000,
        now,
      );

      await ensureVpnGatewayKey(manager);
      await this.audit.record(manager, {
        actor: actorFromRequest(req),
        action: 'vpn.machine.create',
        target: `vpn/${created.id}`,
        details: { name: input.name, groups: created.groups, subnets: input.subnets },
      });

      return created;
    });

    await this.network.recompile();

    return await this.config(req, client.id);
  }

  /** Own devices; admins see everyone's with `all`. */
  async list(req: RequestWithUser | undefined, all: boolean): Promise<VpnClientSummary[]> {
    const now = Date.now();
    const groups = clientGroups(
      await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'ClientGroup' } }),
    );
    const repo = this.dataSource.getRepository(VpnClientEntity);
    let clients: VpnClientEntity[];

    if (all) {
      await this.access.assert(req, 'infra');
      clients = await repo.find({ order: { createdAt: 'DESC' }, take: 5000 });
    } else {
      const userId = getUserFromRequest(req || ({} as RequestWithUser)).userId;

      if (!userId) throw new ForbiddenException('no user');

      clients = await repo.find({ where: { userId }, order: { createdAt: 'DESC' } });
    }

    return clients.map((c) => this.summary(c, groups, now));
  }

  /** Clients with a handshake on the active gateway in the last minutes. */
  async sessions(req: RequestWithUser | undefined): Promise<VpnClientSummary[]> {
    await this.access.assert(req, 'infra');

    const since = Date.now() - 3 * 60_000;

    return (await this.list(req, true)).filter(
      (c) => c.status === 'active' && c.lastHandshakeAt && new Date(c.lastHandshakeAt).getTime() >= since,
    );
  }

  private async owned(req: RequestWithUser | undefined, id: string): Promise<VpnClientEntity> {
    const client = await this.dataSource.getRepository(VpnClientEntity).findOne({ where: { id } });
    const userId = getUserFromRequest(req || ({} as RequestWithUser)).userId;

    if (!client) throw new NotFoundException('device not found');

    if (client.kind === 'user' && client.userId === userId) return client;

    if (await this.access.can(req, 'infra')) return client;

    throw new NotFoundException('device not found');
  }

  /** The device's WireGuard configuration: exactly the routes its policies allow, and its DNS (3.31). */
  async config(req: RequestWithUser | undefined, id: string): Promise<VpnClientConfigResponse> {
    const client = await this.owned(req, id);

    return await this.dataSource.transaction('REPEATABLE READ', async (manager) => {
      const resources = await this.resources(manager);
      const settings = this.settingsOrFail(resources);
      const groups = clientGroups(resources);
      const { input } = await this.network.loadInput(manager);
      const compilation = compileNetwork({
        ...input,
        egress: egressGateways(await manager.getRepository(PublicAddressEntity).find()),
      });
      const compiled = compilation.clients[client.id];
      const key = await manager.getRepository(VpnGatewayKeyEntity).findOne({ where: { id: GATEWAY_KEY_ID } });

      if (!compiled || !key || !clientValid(client, Date.now()))
        return {
          client: this.summary(client, groups, Date.now()),
          config: '',
          routes: [],
          dns: '',
          names: [],
        };

      return {
        client: this.summary(client, groups, Date.now()),
        config: renderClientConfig({
          config: compiled,
          gatewayPublicKey: key.publicKey,
          endpoint: settings.endpoint,
          port: settings.port,
          dnsDomain: input.network.dnsDomain,
        }),
        routes: compiled.routes,
        dns: compiled.dns,
        names: compiled.names,
      };
    });
  }

  /** Posture reported by the device (core checks), plus the verdicts of the plugins its groups require (3.31). */
  async reportPosture(req: RequestWithUser | undefined, id: string, report: PostureReport): Promise<VpnClientSummary> {
    const client = await this.owned(req, id);
    const userId = getUserFromRequest(req || ({} as RequestWithUser)).userId;

    // A user device reports for itself; admins only for machines.
    if (client.kind === 'user' && client.userId !== userId) throw new NotFoundException('device not found');

    const pinned = client.posture?.deviceId;

    if (pinned && report.deviceId !== pinned)
      throw new BadRequestException('this device reported another device id before; enroll it again');

    if (!pinned && report.deviceId) {
      const others = await this.dataSource.getRepository(VpnClientEntity).find();

      if (
        others.some((c) => c.id !== client.id && clientValid(c, Date.now()) && c.posture?.deviceId === report.deviceId)
      )
        throw new ConflictException('this device id belongs to another enrolled device');
    }

    const resources = await this.dataSource.getRepository(ResourceEntity).find({ where: { kind: 'ClientGroup' } });
    const groups = clientGroups(resources);
    const plugins: PostureState['plugins'] = {};

    for (const rule of client.groups.flatMap((g) => groups.get(g)?.posture?.plugins ?? [])) {
      if (plugins[rule.type]) continue;

      plugins[rule.type] = await this.pluginVerdict(rule.type, rule.credentials, client, report);
    }

    const now = Date.now();
    // Pinned once a plugin recognised the device id.
    const recognised = Object.values(plugins).some((p) => p.verdict !== 'unknown');
    const posture: PostureState = {
      report,
      reportedAt: new Date(now).toISOString(),
      plugins,
      failing: {},
      ...(pinned || (recognised && report.deviceId) ? { deviceId: pinned ?? report.deviceId } : {}),
    };

    posture.failing = Object.fromEntries(
      client.groups
        .map((g) => [g, postureFailures(groups.get(g)?.posture, posture, now)] as const)
        .filter(([, reasons]) => reasons.length > 0),
    );

    const before = effectiveGroups(client, groups, now).join(',');

    client.posture = posture;
    await this.dataSource.getRepository(VpnClientEntity).update({ id: client.id }, { posture });

    if (effectiveGroups(client, groups, now).join(',') !== before) {
      await this.audit.recordStandalone({
        actor: actorFromRequest(req),
        action: 'vpn.posture',
        target: `vpn/${client.id}`,
        details: { failing: posture.failing },
      });
      await this.network.recompile();
    }

    return this.summary(client, groups, now);
  }

  private async pluginVerdict(
    type: string,
    credentials: string | undefined,
    client: VpnClientEntity,
    report: PostureReport,
  ): Promise<{ verdict: string; detail?: string }> {
    if (!this.plugins.has(type)) return { verdict: 'unknown', detail: 'posture plugin not installed' };

    try {
      const config = credentials ? await this.credentials.providerConfig(credentials) : {};
      const plugin = this.plugins.create(type, config);
      let timer: NodeJS.Timeout | undefined;
      const result = await Promise.race([
        plugin.check({
          id: client.id,
          owner: client.ownerLabel,
          name: client.name,
          platform: report.platform,
          ...(report.deviceId ? { deviceId: report.deviceId } : {}),
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error('timed out')), PLUGIN_TIMEOUT_MS);
        }),
      ]).finally(() => clearTimeout(timer));

      return { verdict: result.verdict, ...(result.detail ? { detail: result.detail.slice(0, 256) } : {}) };
    } catch (error) {
      this.logger.warn(`Posture plugin ${type}: ${error instanceof Error ? error.message : String(error)}`);

      return { verdict: 'unknown', detail: 'posture check failed' };
    }
  }

  /** Session state from a gateway: only the active one (holder of the gateway address) is believed. */
  async recordSessions(nodeName: string, payload: VpnSessions): Promise<boolean> {
    const holder = await this.dataSource
      .getRepository(PublicAddressEntity)
      .findOne({ where: { owner: VPN_ADDRESS_OWNER, state: 'assigned' } });

    if (holder?.holder !== nodeName) return false;

    const repo = this.dataSource.getRepository(VpnClientEntity);
    const keys = payload.sessions.map((s) => s.publicKey);
    const clients = keys.length > 0 ? await repo.find({ where: { publicKey: In(keys) } }) : [];

    for (const session of payload.sessions) {
      const client = clients.find((c) => c.publicKey === session.publicKey);

      if (!client) continue;

      await repo.update(
        { id: client.id },
        {
          lastHandshakeAt: new Date(session.latestHandshake * 1000),
          lastEndpoint: session.endpoint,
          lastGateway: nodeName,
        },
      );
    }

    return true;
  }
}
