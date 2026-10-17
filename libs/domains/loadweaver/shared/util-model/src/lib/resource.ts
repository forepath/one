import { z } from 'zod';

import { LOADWEAVER_API_VERSION, resourceMetadataSchema } from './metadata';
import {
  clusterSpecSchema,
  nodeGroupSpecSchema,
  nodeSpecSchema,
  siteSpecSchema,
  workloadGroupSpecSchema,
} from './resources/infrastructure';
import {
  dnsFailoverSpecSchema,
  dnsProviderSpecSchema,
  dnsRecordSpecSchema,
  dnsZoneSpecSchema,
  ipPoolSpecSchema,
} from './resources/edge';
import { autonomousSystemSpecSchema, bgpAnnouncementSpecSchema, bgpPeerSpecSchema } from './resources/bgp';
import { imagePolicySpecSchema } from './resources/image-policy';
import { clientGroupSpecSchema } from './resources/remote-access';
import { policySpecSchema } from './resources/policy';
import { deploymentSpecSchema, projectSpecSchema } from './resources/workloads';

/** Where a resource lives (3.17): cluster-level resources sit above projects. */
/** `any`: allowed in both, e.g. cluster-wide policies by infra operators next to project policies. */
export type ResourceScope = 'cluster' | 'project' | 'any';

interface KindDefinition<S extends z.ZodType> {
  spec: S;
  scope: ResourceScope;
  description: string;
}

function kind<S extends z.ZodType>(spec: S, scope: ResourceScope, description: string): KindDefinition<S> {
  return { spec, scope, description };
}

/**
 * Registry of every declarative resource kind. New kinds are added here once and automatically get
 * validation, a published JSON Schema (3.29) and plan support.
 */
export const RESOURCE_KINDS = {
  Cluster: kind(
    clusterSpecSchema,
    'cluster',
    'Cluster-wide settings: network pools, failure domain, control-plane size.',
  ),
  Site: kind(siteSpecSchema, 'cluster', 'A location nodes belong to (failure domain for site-level resilience).'),
  Node: kind(nodeSpecSchema, 'cluster', 'Declarative part of a joined node: site, labels, schedulability.'),
  NodeGroup: kind(nodeGroupSpecSchema, 'cluster', 'Nodes selected by labels that share networking.'),
  WorkloadGroup: kind(
    workloadGroupSpecSchema,
    'project',
    'Services selected by labels, independent of the node they run on.',
  ),
  Policy: kind(
    policySpecSchema,
    'any',
    'Allow (or L7 deny) rule between groups; compiled into every enforcement layer.',
  ),
  Project: kind(
    projectSpecSchema,
    'cluster',
    'Access unit inside the cluster that owns deployments, groups, policies and volumes.',
  ),
  Deployment: kind(
    deploymentSpecSchema,
    'project',
    'Docker Compose project with x-loadweaver extensions; unit of plan, apply and migration.',
  ),
  DnsProvider: kind(
    dnsProviderSpecSchema,
    'cluster',
    'A DNS provider account (Cloudflare, plugins) or the hosted bind9 name servers.',
  ),
  DnsZone: kind(dnsZoneSpecSchema, 'cluster', 'A zone with its primary provider, optional secondaries and DNSSEC.'),
  DnsRecord: kind(dnsRecordSpecSchema, 'any', 'A declared DNS record; ingress hostnames create theirs on their own.'),
  IpPool: kind(
    ipPoolSpecSchema,
    'cluster',
    'Public addresses (own prefixes or provider IPs), their holders and failover mode.',
  ),
  DnsFailover: kind(
    dnsFailoverSpecSchema,
    'cluster',
    'Probed endpoints of a hostname; DNS answers follow their health.',
  ),
  AutonomousSystem: kind(
    autonomousSystemSpecSchema,
    'cluster',
    "The cluster's own ASN, the prefixes it holds and its RPKI validators.",
  ),
  BgpPeer: kind(
    bgpPeerSpecSchema,
    'cluster',
    'An external BGP peer of a node group: upstream, IXP route server or provider BGP.',
  ),
  BgpAnnouncement: kind(
    bgpAnnouncementSpecSchema,
    'cluster',
    'Which own prefixes a node group announces to its peers, and how.',
  ),
  ClientGroup: kind(
    clientGroupSpecSchema,
    'cluster',
    'Remote clients (user devices by identity-provider group, machines, offices) as a group in the policy model.',
  ),
  ImagePolicy: kind(
    imagePolicySpecSchema,
    'any',
    'Signatures and vulnerability limits images of the selected services must meet.',
  ),
} as const;

