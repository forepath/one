import { HeadBucketCommand } from '@aws-sdk/client-s3';
import { assertPatScopes, getUserFromRequest, type RequestWithUser } from '@forepath/identity/backend';
import type {
  BackupTargetSpec,
  DnsProviderSpec,
  IpPoolSpec,
  NodeGroupSpec,
  SiemTarget,
} from '@forepath/loadweaver/shared/util-model';
import { DnsProviderRegistry, FailoverIpProviderRegistry } from '@forepath/shared/backend/util-hosting-providers';
import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';

import { AgentSessionRegistry } from '../agent-stream/agent-session.registry';
import { S3CopyDestination, SftpCopyDestination } from '../backups/platform/platform-copy.destinations';
import { bind9Nodes } from '../dns/hosted-zones.utils';
import { querySoaSerial, type SoaQuery } from '../dns/propagation';
import { NodeEntity } from '../entities/node.entity';
import { PublicAddressEntity } from '../entities/public-address.entity';
import { SiemForwarderService } from '../siem/siem-forwarder.service';
import { actorFromRequest, AuditLogService } from '../services/audit-log.service';
import { ClusterAccessService, type ClusterPermission } from '../services/cluster-access.service';
import { PlatformCredentialsService } from '../services/platform-credentials.service';
import { ResourceStoreService } from '../services/resource-store.service';
import { integrationEnvStatus, type IntegrationEnvStatus } from './integrations-env';

export const INTEGRATION_TEST_KINDS = ['DnsProvider', 'BackupTarget', 'IpPool', 'SiemTarget'] as const;
export type IntegrationTestKind = (typeof INTEGRATION_TEST_KINDS)[number];

export interface IntegrationTestResult {
  ok: boolean;
  message: string;
  details?: Record<string, string>;
  durationMs: number;
}

/** What a test found; `durationMs` is added by the caller. */
type Outcome = Omit<IntegrationTestResult, 'durationMs'>;

/**
 * Who may test what (3.41): the write rule of the tested resource. Cluster-scoped kinds: infra operators and cluster
 * admins (PAT `cluster:nodes`); `SiemTarget` is a part of the `Cluster`: cluster admins (PAT `cluster:admin`).
 */
export const INTEGRATION_TEST_ACCESS: Record<IntegrationTestKind, { permission: ClusterPermission; scope: string }> = {
  DnsProvider: { permission: 'infra', scope: 'cluster:nodes' },
  BackupTarget: { permission: 'infra', scope: 'cluster:nodes' },
  IpPool: { permission: 'infra', scope: 'cluster:nodes' },
  SiemTarget: { permission: 'admin', scope: 'cluster:admin' },
};

export const INTEGRATION_TEST_TIMEOUT_MS = 10_000;
const MAX_MESSAGE = 300;
/** Failover-IP addresses checked per test. */
const MAX_ADDRESSES = 4;

class IntegrationTestTimeout extends Error {}

/**
 * Message of a failed test that is safe to show and audit: the error's message only (never a provider's response
 * body), known credential values, URL user info, bearer / basic values and `token=` / `key=` style pairs redacted,
 * one line, bounded.
 */
export function sanitizeTestError(error: unknown, secrets: readonly string[] = []): string {
  let message = 'connection failed';

  if (error instanceof Error) {
    const named = error.message && error.message !== 'UnknownError' ? error.message : error.name;
    const cause = (error as { cause?: { code?: unknown } }).cause;
    const code = typeof cause?.code === 'string' ? ` (${cause.code})` : '';

    message = `${named || 'connection failed'}${code}`;
  }

  // Multi-line secrets (private keys) are also redacted line by line.
  const values = secrets.flatMap((s) => [s, ...s.split(/\r?\n/).map((l) => l.trim())]).filter((s) => s.length >= 4);

  for (const secret of [...new Set(values)].sort((a, b) => b.length - a.length))
    message = message.split(secret).join('***');

  return message
    .replace(/\/\/[^/\s@]+@/g, '//')
    .replace(/\b(bearer|basic)\s+[^\s,;]+/gi, '$1 ***')
    .replace(
      /\b((?:api[_-]?)?(?:token|secret|password|passwd|key|signature|credential|authorization)[a-z_-]*\s*[=:]\s*)[^\s&,;]+/gi,
      '$1***',
    )
    .replace(/[\r\n\t]+/g, ' ')
    .trim()
    .slice(0, MAX_MESSAGE);
}

