import { z } from 'zod';

import { clusterRemoteAccessSchema } from './remote-access';
import { clusterObservabilitySchema } from './observability';
import { clusterIngressSchema } from './edge';
import { clusterGitSchema } from './git';
import { clusterUpdatesSchema } from './updates';
import { clusterBackupsSchema } from './platform-backups';

import { cidrStringSchema } from './policy';
import { labelsSchema, resourceNameSchema } from '../metadata';
import { selectorSchema } from '../selector';

export const siteSpecSchema = z
  .object({
    description: z.string().max(1024).optional(),
    /** Free-form location for the fleet world map (3.25). */
    location: z
      .object({
        latitude: z.number().min(-90).max(90),
        longitude: z.number().min(-180).max(180),
        label: z.string().max(128).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();
export type SiteSpec = z.infer<typeof siteSpecSchema>;

/** Container runtimes Loadweaver manages per node (3.1). */
export const RUNTIMES = ['runc', 'sandboxed'] as const;
export const runtimeSchema = z.enum(RUNTIMES);
export type Runtime = z.infer<typeof runtimeSchema>;

/**
 * Declarative part of a node. Nodes are registered by joining (3.21); their spec only carries what
 * an operator decides: site, labels, schedulability.
 */
export const nodeSpecSchema = z
  .object({
    site: resourceNameSchema,
    labels: labelsSchema.optional(),
    /** Cordoned nodes get no new workloads (drain sets this first). */
    unschedulable: z.boolean().default(false),
    /** Witness nodes only vote in etcd / Patroni and never run workloads (3.2). */
    witness: z.boolean().default(false),
  })
  .strict();
export type NodeSpec = z.infer<typeof nodeSpecSchema>;

/** How members of one group treat each other ("nodes in the same group share networking", 3.3). */
export const intraGroupSchema = z.enum(['allow', 'isolate']);

export const nodeGroupSpecSchema = z
  .object({
    description: z.string().max(1024).optional(),
    selector: selectorSchema,
    intraGroup: intraGroupSchema.default('allow'),
  })
  .strict();
export type NodeGroupSpec = z.infer<typeof nodeGroupSpecSchema>;

export const workloadGroupSpecSchema = z
  .object({
    description: z.string().max(1024).optional(),
    /** Selector over service labels within the owning project. */
    selector: selectorSchema,
    intraGroup: intraGroupSchema.default('allow'),
    /** Discoverable by other projects, which may request access (3.17). */
    exposed: z.boolean().default(false),
  })
  .strict();
export type WorkloadGroupSpec = z.infer<typeof workloadGroupSpecSchema>;

/** Cluster-wide network settings (3.4, 3.23). Dual-stack: at least one family is required. */
export const clusterNetworkSchema = z
  .object({
    /** Pool the per-node container subnets are carved from. */
    podPoolV4: cidrStringSchema.optional(),
    podPoolV6: cidrStringSchema.optional(),
    nodePrefixV4: z.number().int().min(16).max(28).default(24),
    nodePrefixV6: z.number().int().min(48).max(120).default(80),
    /** Pool for stable service IPs that follow a service across nodes. */
    servicePoolV4: cidrStringSchema.optional(),
    servicePoolV6: cidrStringSchema.optional(),
    /** Overlay addresses of the WireGuard interfaces. */
    overlayPoolV4: cidrStringSchema.optional(),
    overlayPoolV6: cidrStringSchema.optional(),
    /** Private ASN used for iBGP between nodes (3.4). */
    asn: z.number().int().min(1).max(4294967295).default(4200000000),
    /** Route reflectors are introduced above this node count (3.34). */
    routeReflectorThreshold: z.number().int().min(4).default(16),
    dnsDomain: z
      .string()
      .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/)
      .default('lw'),
  })
  .strict()
  .superRefine((net, ctx) => {
    if (!net.podPoolV4 && !net.podPoolV6)
      ctx.addIssue({ code: 'custom', message: 'at least one pod pool (IPv4 or IPv6) is required' });

    if (!net.servicePoolV4 && !net.servicePoolV6)
      ctx.addIssue({ code: 'custom', message: 'at least one service pool is required' });
  });
export type ClusterNetwork = z.infer<typeof clusterNetworkSchema>;

/** Upstream registries the built-in registry mirrors as pull-through cache (3.22). */
export const DEFAULT_REGISTRY_MIRRORS = [
  { host: 'docker.io', remoteUrl: 'https://registry-1.docker.io' },
  { host: 'ghcr.io', remoteUrl: 'https://ghcr.io' },
  { host: 'quay.io', remoteUrl: 'https://quay.io' },
  { host: 'registry.k8s.io', remoteUrl: 'https://registry.k8s.io' },
  { host: 'gcr.io', remoteUrl: 'https://gcr.io' },
  { host: 'mcr.microsoft.com', remoteUrl: 'https://mcr.microsoft.com' },
  { host: 'public.ecr.aws', remoteUrl: 'https://public.ecr.aws' },
];
/** Bounded by the registry port range of the built-in policies. */
export const MAX_REGISTRY_MIRRORS = 16;
/** Private images of a project are `registry.lw/<project>/<repository>` (3.22). */
export const PRIVATE_REGISTRY_HOST = 'registry.lw';

const registryHostSchema = z
  .string()
  .max(253)
  .regex(/^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+(:\d{1,5})?$/, 'invalid registry host')
  .refine((h) => h !== PRIVATE_REGISTRY_HOST, `${PRIVATE_REGISTRY_HOST} is the built-in private registry`);

export const clusterRegistrySchema = z
  .object({
    /** Pull-through caches; images from other registries are pulled by the nodes directly. */
    mirrors: z
      .array(z.object({ host: registryHostSchema, remoteUrl: z.url({ protocol: /^https$/ }).max(512) }).strict())
      .max(MAX_REGISTRY_MIRRORS)
      .refine((m) => new Set(m.map((x) => x.host)).size === m.length, 'mirror hosts must be unique')
      .default(DEFAULT_REGISTRY_MIRRORS),
  })
  .strict();
export type ClusterRegistry = z.infer<typeof clusterRegistrySchema>;

export const clusterSpecSchema = z
  .object({
    network: clusterNetworkSchema,
    /** Failure domain default (3.12): node, or site (opt-in, needs ≥ 3 sites). */
    failureDomain: z.enum(['node', 'site']).default('node'),
    /** Desired control-plane quorum size once enough nodes exist (3.2). */
    controlPlaneSize: z.union([z.literal(3), z.literal(5)]).default(3),
    /** Node shell is root on the host: off by default, cluster admins only (3.19). */
    nodeShellEnabled: z.boolean().default(false),
    /**
     * Terminal recording (3.19): input / output of sessions in replicas, for all projects (`on`) or only projects that
     * enable it (`off`); node shells are always recorded. Kept this many days.
     */
    terminalRecording: z.enum(['off', 'on']).default('off'),
    terminalRecordingRetentionDays: z.number().int().min(1).max(3650).default(90),
    /** Built-in registry (3.22). */
    registry: clusterRegistrySchema.default({ mirrors: DEFAULT_REGISTRY_MIRRORS }),
    /** Public ingress (3.6); without it, nothing is exposed publicly. */
    ingress: clusterIngressSchema.optional(),
    /** Remote access for people, machines and offices (3.31). */
    remoteAccess: clusterRemoteAccessSchema.optional(),
    /** Logs and metrics: retention (3.14, 3.18). */
    observability: clusterObservabilitySchema.optional(),
    /** Plan bot (GitHub App, GitLab) and Git account linking (3.30). */
    git: clusterGitSchema.optional(),
    /**
     * Egress filtering through the node proxies (3.7), like Agenstra's: `off`, `monitor` (record would-be blocks),
     * `enforce` (hostname allow / deny lists from policies with hostname destinations; deny wins; no allow list means
     * unrestricted), `offline` (no web egress at all).
     */
    egress: z
      .object({
        mode: z.enum(['off', 'monitor', 'enforce', 'offline']).default('off'),
        blockPrivateNetworks: z.boolean().default(true),
        blockIpLiterals: z.boolean().default(false),
        logAllowed: z.boolean().default(true),
      })
      .strict()
      .default({ mode: 'off', blockPrivateNetworks: true, blockIpLiterals: false, logAllowed: true }),
    /** Update policy, channel and bundle source (3.26); maintenance windows are their own resources. */
    updates: clusterUpdatesSchema.optional(),
    /** Backups; `platform`: the control plane's own data (3.20). */
    backups: clusterBackupsSchema.optional(),
  })
  .strict();
export type ClusterSpec = z.infer<typeof clusterSpecSchema>;
