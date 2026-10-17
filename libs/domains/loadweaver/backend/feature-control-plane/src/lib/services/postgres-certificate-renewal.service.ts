import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, Not } from 'typeorm';

import { NodeEntity } from '../entities/node.entity';
import { PostgresCertificateEntity } from '../entities/postgres-certificate.entity';
import { NetworkStateService } from './network-state.service';
import { membersDueForRenewal } from './postgres-certificates';

const DAY_MS = 24 * 60 * 60 * 1000;
/** First check shortly after start, so frequent restarts don't postpone renewals forever. */
const FIRST_CHECK_MS = 5 * 60 * 1000;
const ADVISORY_LOCK_POSTGRES_CERTIFICATE_RENEWAL = 0x4c570044;

/**
 * Renews members' Postgres server certificates without waiting for an unrelated change (3.2): once a day, leader-
 * elected across replicas (advisory lock), members whose stored certificate passed two thirds of its lifetime get
 * their desired state re-pushed; the push issues and stores the new certificate, and the agent switches to it.
 */
@Injectable()
export class PostgresCertificateRenewalService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PostgresCertificateRenewalService.name);
  private timers: NodeJS.Timeout[] = [];

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly network: NetworkStateService,
  ) {}

  onApplicationBootstrap(): void {
    if ((process.env.LOADWEAVER_POSTGRES_CERTIFICATE_RENEWAL ?? 'on') === 'off') return;

    const run = () =>
      void this.tick().catch((error: unknown) =>
        this.logger.warn(`Postgres certificate renewal: ${error instanceof Error ? error.message : String(error)}`),
      );

    this.timers.push(setTimeout(run, FIRST_CHECK_MS), setInterval(run, DAY_MS));
    this.timers.forEach((t) => t.unref?.());
  }

  onModuleDestroy(): void {
    this.timers.forEach((t) => clearTimeout(t));
    this.timers = [];
  }

  /** One check; returns the members whose desired state was re-pushed for a renewal. */
  async tick(now: Date = new Date()): Promise<string[]> {
    const due = await this.dataSource.transaction(async (manager) => {
      const [{ locked }] = await manager.query('SELECT pg_try_advisory_xact_lock($1) AS locked', [
        ADVISORY_LOCK_POSTGRES_CERTIFICATE_RENEWAL,
      ]);

      if (!locked) return [];

      const members = await manager
        .getRepository(NodeEntity)
        .find({ select: { name: true }, where: { controlPlane: true, lifecycle: Not('left') } });
      const stored = await manager
        .getRepository(PostgresCertificateEntity)
        .find({ select: { nodeName: true, notBefore: true, notAfter: true } });

      return membersDueForRenewal(stored, new Set(members.map((m) => m.name)), now);
    });

    if (due.length > 0) await this.network.repush(due, 'Postgres server certificate renewal');

    return due;
  }
}
