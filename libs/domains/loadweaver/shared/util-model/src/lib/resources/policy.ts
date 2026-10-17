import { z } from 'zod';

import { isCidr } from '@forepath/loadweaver/shared/util-network';

import { resourceNameSchema } from '../metadata';
import { selectorSchema } from '../selector';

/** Built-in pseudo groups (3.3). Per-site groups are addressed with `{ site }`. */
export const BUILTIN_GROUPS = ['internet', 'cluster', 'control-plane', 'object-store', 'ingress'] as const;
export const builtinGroupSchema = z.enum(BUILTIN_GROUPS);
export type BuiltinGroup = z.infer<typeof builtinGroupSchema>;

/** `*.example.com` or `api.example.com`; matched case-insensitively by the proxy. */
export const hostnamePatternSchema = z
  .string()
  .max(253)
  .regex(
    /^(\*\.)?([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)*[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/i,
    'invalid hostname pattern',
  );

export const cidrStringSchema = z.string().refine(isCidr, 'invalid CIDR (host bits must be zero)');

/** A policy endpoint. Exactly one form per entry. */
export const policyPeerSchema = z.union([
  z.object({ group: resourceNameSchema, project: resourceNameSchema.optional() }).strict(),
  z.object({ builtin: builtinGroupSchema }).strict(),
  z.object({ site: resourceNameSchema }).strict(),
  /** Inline selector over workloads of the policy's project (shortcut for an anonymous workload group). */
  z.object({ selector: selectorSchema }).strict(),
  z.object({ cidr: cidrStringSchema }).strict(),
  z.object({ host: hostnamePatternSchema }).strict(),
  /** Remote clients of a client group (3.31). */
  z.object({ clients: resourceNameSchema }).strict(),
]);
export type PolicyPeer = z.infer<typeof policyPeerSchema>;

export const PROTOCOLS = ['tcp', 'udp', 'icmp', 'any'] as const;
export const protocolSchema = z.enum(PROTOCOLS);
export type Protocol = z.infer<typeof protocolSchema>;

/** Single port or inclusive range `"8000-8100"`. */
export const portSpecSchema = z.union([
  z.number().int().min(1).max(65535),
  z
    .string()
    .regex(/^\d{1,5}-\d{1,5}$/)
    .refine((v) => {
      const [a, b] = v.split('-').map(Number);

      return a >= 1 && b <= 65535 && a <= b;
    }, 'invalid port range'),
]);
export type PortSpec = z.infer<typeof portSpecSchema>;

export const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS', 'CONNECT', 'TRACE'] as const;

/** L7 match, evaluated by the node proxies (3.7). */
export const httpMatchSchema = z
  .object({
    hosts: z.array(hostnamePatternSchema).optional(),
    /** Path prefixes, must start with `/`. */
    paths: z
      .array(
        z
          .string()
          .regex(/^\/[^\s]*$/)
          .max(2048),
      )
      .optional(),
    methods: z.array(z.enum(HTTP_METHODS)).optional(),
  })
  .strict();
export type HttpMatch = z.infer<typeof httpMatchSchema>;

export const policyRuleSchema = z
  .object({
    protocol: protocolSchema.default('tcp'),
    ports: z.array(portSpecSchema).optional(),
    http: httpMatchSchema.optional(),
  })
  .strict()
  .superRefine((rule, ctx) => {
    if ((rule.protocol === 'icmp' || rule.protocol === 'any') && rule.ports?.length) {
      ctx.addIssue({ code: 'custom', message: `ports are not allowed with protocol ${rule.protocol}` });
    }

    if (rule.http && rule.protocol !== 'tcp') {
      ctx.addIssue({ code: 'custom', message: 'http matches require protocol tcp' });
    }
  });
export type PolicyRule = z.infer<typeof policyRuleSchema>;

/** `monitor` records would-be blocks without enforcing them (borrowed from Agenstra). */
export const policyModeSchema = z.enum(['enforce', 'monitor']);
export type PolicyMode = z.infer<typeof policyModeSchema>;

/**
 * A standalone policy (3.3): from → to → what → action.
 * Between groups only `allow` exists (SG semantics). `deny` is only valid at L7 (hostname destinations or
 * http matches), where deny wins over allow (3.7).
 */
export const policySpecSchema = z
  .object({
    description: z.string().max(1024).optional(),
    mode: policyModeSchema.default('enforce'),
    action: z.enum(['allow', 'deny']).default('allow'),
    from: z.array(policyPeerSchema).min(1),
    to: z.array(policyPeerSchema).min(1),
    rules: z.array(policyRuleSchema).min(1),
    /**
     * Egress from own prefixes (3.27): the `from` workloads reach the `to` destinations outside the cluster with a
     * stable source address from each pool (one per pool, e.g. an IPv4 and an IPv6 pool), held by an edge node;
     * workloads elsewhere are routed to it over WireGuard. Optionally with reverse DNS for the addresses.
     */
    egress: z
      .object({
        pools: z.array(resourceNameSchema).min(1).max(2),
        reverseDns: hostnamePatternSchema.refine((h) => !h.startsWith('*'), 'no wildcard').optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((spec, ctx) => {
    if (spec.egress) {
      if (spec.action !== 'allow')
        ctx.addIssue({ code: 'custom', path: ['egress'], message: 'egress needs action allow' });

      if (spec.to.some((peer) => !('cidr' in peer) && !('builtin' in peer && peer.builtin === 'internet')))
        ctx.addIssue({
          code: 'custom',
          path: ['egress'],
          message: 'egress addresses are for destinations outside the cluster (internet or CIDRs)',
        });

      if (spec.from.some((peer) => !('group' in peer) && !('selector' in peer)))
        ctx.addIssue({
          code: 'custom',
          path: ['egress'],
          message: 'egress addresses are for workloads (groups or selectors)',
        });
    }

    spec.from.forEach((peer, i) => {
      if ('host' in peer)
        ctx.addIssue({ code: 'custom', path: ['from', i], message: 'hostnames can only be destinations' });
    });

    const l7 = spec.to.some((peer) => 'host' in peer) || spec.rules.some((rule) => rule.http);

    if (spec.action === 'deny' && !l7) {
      ctx.addIssue({
        code: 'custom',
        path: ['action'],
        message: 'deny is only allowed for L7 policies (hostname destinations or http matches)',
      });
    }

    if (spec.to.some((peer) => 'host' in peer) && spec.to.some((peer) => !('host' in peer))) {
      ctx.addIssue({
        code: 'custom',
        path: ['to'],
        message: 'hostname destinations cannot be mixed with other destinations',
      });
    }
  });
export type PolicySpec = z.infer<typeof policySpecSchema>;
export type PolicySpecInput = z.input<typeof policySpecSchema>;
