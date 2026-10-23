import { z } from 'zod';

/** A project: the access unit inside a cluster (3.17) with its resource defaults (3.11). */
export const projectSpecSchema = z
  .object({
    description: z.string().max(1024).optional(),
    /** Requests for services without `deploy.resources` (3.11). */
    defaults: z
      .object({
        cpu: z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .default('0.25'),
        memory: z
          .string()
          .regex(/^\d+(\.\d+)?[kKmMgG]?[bB]?$/)
          .default('256m'),
        volumeSize: z
          .string()
          .regex(/^\d+(\.\d+)?[kKmMgGtT]?[bB]?$/)
          .default('10g'),
      })
      .strict()
      .default({ cpu: '0.25', memory: '256m', volumeSize: '10g' }),
    /** Limits set by cluster admins (3.17); plans exceeding them are rejected. Unset: unlimited. */
    quota: z
      .object({
        /** Requested CPUs of all replicas. */
        cpu: z
          .string()
          .regex(/^\d+(\.\d+)?$/)
          .optional(),
        /** Requested memory of all replicas. */
        memory: z
          .string()
          .regex(/^\d+(\.\d+)?[kKmMgGtT]?[bB]?$/)
          .optional(),
        /** Volume sizes (each volume counted once, replicas not included). */
        storage: z
          .string()
          .regex(/^\d+(\.\d+)?[kKmMgGtT]?[bB]?$/)
          .optional(),
        /** Public addresses (egress addresses of the project's policies). */
        publicIps: z.number().int().min(0).max(65_536).optional(),
        /** Published L4 ports (port forwards). */
        ports: z.number().int().min(0).max(65_536).optional(),
      })
      .strict()
      .optional(),
    /**
     * Usage billing (3.24): the Decabill subscription this project's metered usage is billed on. Decabill's
     * Loadweaver usage module collects the hourly buckets of all projects mapped to a subscription. Unset: not billed.
     */
    billing: z
      .object({
        decabillSubscriptionId: z.string().uuid(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type ProjectSpec = z.infer<typeof projectSpecSchema>;

/** A Docker Compose project with `x-loadweaver` extensions (P7, 3.11): the unit of plan, apply and migration. */
export const deploymentSpecSchema = z
  .object({
    /** The compose file, unchanged; it stays valid for plain `docker compose`. */
    compose: z
      .string()
      .min(1)
      .max(1024 * 1024),
    /** Values for `${VAR}` interpolation (never secrets; those are secret references). */
    variables: z.record(z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string().max(4096)).optional(),
  })
  .strict();
export type DeploymentSpec = z.infer<typeof deploymentSpecSchema>;
