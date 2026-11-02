import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { generateKeyPairSync } from 'node:crypto';
import { DataSource, In, LessThan, Not } from 'typeorm';

import { clusterSpecSchema } from '@forepath/loadweaver/shared/util-model';

import { AcmeAccountEntity, AcmeChallengeEntity, CertificateEntity } from '../entities/certificate.entity';
import { NodeEntity } from '../entities/node.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { collectExposures, statusPageHosts } from '../ingress/ingress-state.utils';
import { AuditLogService } from '../services/audit-log.service';
import { ingressNodesOf, NetworkStateService } from '../services/network-state.service';
import { WorkloadPlannerService, plannerNodes } from '../services/workload-planner.service';
import { AcmeClient, type AcmeTransport } from './acme-client';
import {
  certificateId,
  nextAttempt,
  pickCertificate,
  renewalDue,
  validateUploadedCertificate,
} from './certificates.utils';
import { obtainCertificate } from './obtain-certificate';
import { writesPaused } from '../database-handover/database-target.runtime';

const TICK_MS = 60_000;
const ADVISORY_LOCK_ACME = 0x4c57000d;
const APPLY_TIMEOUT_MS = 60_000;
const CHALLENGE_TTL_MS = 3_600_000;

export interface CertificateSummary {
  id: string;
  names: string[];
  source: 'acme' | 'custom';
  notAfter: string | null;
  failures: number;
  lastError: string | null;
}

/**
 * Ingress certificates (3.6): built-in ACME for every exposed hostname (HTTP-01 through the ingress), renewal 30 days
 * before expiry, uploaded certificates taking precedence. Leader-elected with a session lock: an order can take a
 * minute, which no transaction should be held open for.
 */
