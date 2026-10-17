import { isOtelEffectivelyEnabled, resolveOtelRuntimeConfig, setGauge } from '@forepath/shared/backend/util-otel';
import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

const METER = 'loadweaver.cluster';
const INTERVAL_MS = 30_000;
const LIFECYCLES = ['active', 'cordoned', 'draining', 'leaving'] as const;
const PLAN_STATUSES = ['pending', 'applying', 'rolling-back', 'rollback-failed'] as const;
const SEVERITIES = ['info', 'warning', 'critical'] as const;
const RESOURCES = ['cpuMillis', 'memoryBytes', 'diskBytes'] as const;

/**
 * Cluster summary for the shared OpenTelemetry module (3.18: its Prometheus endpoint and OTLP push): nodes by
 * lifecycle and connection, open plans by status, firing alerts by severity, capacity and usage. Only fixed label
 * sets, so no series goes stale; per-series data is scraped from `GET /metrics/prometheus`, scoped by access.
 */
@Injectable()
export class OtelSummaryCollector implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(OtelSummaryCollector.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(@InjectDataSource() private readonly dataSource: DataSource) {}

  onApplicationBootstrap(): void {
    if (!isOtelEffectivelyEnabled(resolveOtelRuntimeConfig())) return;

    void this.collect();
    this.timer = setInterval(() => void this.collect(), INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async collect(): Promise<void> {
    try {
      const nodes: { lifecycle: string; connected: boolean; n: number }[] = await this.dataSource.query(
        `SELECT lifecycle, connected, count(*)::int AS n FROM lw_nodes WHERE lifecycle <> 'left' GROUP BY 1, 2`,
      );

      for (const lifecycle of LIFECYCLES)
        for (const connected of [true, false])
          setGauge(
            METER,
            'loadweaver.nodes',
            nodes.find((r) => r.lifecycle === lifecycle && r.connected === connected)?.n ?? 0,
            { lifecycle, connected: String(connected) },
          );

      const plans: { status: string; n: number }[] = await this.dataSource.query(
        `SELECT status, count(*)::int AS n FROM lw_plans WHERE status = ANY($1) GROUP BY 1`,
        [PLAN_STATUSES],
      );

      for (const status of PLAN_STATUSES)
        setGauge(METER, 'loadweaver.plans', plans.find((r) => r.status === status)?.n ?? 0, { status });

      const alerts: { severity: string; n: number }[] = await this.dataSource.query(
        `SELECT severity, count(*)::int AS n FROM lw_alerts WHERE state = 'firing' GROUP BY 1`,
      );

      for (const severity of SEVERITIES)
        setGauge(METER, 'loadweaver.alerts.firing', alerts.find((r) => r.severity === severity)?.n ?? 0, { severity });

      const [totals]: Record<string, string | null>[] = await this.dataSource.query(
        `SELECT ${RESOURCES.map(
          (r) => `sum((capacity->>'${r}')::numeric) AS "capacity_${r}", sum((usage->>'${r}')::numeric) AS "usage_${r}"`,
        ).join(', ')} FROM lw_nodes WHERE lifecycle <> 'left'`,
      );

      for (const resource of RESOURCES) {
        setGauge(METER, 'loadweaver.capacity', Number(totals?.[`capacity_${resource}`] ?? 0), { resource });
        setGauge(METER, 'loadweaver.usage', Number(totals?.[`usage_${resource}`] ?? 0), { resource });
      }
    } catch (error) {
      this.logger.debug(`Summary metrics: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}
