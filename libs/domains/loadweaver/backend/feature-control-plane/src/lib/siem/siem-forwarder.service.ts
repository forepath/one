import { LOG_SOURCES, type LogSource, type SiemTarget } from '@forepath/loadweaver/shared/util-model';
import { OpenSearchService } from '@forepath/shared/backend/util-opensearch';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { hostname } from 'node:os';
import { DataSource } from 'typeorm';

import { AuditEventEntity } from '../entities/audit-event.entity';
import { LogsService, SINCE_LAG_MS, type LogLine } from '../logs/logs.service';
import { ClusterIdentityService } from '../services/cluster-identity.service';
import { PlatformCredentialsService } from '../services/platform-credentials.service';
import { ResourceStoreService } from '../services/resource-store.service';
import { credentialHeaders, otlpLogsBody, syslogMessage, type SiemRecord } from './siem-formats';
import { sendJson, sendSyslog } from './siem-sender';
import { writesPaused } from '../database-handover/database-target.runtime';

const TICK_MS = 10_000;
const ADVISORY_LOCK_SIEM = 0x4c570017;
const BATCH = 500;
const MAX_BACKOFF_MS = 600_000;
const MAX_ROUNDS = 20;
const MAX_REQUEST_BYTES = 1_000_000;
/** Log messages are cut to this length for forwarding. */
const MAX_MESSAGE = 8_192;

interface CursorRow {
  name: string;
  audit_seq: string;
  logs_after: string | null;
  failures: number;
  next_attempt_at: Date | null;
}

export function auditRecord(e: AuditEventEntity): SiemRecord {
  return {
    kind: 'audit',
    at: new Date(e.at).toISOString(),
    severity: 'info',
    message: `${e.action} ${e.target}`,
    attributes: {
      seq: Number(e.seq),
      action: e.action,
      target: e.target,
      actorType: e.actorType,
      ...(e.actorId ? { actorId: e.actorId } : {}),
      ...(e.project ? { project: e.project } : {}),
      details: JSON.stringify(e.details).slice(0, 4_000),
      // Every entry carries its chain hash: the SIEM holds the anchors (3.18).
      prevHash: e.prevHash,
      hash: e.hash,
    },
  };
}

export function logRecord(line: LogLine): SiemRecord {
  const labels = Object.fromEntries(Object.entries(line.labels ?? {}).filter(([, v]) => v !== undefined)) as Record<
    string,
    string
  >;

  return {
    kind: 'log',
    at: line.at,
    severity: line.level,
    message: line.message.slice(0, MAX_MESSAGE),
    attributes: { source: line.source, node: line.node, ...(line.site ? { site: line.site } : {}), ...labels },
  };
}

/** The record of a connection test (3.41): marked as a test, not a security event. */
export function siemTestRecord(now: Date): SiemRecord {
  return {
    kind: 'log',
    at: now.toISOString(),
    severity: 'info',
    message: 'Loadweaver SIEM connection test - not a security event, safe to ignore',
    attributes: { source: 'loadweaver', event: 'integration.test', test: true },
  };
}

/** Records per round: 500, halved per consecutive failure down to 8. */
export function batchSize(failures: number): number {
  return Math.max(8, BATCH >> Math.min(Math.max(0, failures), 6));
}

/** Splits records into chunks of at most `maxBytes` of JSON (a single larger record goes alone). */
export function chunkBySize(records: readonly SiemRecord[], maxBytes: number): SiemRecord[][] {
  const chunks: SiemRecord[][] = [];
  let current: SiemRecord[] = [];
  let size = 0;

  for (const record of records) {
    const bytes = Buffer.byteLength(JSON.stringify(record));

    if (current.length && size + bytes > maxBytes) {
      chunks.push(current);
      current = [];
      size = 0;
    }

    current.push(record);
    size += bytes;
  }

  if (current.length) chunks.push(current);

  return chunks;
}

/** Exponential backoff after failed deliveries: 10 s, 20 s, ... up to 10 minutes. */
export function backoffMs(failures: number): number {
  return Math.min(MAX_BACKOFF_MS, 10_000 * 2 ** Math.max(0, failures - 1));
}

/**
 * SIEM forwarding (3.18): the audit log (with its hash chain) and selected log sources to each configured target —
 * syslog, OTLP or webhook — in order, at least once: a target's cursors only move after it accepted a batch, and a
 * failing target backs off without holding up the others. One replica forwards at a time.
 */