export type ResourceKind = keyof typeof RESOURCE_KINDS;
export const RESOURCE_KIND_NAMES = Object.keys(RESOURCE_KINDS) as ResourceKind[];

export type ResourceSpec<K extends ResourceKind> = z.infer<(typeof RESOURCE_KINDS)[K]['spec']>;

export interface Resource<K extends ResourceKind = ResourceKind> {
  apiVersion: typeof LOADWEAVER_API_VERSION;
  kind: K;
  metadata: z.infer<typeof resourceMetadataSchema>;
  spec: ResourceSpec<K>;
}

function envelopeSchema<K extends ResourceKind>(k: K) {
  const def = RESOURCE_KINDS[k];

  return z
    .object({
      apiVersion: z.literal(LOADWEAVER_API_VERSION),
      kind: z.literal(k),
      metadata: resourceMetadataSchema,
      spec: def.spec,
    })
    .strict()
    .superRefine((res, ctx) => {
      if (def.scope === 'cluster' && res.metadata.project) {
        ctx.addIssue({
          code: 'custom',
          path: ['metadata', 'project'],
          message: `${k} is a cluster-level resource and cannot belong to a project`,
        });
      }

      if (def.scope === 'project' && !res.metadata.project) {
        ctx.addIssue({ code: 'custom', path: ['metadata', 'project'], message: `${k} must belong to a project` });
      }
    });
}

const envelopeSchemas = Object.fromEntries(RESOURCE_KIND_NAMES.map((k) => [k, envelopeSchema(k)])) as {
  [K in ResourceKind]: ReturnType<typeof envelopeSchema<K>>;
};

export function resourceSchema<K extends ResourceKind>(k: K) {
  return envelopeSchemas[k];
}

export interface ResourceIssue {
  path: string;
  message: string;
}

export type ParseResourceResult = { ok: true; resource: Resource } | { ok: false; issues: ResourceIssue[] };

function toIssues(error: z.ZodError): ResourceIssue[] {
  return error.issues.map((issue) => ({ path: issue.path.map(String).join('.'), message: issue.message }));
}

/** Validates an untyped document (e.g. parsed YAML) into a typed resource, applying defaults. */
export function parseResource(input: unknown): ParseResourceResult {
  const head = z.object({ apiVersion: z.string(), kind: z.string() }).safeParse(input);

  if (!head.success) return { ok: false, issues: toIssues(head.error) };

  if (head.data.apiVersion !== LOADWEAVER_API_VERSION) {
    return {
      ok: false,
      issues: [{ path: 'apiVersion', message: `unsupported apiVersion, expected ${LOADWEAVER_API_VERSION}` }],
    };
  }

  if (!(head.data.kind in RESOURCE_KINDS)) {
    return { ok: false, issues: [{ path: 'kind', message: `unknown kind ${head.data.kind}` }] };
  }

  const parsed = envelopeSchemas[head.data.kind as ResourceKind].safeParse(input);

  return parsed.success
    ? { ok: true, resource: parsed.data as Resource }
    : { ok: false, issues: toIssues(parsed.error) };
}

export function isResourceOfKind<K extends ResourceKind>(resource: Resource, k: K): resource is Resource<K> {
  return resource.kind === k;
}

/** JSON Schema (draft 2020-12) per kind, for editors and the Monaco editor in the console (3.16, 3.29). */
export function resourceJsonSchema(k: ResourceKind): Record<string, unknown> {
  return {
    ...(z.toJSONSchema(envelopeSchemas[k], { io: 'input', unrepresentable: 'any' }) as Record<string, unknown>),
    $id: `https://loadweaver.com/schemas/v1/${k}.json`,
    title: k,
    description: RESOURCE_KINDS[k].description,
  };
}
