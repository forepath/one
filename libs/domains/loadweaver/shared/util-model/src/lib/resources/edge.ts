import { isIp } from '@forepath/loadweaver/shared/util-network';
import { z } from 'zod';

import { resourceNameSchema } from '../metadata';
import { cidrStringSchema } from './policy';

/** `secret://<project>/<name>`: credentials are referenced, never inlined (3.22). */
export const secretRefSchema = z
  .string()
  .regex(/^secret:\/\/[a-z0-9-]+\/[a-z0-9][a-z0-9._-]*$/, 'expected secret://<project>/<name>');

export const dnsNameSchema = z
  .string()
  .max(253)
  .regex(/^([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z][a-z0-9-]{0,61}[a-z0-9]$/, 'invalid DNS name');

/** Continent codes as GeoIP databases use them. */
export const CONTINENTS = ['AF', 'AN', 'AS', 'EU', 'NA', 'OC', 'SA'] as const;
export type Continent = (typeof CONTINENTS)[number];

const providerTypeSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,62}$/, 'invalid provider type');

/**
 * A DNS provider account (3.15): `bind9` is hosted on the cluster, `axfr` is a set of external name servers reached
 * by zone transfers with TSIG (credentials: the base64 TSIG secret), every other type (e.g. `cloudflare`, plugins) is
 * an external API reached with the referenced credentials.
 */
export const dnsProviderSpecSchema = z
  .object({
    type: providerTypeSchema,
    credentials: secretRefSchema.optional(),
    /** bind9 only: the node group running the name servers (default: the control-plane members). */
    nodeGroup: resourceNameSchema.optional(),
    /** bind9 only: name-server addresses from an IP pool (purpose `dns`), e.g. anycast from several sites (3.15). */
    nameServers: z
      .object({ pool: resourceNameSchema, count: z.number().int().min(1).max(8).default(2) })
      .strict()
      .optional(),
    /** axfr only: the external name servers (secondaries pulling from the cluster, or the primary it pulls from). */
    servers: z
      .array(z.string().refine((v) => isIp(v), 'invalid IP address'))
      .min(1)
      .max(16)
      .optional(),
    /** axfr only. */
    tsigAlgorithm: z.enum(['hmac-sha256', 'hmac-sha512']).optional(),
    /** Provider-specific, non-secret settings. */
    options: z.record(z.string().max(64), z.string().max(512)).optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    if (spec.type === 'axfr' && !spec.servers)
      ctx.addIssue({ code: 'custom', message: 'axfr needs the servers to transfer with' });

    if (spec.type !== 'axfr' && (spec.servers || spec.tsigAlgorithm))
      ctx.addIssue({ code: 'custom', message: 'servers and tsigAlgorithm only apply to axfr' });

    if (spec.type === 'bind9' && spec.credentials)
      ctx.addIssue({ code: 'custom', message: 'bind9 is hosted on the cluster and takes no credentials' });

    if (spec.type !== 'bind9' && !spec.credentials)
      ctx.addIssue({ code: 'custom', message: `${spec.type} needs credentials` });

    if (spec.type !== 'bind9' && spec.nodeGroup)
      ctx.addIssue({ code: 'custom', message: 'nodeGroup only applies to bind9' });

    if (spec.type !== 'bind9' && spec.nameServers)
      ctx.addIssue({ code: 'custom', message: 'nameServers only applies to bind9' });
  });
export type DnsProviderSpec = z.infer<typeof dnsProviderSpecSchema>;

/** A zone with one primary provider and optional secondaries that receive the same records (3.15). */
export const dnsZoneSpecSchema = z
  .object({
    zone: dnsNameSchema,
    provider: resourceNameSchema,
    secondaries: z.array(resourceNameSchema).max(8).default([]),
    /** Zone id at an external provider; looked up by name when absent. */
    providerZoneId: z.string().max(128).optional(),
    /** bind9-hosted zones only, opt-in (3.15). */
    dnssec: z.boolean().default(false),
    /** Publishes the DS records at the parent (registrar plugin); without it they are added by hand. */
    registrar: z
      .object({
        type: providerTypeSchema,
        credentials: secretRefSchema,
        options: z.record(z.string().max(64), z.string().max(512)).optional(),
      })
      .strict()
      .optional(),
    defaultTtl: z.number().int().min(1).max(86_400).default(300),
  })
  .strict()
  .refine((z) => !z.secondaries.includes(z.provider), 'the primary provider cannot also be a secondary');
export type DnsZoneSpec = z.infer<typeof dnsZoneSpecSchema>;