@Injectable()
export class SiemForwarderService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(SiemForwarderService.name);
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  /** How long stored log lines wait before they are forwarded (see `LogsService.since`). */
  logLagMs = SINCE_LAG_MS;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly resources: ResourceStoreService,
    private readonly logs: LogsService,
    private readonly opensearch: OpenSearchService,
    private readonly credentials: PlatformCredentialsService,
    private readonly identity: ClusterIdentityService,
  ) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      if (!writesPaused('SIEM forwarding', this.logger)) void this.tick();
    }, TICK_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async tick(now = new Date()): Promise<boolean> {
    if (this.running) return false;

    this.running = true;

    const runner = this.dataSource.createQueryRunner();

    try {
      await runner.connect();

      const [{ locked }] = await runner.query('SELECT pg_try_advisory_lock($1) AS locked', [ADVISORY_LOCK_SIEM]);

      if (!locked) return false;

      try {
        const targets = (await this.resources.clusterSpec()).observability?.siem ?? [];

        await this.dataSource.query(`DELETE FROM lw_siem_cursors WHERE NOT (name = ANY($1))`, [
          targets.map((t) => t.name),
        ]);

        for (const target of targets) await this.forward(target, now);
      } finally {
        await runner.query('SELECT pg_advisory_unlock($1)', [ADVISORY_LOCK_SIEM]);
      }

      return true;
    } catch (error) {
      this.logger.warn(`SIEM forwarding: ${error instanceof Error ? error.message : String(error)}`);

      return false;
    } finally {
      await runner.release();
      this.running = false;
    }
  }

  private async forward(target: SiemTarget, now: Date): Promise<void> {
    await this.dataSource.query(`INSERT INTO lw_siem_cursors (name) VALUES ($1) ON CONFLICT DO NOTHING`, [target.name]);

    const [cursor]: CursorRow[] = await this.dataSource.query(`SELECT * FROM lw_siem_cursors WHERE name = $1`, [
      target.name,
    ]);

    if (cursor.next_attempt_at && new Date(cursor.next_attempt_at) > now) return;

    // After repeated failures the batches get smaller, so one record a receiver rejects (size, content) can't
    // block a target for good.
    const batch = batchSize(cursor.failures);
    let auditSeq = String(cursor.audit_seq);
    let logsAfter = cursor.logs_after;

    try {
      // Catch up within the tick (busy sources), a bounded number of rounds.
      for (let round = 0; round < MAX_ROUNDS; round++) {
        const records: SiemRecord[] = [];
        let more = false;

        if (target.sources.includes('audit')) {
          const events = await this.dataSource
            .getRepository(AuditEventEntity)
            .createQueryBuilder('a')
            .where('a.seq > :seq', { seq: auditSeq })
            .orderBy('a.seq', 'ASC')
            .limit(batch)
            .getMany();

          records.push(...events.map(auditRecord));
          more ||= events.length === batch;
          auditSeq = events.length ? String(events.at(-1)?.seq) : auditSeq;
        }

        const sources = target.sources.filter((s): s is LogSource => (LOG_SOURCES as readonly string[]).includes(s));

        if (sources.length && this.opensearch.isEnabled()) {
          const page = await this.logs.since(
            { sources, ...(target.levels ? { levels: target.levels } : {}) },
            logsAfter,
            batch,
            this.logLagMs,
          );

          records.push(...page.lines.map(logRecord));
          more ||= page.lines.length === batch;
          logsAfter = page.after;
        }

        if (records.length) await this.send(target, records);

        await this.dataSource.query(
          `UPDATE lw_siem_cursors SET audit_seq = $2, logs_after = $3, forwarded = forwarded + $4, failures = 0,
             last_error = NULL, next_attempt_at = NULL, updated_at = now() WHERE name = $1`,
          [target.name, auditSeq, logsAfter, records.length],
        );
        cursor.failures = 0;

        if (!more) break;
      }
    } catch (error) {
      const message = (error instanceof Error ? error.message : String(error)).slice(0, 1000);
      const failures = cursor.failures + 1;

      this.logger.warn(`SIEM target ${target.name}: ${message}`);
      await this.dataSource.query(
        `UPDATE lw_siem_cursors SET failures = $2, last_error = $3, next_attempt_at = $4, updated_at = now() WHERE name = $1`,
        [target.name, failures, message, new Date(now.getTime() + backoffMs(failures))],
      );
    }
  }

  private async send(target: SiemTarget, records: SiemRecord[]): Promise<void> {
    if (target.type === 'syslog') {
      const host = hostname();

      await sendSyslog(
        new URL(target.url),
        records.map((r) => syslogMessage(r, host)),
      );

      return;
    }

    const headers = target.credentials
      ? credentialHeaders(await this.credentials.providerConfig(target.credentials))
      : {};

    const { clusterId } = target.type === 'otlp' ? await this.identity.cluster() : { clusterId: '' };

    // Requests stay below ~1 MB; chunks go in order, so a failure retries from the last accepted cursor.
    for (const chunk of chunkBySize(records, MAX_REQUEST_BYTES))
      await sendJson(
        target.url,
        target.type === 'otlp' ? otlpLogsBody(chunk, clusterId) : { source: 'loadweaver', records: chunk },
        headers,
      );
  }

  /**
   * Connection test (3.41): one clearly marked test record to the target, through the same path as forwarding.
   * Leaves the target's cursors and delivery state untouched.
   */
  async sendTest(target: SiemTarget, now = new Date()): Promise<void> {
    await this.send(target, [siemTestRecord(now)]);
  }

  /** Delivery state per target (for the console and `GET /cluster/siem`). */
  async status(): Promise<
    { name: string; forwarded: number; failures: number; lastError: string | null; nextAttemptAt: string | null }[]
  > {
    const rows: (CursorRow & { forwarded: string; last_error: string | null })[] = await this.dataSource.query(
      `SELECT * FROM lw_siem_cursors ORDER BY name`,
    );

    return rows.map((r) => ({
      name: r.name,
      forwarded: Number(r.forwarded),
      failures: r.failures,
      lastError: r.last_error,
      nextAttemptAt: r.next_attempt_at ? new Date(r.next_attempt_at).toISOString() : null,
    }));
  }
}
