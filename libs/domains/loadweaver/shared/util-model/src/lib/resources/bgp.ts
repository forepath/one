import { z } from 'zod';

import { resourceNameSchema } from '../metadata';
import { secretRefSchema } from './edge';
import { cidrStringSchema } from './policy';

import { isIp } from '@forepath/loadweaver/shared/util-network';

export const asnSchema = z.number().int().min(1).max(4_294_967_295);
const communitySchema = z.string().regex(/^\d{1,5}:\d{1,5}$/, 'communities are "<asn>:<value>"');

/**
 * The cluster's own ASN and the prefixes it holds (3.27). Only these (and IP pool addresses) are ever announced.
 * `rtrServers` are RPKI validators (RTR); with them, RPKI-invalid routes are rejected on import.
 */
export const autonomousSystemSpecSchema = z
  .object({
    asn: asnSchema,
    prefixes: z.array(cidrStringSchema).max(256).default([]),
    rtrServers: z
      .array(
        z
          .object({
            address: z.string().refine(isIp, 'expected an IP address'),
            port: z.number().int().min(1).max(65_535).default(323),
          })
          .strict(),
      )
      .max(4)
      .default([]),
  })
  .strict();
export type AutonomousSystemSpec = z.infer<typeof autonomousSystemSpecSchema>;

export const BGP_IMPORT_MODES = ['none', 'default', 'partial', 'full'] as const;
const DEFAULT_MAX_PREFIXES: Record<(typeof BGP_IMPORT_MODES)[number], number> = {
  none: 1,
  default: 10,
  partial: 100_000,
  full: 2_000_000,
};

/** An upstream, IXP route server or provider BGP the nodes of a node group (e.g. `edge`) peer with (3.27). */
export const bgpPeerSpecSchema = z
  .object({
    asn: asnSchema,
    address: z.string().refine(isIp, 'expected an IP address'),
    nodeGroup: resourceNameSchema,
    multihop: z.number().int().min(1).max(255).optional(),
    password: secretRefSchema.optional(),
    bfd: z.boolean().default(true),
    /** What to accept: nothing, a default route (egress), the upstream's customer routes, or a full table. */
    import: z.enum(BGP_IMPORT_MODES).default('default'),
    maxPrefixes: z.number().int().min(1).max(5_000_000).optional(),
    localPref: z.number().int().min(0).max(4_294_967_295).optional(),
  })
  .strict();
export type BgpPeerSpec = z.infer<typeof bgpPeerSpecSchema>;

/** Max-prefix limit of a session: explicit, or a sane default for the import mode. */
export function peerMaxPrefixes(peer: Pick<BgpPeerSpec, 'import' | 'maxPrefixes'>): number {
  return peer.maxPrefixes ?? DEFAULT_MAX_PREFIXES[peer.import];
}

/**
 * What is announced where (3.27): from the nodes of a node group, to all their peers or the named ones.
 * `anycast`: every node announces equally; `primary-backup`: nodes outside `primarySite` prepend, so they only take
 * over when the primary site stops announcing (stateful L4 must not switch sites mid-connection).
 */
export const bgpAnnouncementSpecSchema = z
  .object({
    prefixes: z.array(cidrStringSchema).min(1).max(256),
    nodeGroup: resourceNameSchema,
    peers: z.array(resourceNameSchema).max(64).optional(),
    mode: z.enum(['anycast', 'primary-backup']).default('anycast'),
    primarySite: resourceNameSchema.optional(),
    communities: z.array(communitySchema).max(32).default([]),
    prepend: z.number().int().min(0).max(10).default(0),
    med: z.number().int().min(0).max(4_294_967_295).optional(),
    /**
     * Announce only while the backing service is healthy (3.27): a node withdraws the prefixes when the service has
     * no healthy replica on that node, in its site, or anywhere in the cluster.
     */
    whenHealthy: z
      .object({
        service: z
          .string()
          .regex(/^[a-z0-9-]{1,63}\/[a-z0-9-]{1,63}\/[a-z0-9_.-]{1,63}$/, 'expected project/deployment/service'),
        scope: z.enum(['node', 'site', 'cluster']).default('site'),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine((a) => a.mode !== 'primary-backup' || !!a.primarySite, 'primary-backup needs a primarySite');
export type BgpAnnouncementSpec = z.infer<typeof bgpAnnouncementSpecSchema>;
