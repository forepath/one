import { z } from 'zod';

import { dnsNameSchema, secretRefSchema } from './edge';

/** Where log lines come from (3.14). */
export const LOG_SOURCES = [
  'container',
  'proxy',
  'firewall',
  'routing',
  'tunnel',
  'ingress',
  'failover',
  'storage',
  'runtime',
  'control-plane',
] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

/**
 * Retention defaults per source (3.18): access logs 14 days, raw firewall decisions (denied / observed flows)
 * 7 days, platform and container logs 30 days.
 */
export const DEFAULT_LOG_RETENTION_DAYS: Record<LogSource, number> = {
  container: 30,
  proxy: 14,
  firewall: 7,
  routing: 30,
  tunnel: 30,
  ingress: 14,
  failover: 30,
  storage: 30,
  runtime: 30,
  'control-plane': 30,
};

/** What a SIEM target receives: the audit log and / or log sources. */
export const SIEM_SOURCES = ['audit', ...LOG_SOURCES] as const;

/**
 * A SIEM forwarding target (3.18): syslog (RFC 5424 over `udp://`, `tcp://` or `tls://host:port`), OTLP/HTTP logs
 * (the collector's `/v1/logs` URL) or a webhook (JSON batches). Credentials (`Authorization` or headers) come from a
 * secret: a JSON object of headers, or a token sent as `Bearer`.
 */
export const siemTargetSchema = z
  .object({
    name: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/),
    type: z.enum(['syslog', 'otlp', 'webhook']),
    url: z.string().max(1024),
    sources: z.array(z.enum(SIEM_SOURCES)).min(1).max(SIEM_SOURCES.length),
    /** Log levels to forward (audit entries always go); default: all. */
    levels: z
      .array(z.enum(['debug', 'info', 'warn', 'error']))
      .max(4)
      .optional(),
    credentials: secretRefSchema.optional(),
  })
  .strict()
  .superRefine((target, ctx) => {
    let url: URL;

    try {
      url = new URL(target.url);
    } catch {
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'invalid URL' });

      return;
    }

    const schemes = target.type === 'syslog' ? ['udp:', 'tcp:', 'tls:'] : ['https:', 'http:'];

    if (!schemes.includes(url.protocol))
      ctx.addIssue({ code: 'custom', path: ['url'], message: `${target.type} targets use ${schemes.join(' / ')}` });

    if (target.type === 'syslog' && (!url.hostname || !url.port))
      ctx.addIssue({ code: 'custom', path: ['url'], message: 'syslog targets need a host and port' });

    if (target.type === 'syslog' && target.credentials)
      ctx.addIssue({
        code: 'custom',
        path: ['credentials'],
        message: 'syslog targets take no credentials (use tls://)',
      });
  });
export type SiemTarget = z.infer<typeof siemTargetSchema>;

/** Observability settings of the cluster (3.14, 3.18). */
export const clusterObservabilitySchema = z
  .object({
    /** Days to keep logs, per source; unset sources keep their default. */
    logRetentionDays: z.partialRecord(z.enum(LOG_SOURCES), z.number().int().min(1).max(3650)).optional(),
    /** Who gets built-in alerts by email (3.18); webhooks subscribed to alert events always do. */
    alertEmails: z.array(z.string().email().max(254)).max(20).optional(),
    /** Forwarding of the audit log and logs to SIEMs (3.18). */
    siem: z
      .array(siemTargetSchema)
      .max(10)
      .refine((targets) => new Set(targets.map((t) => t.name)).size === targets.length, 'SIEM target names are unique')
      .optional(),
  })
  .strict();
export type ClusterObservability = z.infer<typeof clusterObservabilitySchema>;

/** `30s`, `5m`, `1h`, `7d`. */
export const durationSchema = z.string().regex(/^\d{1,6}(s|m|h|d)$/, 'a duration like 30s, 5m, 1h, 7d');

export function durationMs(value: string): number {
  const match = /^(\d+)(s|m|h|d)$/.exec(value);

  if (!match) return 0;

  return Number(match[1]) * { s: 1_000, m: 60_000, h: 3_600_000, d: 86_400_000 }[match[2] as 's' | 'm' | 'h' | 'd'];
}

const comparison = z.enum(['>', '>=', '<', '<=']);

/**
 * A custom alert rule (3.18), a policy like any other (plan / apply, cluster-wide or per project): a threshold on a
 * metric, the absence of a metric, or a count of log lines over a window.
 */