@Injectable()
export class CertificatesService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CertificatesService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** Overridable for tests (e.g. a transport trusting a test CA). */
  transport: AcmeTransport | undefined;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly network: NetworkStateService,
    private readonly planner: WorkloadPlannerService,
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
    if (writesPaused('Certificates', this.logger)) return;

    if (this.running) return;

    this.running = true;

    try {
      await this.tick();
    } catch (error) {
      this.logger.warn(`Certificates: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      this.running = false;
    }
  }

  /** Issues or renews at most one certificate; returns the host handled, if any. */
  async tick(now = new Date()): Promise<string | null> {
    const runner = this.dataSource.createQueryRunner();

    await runner.connect();

    try {
      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [ADVISORY_LOCK_ACME]);

      if (!locked) return null;

      try {
        await this.dataSource.getRepository(AcmeChallengeEntity).delete({ expiresAt: LessThan(now) });

        const resources = await this.dataSource
          .getRepository(ResourceEntity)
          .find({ where: [{ kind: 'Cluster' }, { kind: 'Project' }, { kind: 'Deployment' }, { kind: 'StatusPage' }] });
        const acme = clusterSpecSchema.parse(resources.find((r) => r.kind === 'Cluster')?.spec).ingress?.acme;

        if (!acme?.enabled) return null;

        const certificates = await this.dataSource.getRepository(CertificateEntity).find();
        // Wildcard hostnames need DNS-01 through a DNS provider (3.15).
        const hosts = collectExposures(this.planner.parse(resources).parsed, statusPageHosts(resources))
          .sites.map((s) => s.host)
          .filter((h) => !h.startsWith('*.'));

        for (const host of hosts) {
          const current = pickCertificate(host, certificates, now);

          if (current?.source === 'custom' || !renewalDue(current, now)) continue;

          const row = certificates.find((c) => c.id === certificateId(host));

          if (row?.nextAttemptAt && row.nextAttemptAt > now) continue;

          await this.issue(host, acme, now);

          return host;
        }

        return null;
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_ACME]);
      }
    } finally {
      await runner.release();
    }
  }

  private async client(directory: string, email: string | undefined): Promise<AcmeClient> {
    const repo = this.dataSource.getRepository(AcmeAccountEntity);
    const account = await repo.findOne({ where: { directory } });

    if (account) return new AcmeClient(directory, account.privateKey, this.transport, account.accountUrl);

    const privateKey = generateKeyPairSync('ec', { namedCurve: 'P-256' })
      .privateKey.export({ format: 'pem', type: 'pkcs8' })
      .toString();
    const client = new AcmeClient(directory, privateKey, this.transport);
    const accountUrl = await client.register(email);

    await repo.save(repo.create({ directory, accountUrl, privateKey }));

    return client;
  }

  /** Waits until every reachable ingress node applied the revision that serves the challenges. */
  private async waitApplied(revision: number): Promise<void> {
    const deadline = Date.now() + APPLY_TIMEOUT_MS;

    for (;;) {
      const resources = await this.dataSource
        .getRepository(ResourceEntity)
        .find({ where: [{ kind: 'Cluster' }, { kind: 'IpPool' }, { kind: 'NodeGroup' }] });
      const nodes = await this.dataSource.getRepository(NodeEntity).find({ where: { lifecycle: Not('left') } });
      const ingress = ingressNodesOf(
        resources,
        clusterSpecSchema.parse(resources.find((r) => r.kind === 'Cluster')?.spec),
        nodes,
      );
      const reachable = new Set(
        plannerNodes(nodes)
          .filter((n) => n.reachable)
          .map((n) => n.name),
      );
      const waiting = nodes.filter(
        (n) => ingress.has(n.name) && reachable.has(n.name) && (n.appliedRevision ?? 0) < revision,
      );

      if (waiting.length === 0) return;

      if (Date.now() > deadline)
        throw new Error(`ingress nodes ${waiting.map((n) => n.name).join(', ')} did not apply the challenge in time`);

      await new Promise((r) => setTimeout(r, 1_000));
    }
  }

  private async issue(host: string, acme: { directory: string; email?: string }, now: Date): Promise<void> {
    const repo = this.dataSource.getRepository(CertificateEntity);
    const challenges = this.dataSource.getRepository(AcmeChallengeEntity);
    const id = certificateId(host);
    const previous = await repo.findOne({ where: { id } });

    try {
      const issued = await obtainCertificate(await this.client(acme.directory, acme.email), [host], {
        present: async (presented) => {
          for (const c of presented.filter((p) => p.type === 'http-01')) {
            await challenges.save(
              challenges.create({
                token: c.token,
                keyAuthorization: c.keyAuthorization,
                name: c.name,
                expiresAt: new Date(now.getTime() + CHALLENGE_TTL_MS),
              }),
            );
          }

          await this.waitApplied((await this.network.recompile()).revision);
        },
        cleanup: async (presented) => {
          if (presented.length > 0) await challenges.delete({ token: In(presented.map((p) => p.token)) });

          this.network.requestRecompile('ACME challenges done');
        },
      });

      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(CertificateEntity).save(
          manager.getRepository(CertificateEntity).create({
            id,
            names: [host],
            source: 'acme',
            certificatePem: issued.certificatePem,
            privateKey: issued.privateKeyPem,
            notAfter: issued.notAfter,
            failures: 0,
            nextAttemptAt: null,
            lastError: null,
          }),
        );
        await this.audit.record(manager, {
          actor: { type: 'system' },
          action: previous?.certificatePem ? 'certificate.renewed' : 'certificate.issued',
          target: `certificate/${id}`,
          details: { names: [host], notAfter: issued.notAfter.toISOString() },
        });
      });
      this.network.requestRecompile(`certificate ${id}`);
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      const failures = (previous?.failures ?? 0) + 1;

      this.logger.warn(`Certificate for ${host} failed: ${message}`);
      await this.dataSource.transaction(async (manager) => {
        await manager.getRepository(CertificateEntity).save(
          manager.getRepository(CertificateEntity).create({
            ...(previous ?? {
              id,
              names: [host],
              source: 'acme' as const,
              certificatePem: null,
              privateKey: null,
              notAfter: null,
            }),
            failures,
            nextAttemptAt: nextAttempt(failures, now),
            lastError: message,
          }),
        );
        await this.audit.record(manager, {
          actor: { type: 'system' },
          action: 'certificate.failed',
          target: `certificate/${id}`,
          details: { names: [host], failures, error: message },
        });
      });
    }
  }

  async list(): Promise<CertificateSummary[]> {
    return (await this.dataSource.getRepository(CertificateEntity).find({ order: { id: 'ASC' } })).map((c) => ({
      id: c.id,
      names: c.names,
      source: c.source,
      notAfter: c.notAfter?.toISOString() ?? null,
      failures: c.failures,
      lastError: c.lastError,
    }));
  }

  /** Stores an uploaded certificate; it takes precedence over ACME for the names it covers. */
  async upload(
    id: string,
    certificatePem: string,
    privateKeyPem: string,
    actor: { type: string; id?: string },
  ): Promise<CertificateSummary> {
    const { names, notAfter } = validateUploadedCertificate(certificatePem, privateKeyPem, new Date());

    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CertificateEntity);
      const existing = await repo.findOne({ where: { id } });

      if (existing && existing.source !== 'custom') throw new Error(`certificate ${id} is managed by ACME`);

      await repo.save(
        repo.create({
          id,
          names,
          source: 'custom',
          certificatePem,
          privateKey: privateKeyPem,
          notAfter,
          failures: 0,
          nextAttemptAt: null,
          lastError: null,
        }),
      );
      await this.audit.record(manager, {
        actor: actor as never,
        action: 'certificate.uploaded',
        target: `certificate/${id}`,
        details: { names, notAfter: notAfter.toISOString() },
      });
    });
    this.network.requestRecompile(`certificate ${id} uploaded`);

    return (await this.list()).find((c) => c.id === id) as CertificateSummary;
  }

  async remove(id: string, actor: { type: string; id?: string }): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const repo = manager.getRepository(CertificateEntity);
      const existing = await repo.findOne({ where: { id } });

      if (!existing) throw new Error(`certificate ${id} does not exist`);

      if (existing.source !== 'custom') throw new Error(`certificate ${id} is managed by ACME`);

      await repo.delete({ id });
      await this.audit.record(manager, {
        actor: actor as never,
        action: 'certificate.deleted',
        target: `certificate/${id}`,
        details: { names: existing.names },
      });
    });
    this.network.requestRecompile(`certificate ${id} deleted`);
  }

  /** Private keys for the certificates in an ingress state, added at push time only. */
  async keys(ids: string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();

    const rows = await this.dataSource.getRepository(CertificateEntity).find({ where: { id: In(ids) } });

    return new Map(rows.filter((r) => r.privateKey).map((r) => [r.id, r.privateKey as string]));
  }
}
