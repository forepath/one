import { hostnamePatternSchema, resourceNameSchema, selectorSchema } from '@forepath/loadweaver/shared/util-model';
import { z } from 'zod';

/** `<requests>/<unit>`, e.g. `100/m`. */
export const rateSchema = z
  .string()
  .regex(/^\d{1,9}\/(s|m|h|d|second|minute|hour|day)$/, 'rates are "<requests>/<s|m|h|d>"');

/** `x-loadweaver` on a service (3.11): everything Loadweaver needs beyond plain compose. */
export const serviceExtensionSchema = z
  .object({
    replicas: z.number().int().min(0).max(1000).optional(),
    groups: z.array(resourceNameSchema).optional(),
    placement: z
      .object({ selector: selectorSchema.optional(), spread: z.enum(['node', 'site']).optional() })
      .strict()
      .optional(),
    runtime: z.enum(['runc', 'sandboxed']).optional(),
    exposure: z
      .object({
        http: z
          .array(
            z
              .object({
                host: hostnamePatternSchema,
                port: z.number().int().min(1).max(65535),
                // Same rule as the agent protocol: no whitespace, quotes or backslashes.
                path: z
                  .string()
                  .regex(/^\/[^\s"\\]*$/)
                  .max(2048)
                  .optional(),
                /** Cluster-wide limits (3.6): per client IP, per API-key header, for the route in total. */
                rateLimit: z
                  .object({
                    perIp: rateSchema.optional(),
                    perKey: z
                      .object({ header: z.string().regex(/^[a-z0-9-]{1,64}$/i), rate: rateSchema })
                      .strict()
                      .optional(),
                    total: rateSchema.optional(),
                  })
                  .strict()
                  .optional(),
                /** Coraza WAF with the OWASP Core Rule Set for this hostname (3.6). */
                waf: z.enum(['off', 'monitor', 'enforce']).optional(),
              })
              .strict(),
          )
          .optional(),
      })
      .strict()
      .optional(),
    pinned: z
      .object({ reason: z.string().min(3).max(500) })
      .strict()
      .optional(),
    job: z
      .object({ phase: z.enum(['before', 'after']).default('before') })
      .strict()
      .optional(),
    cron: z
      .object({
        schedule: z.string().regex(/^(@(yearly|monthly|weekly|daily|hourly)|(\S+\s+){4}\S+)$/, 'invalid cron schedule'),
        timezone: z.string().max(64).default('UTC'),
        concurrency: z.enum(['allow', 'forbid', 'replace']).default('forbid'),
        retries: z.number().int().min(0).max(10).default(0),
        timeout: z.string().max(32).optional(),
      })
      .strict()
      .optional(),
    autoscale: z
      .object({
        min: z.number().int().min(1),
        max: z.number().int().min(1).max(1000),
        metric: z.enum(['cpu', 'memory', 'requests', 'custom']),
        target: z.number().positive(),
        customMetric: z.string().max(253).optional(),
      })
      .strict()
      .refine((a) => a.max >= a.min, 'max must be at least min')
      .refine((a) => a.metric !== 'custom' || !!a.customMetric, 'custom autoscaling needs customMetric')
      .optional(),
    liveMigration: z.boolean().optional(),
  })
  .strict()
  .superRefine((ext, ctx) => {
    if (ext.job && ext.cron) ctx.addIssue({ code: 'custom', message: 'a service is either a job or a cron job' });
  });
export type ServiceExtension = z.infer<typeof serviceExtensionSchema>;

/** `x-loadweaver` on a volume (3.5). */
export const volumeExtensionSchema = z
  .object({
    size: z.union([z.string(), z.number()]).optional(),
    replicas: z.number().int().min(1).max(5).optional(),
    crossSite: z.enum(['async', 'sync', 'none']).optional(),
    pinned: z
      .object({ reason: z.string().min(3).max(500) })
      .strict()
      .optional(),
  })
  .strict();
export type VolumeExtension = z.infer<typeof volumeExtensionSchema>;