export const alertRuleSpecSchema = z
  .object({
    description: z.string().max(1024).optional(),
    severity: z.enum(['info', 'warning', 'critical']).default('warning'),
    condition: z.union([
      z
        .object({
          metric: z
            .object({
              name: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/),
              /** Exact entity or a prefix ending in `*`. */
              entity: z.string().max(255).optional(),
              node: z.string().max(63).optional(),
              aggregation: z.enum(['avg', 'min', 'max', 'sum']).default('avg'),
              over: durationSchema.default('5m'),
              groupBy: z.enum(['entity', 'node', 'none']).default('entity'),
              /** `value`: the aggregate over the window; `change`: last minus first per-minute value (rate of change). */
              mode: z.enum(['value', 'change']).default('value'),
              op: comparison,
              threshold: z.number().finite(),
            })
            .strict(),
        })
        .strict(),
      z
        .object({
          absence: z
            .object({
              metric: z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/),
              entity: z.string().max(255).optional(),
              for: durationSchema.default('5m'),
            })
            .strict(),
        })
        .strict(),
      z
        .object({
          logs: z
            .object({
              sources: z.array(z.enum(LOG_SOURCES)).max(10).optional(),
              levels: z
                .array(z.enum(['debug', 'info', 'warn', 'error']))
                .max(4)
                .optional(),
              text: z.string().max(256).optional(),
              service: z.string().max(63).optional(),
              over: durationSchema.default('5m'),
              op: comparison,
              threshold: z.number().int().min(0),
            })
            .strict(),
        })
        .strict(),
    ]),
    /** How long the condition has to hold before the alert fires. */
    for: durationSchema.default('0s'),
    notify: z
      .object({
        emails: z.array(z.string().email().max(254)).max(20).default([]),
        /** Publish to the webhook endpoints subscribed to alert events. */
        webhooks: z.boolean().default(true),
      })
      .strict()
      .default({ emails: [], webhooks: true }),
    /** Unacknowledged firing alerts are sent again this often. */
    repeatEvery: durationSchema.default('4h'),
    /** Escalation (3.18): still unacknowledged this long after firing, the alert also goes to these addresses. */
    escalate: z
      .object({
        after: durationSchema,
        emails: z.array(z.string().email().max(254)).min(1).max(20),
      })
      .strict()
      .optional(),
  })
  .strict();
export type AlertRuleSpec = z.infer<typeof alertRuleSpecSchema>;

const metricName = z.string().regex(/^[a-z][a-z0-9_.]{0,63}$/);

/** A query of the dashboard query builder (3.18): over metrics, flows or logs, within the global filter. */
export const dashboardQuerySchema = z.union([
  z
    .object({
      metrics: z
        .object({
          metric: metricName,
          /** Exact entity or a prefix ending in `*`. */
          entity: z.string().max(255).optional(),
          node: z.string().max(63).optional(),
          aggregation: z.enum(['avg', 'min', 'max', 'sum']).default('avg'),
          groupBy: z.enum(['entity', 'node', 'project', 'none']).default('entity'),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      flows: z
        .object({
          decision: z.enum(['allowed', 'denied', 'observed']).optional(),
          node: z.string().max(63).optional(),
          policy: z.string().max(255).optional(),
          limit: z.number().int().min(1).max(500).default(20),
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      logs: z
        .object({
          sources: z.array(z.enum(LOG_SOURCES)).max(10).optional(),
          levels: z
            .array(z.enum(['debug', 'info', 'warn', 'error']))
            .max(4)
            .optional(),
          text: z.string().max(256).optional(),
          service: z.string().max(63).optional(),
          deployment: z.string().max(63).optional(),
          limit: z.number().int().min(1).max(1000).default(100),
        })
        .strict(),
    })
    .strict(),
]);
export type DashboardQuery = z.infer<typeof dashboardQuerySchema>;

/**
 * A custom dashboard (3.18): widgets on a 12-column grid, each with a query-builder query; shown within the global
 * filter (time range, project, labels) and only with data the viewer may read. A YAML resource like any other, so
 * it lives in Git and goes through plans.
 */
export const dashboardSpecSchema = z
  .object({
    title: z.string().min(1).max(255),
    description: z.string().max(1024).optional(),
    /** Default time range when the URL doesn't set one. */
    range: durationSchema.default('6h'),
    widgets: z
      .array(
        z
          .object({
            title: z.string().min(1).max(255),
            type: z.enum(['line', 'area', 'bar', 'stat', 'table', 'logs']),
            query: dashboardQuerySchema,
            /** Grid position and size (columns 0–11, rows from the top). */
            x: z.number().int().min(0).max(11).default(0),
            y: z.number().int().min(0).max(1000).default(0),
            w: z.number().int().min(1).max(12).default(6),
            h: z.number().int().min(1).max(24).default(4),
            unit: z.string().max(16).optional(),
          })
          .strict()
          .refine((w) => w.x + w.w <= 12, 'a widget must fit in the 12 columns')
          .refine(
            (w) => (w.type === 'logs') === 'logs' in w.query,
            'logs widgets show log queries, and log queries only fit logs widgets',
          ),
      )
      .max(50),
  })
  .strict();
export type DashboardSpec = z.infer<typeof dashboardSpecSchema>;

/**
 * A public status page of a project (3.25), hosted by the cluster and served through the ingress: the listed services'
 * state (operational / degraded / outage), their monthly uptime from the SLOs, and incident notes. Shows nothing else.
 */
export const statusPageSpecSchema = z
  .object({
    /** The page's hostname (no wildcards); gets a certificate and DNS record like any exposed hostname. */
    host: dnsNameSchema,
    title: z.string().min(1).max(255),
    description: z.string().max(1024).optional(),
    /** Services shown, as `deployment/service` with a display name. */
    services: z
      .array(
        z
          .object({
            service: z.string().regex(/^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\/[a-z0-9]([a-z0-9_.-]{0,61}[a-z0-9])?$/),
            name: z.string().min(1).max(100),
          })
          .strict(),
      )
      .min(1)
      .max(50),
    /** Show the monthly uptime of services with an availability SLO. */
    showUptime: z.boolean().default(true),
  })
  .strict();
export type StatusPageSpec = z.infer<typeof statusPageSpecSchema>;