export const DNS_RECORD_TYPES = ['A', 'AAAA', 'CNAME', 'TXT', 'MX', 'SRV', 'CAA', 'NS', 'PTR'] as const;
/** A host name as a record value, optionally fully qualified with a trailing dot. */
const HOST_VALUE = /^([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.?$/;

/** A record declared in YAML; ingress hostnames create their records on their own (3.15). */
export const dnsRecordSpecSchema = z
  .object({
    /** `DnsZone` resource name. */
    zone: resourceNameSchema,
    /** Relative to the zone; `@` is the apex, `*` and `*.x` are wildcards. */
    name: z
      .string()
      .max(253)
      .regex(
        /^(@|(\*\.)?([a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?\.)*[a-z0-9_]([a-z0-9_-]{0,61}[a-z0-9])?|\*)$/,
        'invalid record name',
      ),
    type: z.enum(DNS_RECORD_TYPES),
    // Values end up in zone files and provider APIs: no control characters (no newlines to inject records with).
    values: z
      .array(
        z
          .string()
          .min(1)
          .max(2048)
          .regex(/^\P{Cc}+$/u, 'control characters are not allowed'),
      )
      .min(1)
      .max(64),
    ttl: z.number().int().min(1).max(86_400).optional(),
    priority: z.number().int().min(0).max(65_535).optional(),
  })
  .strict()
  .superRefine((r, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: 'custom', message });

    if (r.type === 'A' && r.values.some((v) => !isIp(v) || v.includes(':'))) bad('A records take IPv4 addresses');

    if (r.type === 'AAAA' && r.values.some((v) => !isIp(v) || !v.includes(':')))
      bad('AAAA records take IPv6 addresses');

    if (r.type === 'CNAME' && (r.values.length !== 1 || r.name === '@'))
      bad('a CNAME has exactly one value and cannot sit at the apex');

    if (
      (r.type === 'CNAME' || r.type === 'MX' || r.type === 'NS' || r.type === 'PTR') &&
      r.values.some((v) => !HOST_VALUE.test(v))
    )
      bad(`${r.type} values are host names`);

    if (r.type === 'SRV' && r.values.some((v) => !/^\d{1,5} \d{1,5} \S+$/.test(v) || !HOST_VALUE.test(v.split(' ')[2])))
      bad('SRV values are "<weight> <port> <target>"');

    if (r.type === 'CAA' && r.values.some((v) => !/^\d{1,3} (issue|issuewild|iodef) "[^"\\]{0,255}"$/.test(v)))
      bad('CAA values are \'<flags> issue|issuewild|iodef "<value>"\'');

    if ((r.type === 'MX' || r.type === 'SRV') && r.priority === undefined) bad(`${r.type} records need a priority`);
  });
export type DnsRecordSpec = z.infer<typeof dnsRecordSpecSchema>;

export const IP_PURPOSES = ['ingress', 'port-forward', 'egress', 'dns', 'vpn'] as const;

/**
 * Public addresses the cluster may hand out (built-in IPAM, 3.27): own prefixes or provider IPs. Which nodes may hold
 * them is a node group (3.6); how an address moves between holders is the failover mode.
 */
export const ipPoolSpecSchema = z
  .object({
    cidrs: z.array(cidrStringSchema).min(1).max(64),
    /** Holders: e.g. the `ingress` or `edge` node group. */
    nodeGroup: resourceNameSchema,
    /**
     * `vrrp`: floating address on a shared L2 segment; `bgp`: announced via BIRD by the healthy holder; `provider`:
     * the hosting provider's failover-IP API; `none`: the address can't move (DNS failover or a pin, 3.28).
     */
    failover: z.enum(['vrrp', 'bgp', 'provider', 'none']),
    /** BGP pools: `primary-backup` (the holder announces, others prepend) or `anycast` (every holder announces equally). */
    bgpMode: z.enum(['primary-backup', 'anycast']).default('primary-backup'),
    provider: z
      .object({
        type: providerTypeSchema,
        credentials: secretRefSchema,
        options: z.record(z.string().max(64), z.string().max(512)).optional(),
      })
      .strict()
      .optional(),
    purposes: z
      .array(z.enum(IP_PURPOSES))
      .min(1)
      .default([...IP_PURPOSES]),
    /** Projects whose policies may take egress addresses from this pool (3.17); unset: every project. */
    projects: z.array(resourceNameSchema).max(256).optional(),
    /** Released addresses wait this long before reuse (3.27). */
    cooldownSeconds: z
      .number()
      .int()
      .min(0)
      .max(30 * 86_400)
      .default(86_400),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.failover === 'provider' && !p.provider)
      ctx.addIssue({ code: 'custom', message: 'failover: provider needs a provider' });

    if (p.failover !== 'provider' && p.provider)
      ctx.addIssue({ code: 'custom', message: 'provider is only used with failover: provider' });
  });
export type IpPoolSpec = z.infer<typeof ipPoolSpecSchema>;

export const LETS_ENCRYPT_DIRECTORY = 'https://acme-v02.api.letsencrypt.org/directory';

/** Cluster ingress (3.6): where public addresses come from and how certificates are obtained. */
export const clusterIngressSchema = z
  .object({
    /** `IpPool` the ingress addresses come from. */
    pool: resourceNameSchema,
    /** Number of ingress addresses (anycast / several floating IPs). */
    addresses: z.number().int().min(1).max(16).default(1),
    acme: z
      .object({
        enabled: z.boolean().default(true),
        email: z.email().max(254).optional(),
        directory: z
          .url({ protocol: /^https$/ })
          .max(512)
          .default(LETS_ENCRYPT_DIRECTORY),
      })
      .strict()
      .default({ enabled: true, directory: LETS_ENCRYPT_DIRECTORY }),
  })
  .strict();
export type ClusterIngress = z.infer<typeof clusterIngressSchema>;

/**
 * DNS failover for a hostname (3.28): endpoints probed from several sites, answers chosen by Loadweaver's own engine.
 * `failover`: the first healthy endpoint (by order); `multi-value`: every healthy endpoint.
 */
export const dnsFailoverSpecSchema = z
  .object({
    host: dnsNameSchema,
    /**
     * `failover`: the first healthy endpoint; `multi-value`: all healthy ones; steering (hosted bind9 only, every
     * other provider gets the default answer): `weighted` by `weight`, `geo` by the client's country / continent,
     * `latency` to the endpoint closest to the client's continent by probe measurements.
     */
    mode: z.enum(['failover', 'multi-value', 'weighted', 'geo', 'latency']).default('failover'),
    endpoints: z
      .array(
        z
          .object({
            name: resourceNameSchema,
            address: z.string().refine(isIp, 'expected an IP address'),
            /** Site the endpoint is in; probes run from other sites where possible. */
            site: resourceNameSchema.optional(),
            /** `weighted`: share of the clients. */
            weight: z.number().int().min(0).max(1000).optional(),
            /** `geo`: clients from these countries (ISO 3166 alpha-2) / continents; none: the default answer. */
            countries: z
              .array(z.string().regex(/^[A-Z]{2}$/, 'expected an ISO 3166 alpha-2 country code'))
              .max(250)
              .optional(),
            continents: z.array(z.enum(CONTINENTS)).max(7).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(32),
    check: z
      .object({
        protocol: z.enum(['http', 'https', 'tcp']).default('https'),
        port: z.number().int().min(1).max(65_535).optional(),
        path: z
          .string()
          .regex(/^\/[^\s"\\]*$/)
          .max(1024)
          .default('/'),
        expectStatus: z
          .tuple([z.number().int().min(100).max(599), z.number().int().min(100).max(599)])
          .default([200, 399]),
      })
      .strict()
      .default({ protocol: 'https', path: '/', expectStatus: [200, 399] }),
    intervalSeconds: z.number().int().min(5).max(300).default(10),
    /** Hysteresis: failed rounds before failing over, healthy rounds before an endpoint counts as recovered. */
    failAfter: z.number().int().min(1).max(20).default(3),
    recoverAfter: z.number().int().min(1).max(20).default(3),
    /** Back to the primary automatically after it was healthy this long, or only when an operator confirms. */
    failback: z.enum(['auto', 'manual']).default('auto'),
    stableSeconds: z.number().int().min(0).max(86_400).default(600),
    ttl: z.number().int().min(1).max(3600).default(30),
  })
  .strict()
  .refine((f) => new Set(f.endpoints.map((e) => e.name)).size === f.endpoints.length, 'endpoint names must be unique')
  .superRefine((f, ctx) => {
    const bad = (message: string) => ctx.addIssue({ code: 'custom', message });

    if (f.mode !== 'weighted' && f.endpoints.some((e) => e.weight !== undefined))
      bad('weight only applies to weighted');

    if (f.mode === 'weighted' && f.endpoints.every((e) => (e.weight ?? 1) === 0))
      bad('at least one weight must be positive');

    if (f.mode !== 'geo' && f.endpoints.some((e) => e.countries || e.continents))
      bad('countries and continents only apply to geo');

    if (f.mode === 'geo' && !f.endpoints.some((e) => e.countries?.length || e.continents?.length))
      bad('geo needs endpoints with countries or continents');
  });
export type DnsFailoverSpec = z.infer<typeof dnsFailoverSpecSchema>;