/** HTTP status of a provider error (axios, AWS SDK), when there is one. */
function httpStatus(error: unknown): string | undefined {
  const e = error as { response?: { status?: unknown }; $metadata?: { httpStatusCode?: unknown } } | null;
  const status = e?.response?.status ?? e?.$metadata?.httpStatusCode;

  return typeof status === 'number' ? String(status) : undefined;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Host (and port) of an endpoint URL, for details. */
function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return '';
  }
}

/**
 * External integrations (3.41): the read-only status of env-configured integrations, and connection tests of the
 * applied DNS providers, backup targets, failover-IP providers and SIEM targets with their resolved credentials.
 * Answers never contain credentials; every test is audited.
 */
@Injectable()
export class IntegrationsService {
  /** Overridable for tests. */
  timeoutMs = INTEGRATION_TEST_TIMEOUT_MS;
  /** Overridable for tests. */
  soaQuery: SoaQuery = querySoaSerial;
  /** Overridable for tests. */
  env: NodeJS.ProcessEnv = process.env;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly access: ClusterAccessService,
    private readonly audit: AuditLogService,
    private readonly store: ResourceStoreService,
    private readonly credentials: PlatformCredentialsService,
    private readonly dnsProviders: DnsProviderRegistry,
    private readonly failoverIps: FailoverIpProviderRegistry,
    private readonly siem: SiemForwarderService,
    private readonly sessions: AgentSessionRegistry,
  ) {}

  async status(req: RequestWithUser | undefined): Promise<IntegrationEnvStatus[]> {
    await this.access.assert(req, 'admin');

    return integrationEnvStatus(this.env);
  }

  async test(
    req: RequestWithUser | undefined,
    body: { kind: IntegrationTestKind; name: string },
  ): Promise<IntegrationTestResult> {
    const rule = INTEGRATION_TEST_ACCESS[body.kind];

    if (!rule) throw new BadRequestException(`unknown kind ${String(body.kind)}`);

    // Denials before not-found: the role, then the PAT scope of the kind, then the lookup.
    await this.access.assert(req, rule.permission);
    assertPatScopes(getUserFromRequest(req || ({} as RequestWithUser)), rule.scope);

    const run = await this.prepare(body.kind, body.name);
    const started = Date.now();
    const secrets: string[] = [];
    let outcome: Outcome;

    try {
      outcome = await this.withTimeout(run(secrets));
    } catch (error) {
      outcome =
        error instanceof IntegrationTestTimeout
          ? { ok: false, message: `no answer within ${Math.round(this.timeoutMs / 1000)} s` }
          : {
              ok: false,
              message: sanitizeTestError(error, secrets),
              ...(httpStatus(error) ? { details: { httpStatus: httpStatus(error) as string } } : {}),
            };
    }

    const result: IntegrationTestResult = {
      ok: outcome.ok,
      message: outcome.ok ? outcome.message : sanitizeTestError(new Error(outcome.message), secrets),
      ...(outcome.details ? { details: outcome.details } : {}),
      durationMs: Date.now() - started,
    };

    await this.audit.recordStandalone({
      actor: actorFromRequest(req),
      action: 'integration.test',
      target: `${body.kind}/${body.name}`,
      details: { kind: body.kind, name: body.name, ok: result.ok, durationMs: result.durationMs },
    });

    return result;
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;

    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new IntegrationTestTimeout()), this.timeoutMs);
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /**
   * Looks the applied configuration up (404 when it doesn't exist, 400 when there is nothing to test) and returns
   * the test; the test collects the credential values it resolved so failures can be redacted.
   */
  private async prepare(kind: IntegrationTestKind, name: string): Promise<(secrets: string[]) => Promise<Outcome>> {
    switch (kind) {
      case 'DnsProvider': {
        const resource = await this.store.get('DnsProvider', name);

        if (!resource) throw new NotFoundException(`DnsProvider ${name} not found`);

        return (secrets) => this.testDnsProvider(name, resource.spec, secrets);
      }

      case 'BackupTarget': {
        const resource = await this.store.get('BackupTarget', name);

        if (!resource) throw new NotFoundException(`BackupTarget ${name} not found`);

        return (secrets) => this.testBackupTarget(resource.spec, secrets);
      }

      case 'IpPool': {
        const resource = await this.store.get('IpPool', name);

        if (!resource) throw new NotFoundException(`IpPool ${name} not found`);

        if (resource.spec.failover !== 'provider' || !resource.spec.provider)
          throw new BadRequestException(`IpPool ${name} has no failover-IP provider to test`);

        const provider = resource.spec.provider;

        return (secrets) => this.testIpPool(name, resource.spec, provider, secrets);
      }

      case 'SiemTarget': {
        const target = ((await this.store.clusterSpec()).observability?.siem ?? []).find((t) => t.name === name);

        if (!target) throw new NotFoundException(`SIEM target ${name} not found`);

        return (secrets) => this.testSiemTarget(target, secrets);
      }
    }
  }

  private async providerConfig(ref: string, secrets: string[]): Promise<Record<string, string>> {
    const config = await this.credentials.providerConfig(ref);

    secrets.push(...Object.values(config));

    return config;
  }

  private async zonesOf(provider: string): Promise<{ zone: string; providerZoneId?: string; primary: boolean }[]> {
    return (await this.store.list('DnsZone'))
      .filter((z) => z.spec.provider === provider || z.spec.secondaries.includes(provider))
      .map((z) => ({
        zone: z.spec.zone,
        primary: z.spec.provider === provider,
        ...(z.spec.provider === provider && z.spec.providerZoneId ? { providerZoneId: z.spec.providerZoneId } : {}),
      }));
  }

  /** API providers: list the zones (authenticated read) and check the zones that use it exist there. */
  private async testDnsProvider(name: string, spec: DnsProviderSpec, secrets: string[]): Promise<Outcome> {
    if (spec.type === 'bind9') return await this.testBind9(spec);

    const zones = await this.zonesOf(name);

    if (spec.type === 'axfr') return await this.testAxfr(spec, zones);

    if (!spec.credentials) return { ok: false, message: `${spec.type} has no credentials` };

    const provider = this.dnsProviders.create(spec.type, {
      ...(spec.options ?? {}),
      ...(await this.providerConfig(spec.credentials, secrets)),
    });
    const found = await provider.listZones();
    const missing = zones.filter(
      (z) => !found.some((f) => f.name === z.zone || (z.providerZoneId && f.id === z.providerZoneId)),
    );
    const details: Record<string, string> = {
      provider: spec.type,
      zonesAtProvider: String(found.length),
      zonesUsingIt: String(zones.length),
      ...(missing.length ? { missingZones: missing.map((z) => z.zone).join(', ') } : {}),
    };

    return missing.length
      ? {
          ok: false,
          message: `authenticated, but ${plural(missing.length, 'zone')} not found at the provider: ${missing.map((z) => z.zone).join(', ')}`,
          details,
        }
      : { ok: true, message: `authenticated; ${plural(found.length, 'zone')} visible`, details };
  }

  /** Hosted bind9: the node group exists and its nodes are connected (they run the name servers). */
  private async testBind9(spec: DnsProviderSpec): Promise<Outcome> {
    const groups = new Map<string, NodeGroupSpec>(
      (await this.store.list('NodeGroup')).map((g) => [g.metadata.name, g.spec]),
    );

    if (spec.nodeGroup && !groups.has(spec.nodeGroup))
      return { ok: false, message: `node group ${spec.nodeGroup} does not exist` };

    const nodes = await this.dataSource.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
    const servers = bind9Nodes(spec, groups, nodes);
    const connected = servers.filter((n) => !!this.sessions.get(n.name));
    const details = {
      nodeGroup: spec.nodeGroup ?? 'control plane',
      nodes: String(servers.length),
      connected: String(connected.length),
    };

    if (servers.length === 0) return { ok: false, message: 'no node runs the name servers', details };

    if (connected.length === 0) return { ok: false, message: 'no name-server node is connected', details };

    return {
      ok: true,
      message: `${connected.length} of ${plural(servers.length, 'name-server node')} connected`,
      details,
    };
  }

  /** AXFR: every external server answers the SOA of the zones using the provider. */
  private async testAxfr(spec: DnsProviderSpec, zones: { zone: string }[]): Promise<Outcome> {
    const servers = spec.servers ?? [];

    if (zones.length === 0)
      return {
        ok: false,
        message: 'no DNS zone uses this provider yet, so there is no zone to query',
        details: { servers: servers.join(', ') },
      };

    const zone = zones[0].zone;
    const answers = await Promise.all(
      servers.map(async (server) => [server, await this.soaQuery(server, zone).catch(() => null)] as const),
    );
    const silent = answers.filter(([, serial]) => serial === null).map(([server]) => server);
    const details = {
      zone,
      servers: servers.join(', '),
      ...(silent.length ? { noAnswer: silent.join(', ') } : {}),
    };

    return silent.length
      ? { ok: false, message: `${plural(silent.length, 'server')} did not answer the SOA of ${zone}`, details }
      : { ok: true, message: `${plural(servers.length, 'server')} answered the SOA of ${zone}`, details };
  }

  /** Opens a backup target with its credentials (overridable for tests). */
  async backupDestination(spec: BackupTargetSpec, secrets: string[]): Promise<S3CopyDestination | SftpCopyDestination> {
    if (spec.type === 's3') {
      const credentials = await this.providerConfig(spec.credentials, secrets);

      return new S3CopyDestination(spec, {
        accessKeyId: credentials['accessKeyId'] ?? '',
        secretAccessKey: credentials['secretAccessKey'] ?? '',
      });
    }

    const key = (await this.credentials.read(spec.keySecret)).toString('utf8');

    secrets.push(key);

    return new SftpCopyDestination(spec, key);
  }

  /** S3: head-bucket and the declared object lock; SFTP: connect (host key checked) and stat the path. */
  private async testBackupTarget(spec: BackupTargetSpec, secrets: string[]): Promise<Outcome> {
    const destination = await this.backupDestination(spec, secrets);

    try {
      if (destination instanceof S3CopyDestination && spec.type === 's3') {
        await destination.client.send(new HeadBucketCommand({ Bucket: spec.bucket }));

        const lockDays = await destination.objectLockDays();
        const details = {
          type: 's3',
          endpoint: hostOf(spec.endpoint),
          bucket: spec.bucket,
          objectLock: spec.objectLock
            ? `${spec.objectLock.mode}, ${lockDays ?? spec.objectLock.days} days`
            : 'not declared',
        };

        return {
          ok: true,
          message: spec.objectLock
            ? `bucket ${spec.bucket} reachable; object lock matches the declared retention`
            : `bucket ${spec.bucket} reachable`,
          details,
        };
      }

      if (destination instanceof SftpCopyDestination && spec.type === 'sftp') {
        const stat = await destination.probe();
        const details = { type: 'sftp', host: `${spec.host}:${spec.port}`, path: spec.path };

        if (!stat.exists)
          return {
            ok: false,
            message: `connected, but ${spec.path} does not exist (it is created on the first copy)`,
            details,
          };

        if (!stat.directory) return { ok: false, message: `connected, but ${spec.path} is not a directory`, details };

        return { ok: true, message: `connected; ${spec.path} exists`, details };
      }

      return { ok: false, message: 'unsupported backup target' };
    } finally {
      // Not awaited: a connection still opening after a timeout must not hold up the answer.
      void destination.close().catch(() => undefined);
    }
  }

  /** Failover IPs: an authenticated read of the addresses' holders at the provider. */
  private async testIpPool(
    name: string,
    spec: IpPoolSpec,
    config: NonNullable<IpPoolSpec['provider']>,
    secrets: string[],
  ): Promise<Outcome> {
    const provider = this.failoverIps.create(config.type, {
      ...(config.options ?? {}),
      ...(await this.providerConfig(config.credentials, secrets)),
    });
    const assigned = (
      await this.dataSource.getRepository(PublicAddressEntity).find({ where: { pool: name, state: 'assigned' } })
    ).map((r) => r.address);
    const addresses = (assigned.length ? assigned : spec.cidrs.map((c) => c.split('/')[0])).slice(0, MAX_ADDRESSES);
    const holders: string[] = [];

    for (const address of addresses) holders.push(`${address}: ${(await provider.holder(address)) ?? 'unassigned'}`);

    return {
      ok: true,
      message: `authenticated; ${plural(addresses.length, 'address')} found at the provider`,
      details: { provider: config.type, holders: holders.join(', ') },
    };
  }

  /** SIEM: one clearly marked test event through the forwarder's sender. */
  private async testSiemTarget(target: SiemTarget, secrets: string[]): Promise<Outcome> {
    if (target.credentials) await this.providerConfig(target.credentials, secrets);

    await this.siem.sendTest(target);

    const url = new URL(target.url);
    const details = { type: target.type, endpoint: url.host };

    return {
      ok: true,
      message:
        url.protocol === 'udp:'
          ? 'test event sent over UDP (delivery is not confirmed by syslog over UDP)'
          : 'test event accepted by the target',
      details,
    };
  }
}
