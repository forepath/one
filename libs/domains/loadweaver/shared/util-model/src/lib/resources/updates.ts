import { z } from 'zod';

import { resourceNameSchema } from '../metadata';
import { selectorSchema } from '../selector';

/**
 * Update policy of the cluster (3.26), `Cluster.spec.updates`:
 * - `notify`: new releases (and OS security snapshots) are announced; operators create and approve update plans;
 * - `auto-patch` (default): additionally, patch releases and OS security updates become update plans that run on
 *   their own inside maintenance windows (still visible, still audited); minor / major releases wait for an approval;
 * - `manual`: no automatic checks at all (air-gapped clusters import bundles by upload).
 */
export const updatePolicyModeSchema = z.enum(['notify', 'auto-patch', 'manual']);
export type UpdatePolicyMode = z.infer<typeof updatePolicyModeSchema>;

export const clusterUpdatesSchema = z
  .object({
    policy: updatePolicyModeSchema.default('auto-patch'),
    /** Release channel (announced through the shared updates feature): `beta` includes prereleases. */
    channel: z.enum(['stable', 'beta']).default('stable'),
    /**
     * Where bundles come from: the GitHub release (default), a mirror (`<mirrorUrl>/<version>/loadweaver-bundle-
     * <version>.tar`, HTTPS only), or uploads only (air-gapped).
     */
    source: z.enum(['github', 'mirror', 'upload']).default('github'),
    mirrorUrl: z
      .string()
      .max(500)
      .regex(/^https:\/\/[A-Za-z0-9.-]+(:\d{1,5})?(\/[A-Za-z0-9._~/-]*)?$/, 'mirror URL must be a plain https URL')
      .optional(),
    /** Include OS package updates (frozen apt snapshot, reboots where needed) in automatic patch updates. */
    osUpdates: z.boolean().default(true),
    /** Health gates: how long a step must stay healthy, and how long it may take before it counts as failed. */
    settleSeconds: z.number().int().min(10).max(3600).default(60),
    stepTimeoutMinutes: z
      .number()
      .int()
      .min(5)
      .max(24 * 60)
      .default(30),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.source === 'mirror' && !value.mirrorUrl)
      ctx.addIssue({ code: 'custom', path: ['mirrorUrl'], message: 'source mirror needs a mirrorUrl' });
  });
export type ClusterUpdates = z.infer<typeof clusterUpdatesSchema>;

export const WEEKDAYS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'] as const;
export type Weekday = (typeof WEEKDAYS)[number];

const timeOfDay = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'time must be HH:MM (24 h)');

function validTimeZone(zone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: zone });

    return true;
  } catch {
    return false;
  }
}

/**
 * A maintenance window (3.26): when updates that disturb nodes (restarts, drains, reboots) may run on the selected
 * nodes. Weekly recurrence in a time zone (DST-aware); `end` before `start` crosses midnight ("Tue 23:00–02:00"
 * starts on Tuesday). Nodes outside every window are updated only by plans that ignore windows (emergency fixes with
 * an explicit approval). An update that doesn't fit into one window pauses and continues in the next.
 */
export const maintenanceWindowSpecSchema = z
  .object({
    description: z.string().max(1024).optional(),
    /** Nodes by name / labels; empty matches every node. */
    selector: selectorSchema.default({}),
    /** Limit to nodes of these sites. */
    sites: z.array(resourceNameSchema).max(64).optional(),
    days: z.array(z.enum(WEEKDAYS)).min(1).max(7),
    start: timeOfDay,
    end: timeOfDay,
    timeZone: z.string().max(64).refine(validTimeZone, 'unknown time zone'),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.start === value.end)
      ctx.addIssue({ code: 'custom', path: ['end'], message: 'end must differ from start' });
  });
export type MaintenanceWindowSpec = z.infer<typeof maintenanceWindowSpecSchema>;
