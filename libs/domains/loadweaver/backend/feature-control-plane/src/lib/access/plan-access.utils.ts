import { createHash } from 'node:crypto';

import {
  ipPoolSpecSchema,
  policySpecSchema,
  projectSpecSchema,
  workloadGroupSpecSchema,
} from '@forepath/loadweaver/shared/util-model';
import { parseBytes, parseCpus } from '@forepath/loadweaver/shared/util-compose';

import { canonicalJson } from '../utils/canonical-json.utils';
import { toSchedulerServices, type ParsedDeployment } from '../utils/workload-planning.utils';

type ResourceRow = { kind: string; name: string; project: string | null; spec: Record<string, unknown> };
type Change = {
  action: string;
  kind: string;
  name: string;
  project: string | null;
  after: Record<string, unknown> | null;
};

/** The policy spec an acceptance is bound to. */
export function specHash(spec: unknown): string {
  return createHash('sha256').update(canonicalJson(spec)).digest('hex');
}

export interface CrossProjectReference {
  project: string;
  policy: string;
  peer: string;
  specHash: string;
}

/** Policies this plan creates / changes that reach into other projects' groups (need the other side's acceptance). */
export function crossProjectReferences(changes: readonly Change[]): CrossProjectReference[] {
  return changes.flatMap((c) => {
    if (c.kind !== 'Policy' || !c.project || (c.action !== 'create' && c.action !== 'update') || !c.after) return [];

    const spec = policySpecSchema.parse((c.after as { spec: unknown }).spec);
    const peers = [...spec.from, ...spec.to].flatMap((p) =>
      'group' in p && p.project && p.project !== c.project ? [p.project] : [],
    );

    return [...new Set(peers)]
      .sort()
      .map((peer) => ({ project: c.project as string, policy: c.name, peer, specHash: specHash(spec) }));
  });
}

/** Another project's groups can only be referenced when that project exposes them (3.17). */
export function exposureIssues(resources: readonly ResourceRow[]): string[] {
  const groups = new Map(
    resources
      .filter((r) => r.kind === 'WorkloadGroup' && r.project)
      .map((r) => [`${r.project}/${r.name}`, workloadGroupSpecSchema.parse(r.spec)]),
  );

  return resources
    .filter((r) => r.kind === 'Policy' && r.project)
    .flatMap((r) => {
      const spec = policySpecSchema.parse(r.spec);

      return [...spec.from, ...spec.to].flatMap((p) => {
        if (!('group' in p) || !p.project || p.project === r.project) return [];

        const group = groups.get(`${p.project}/${p.group}`);

        return group?.exposed
          ? []
          : [
              `Policy ${r.project}/${r.name}: group ${p.project}/${p.group} ${group ? 'is not exposed' : 'does not exist'}`,
            ];
      });
    });
}

export interface ProjectUsage {
  cpuMillis: number;
  memoryBytes: number;
  storageBytes: number;
  publicIps: number;
  ports: number;
}

/**
 * What each project asks for: requests of all replicas, volume sizes plus stored backup bytes (3.20), egress
 * addresses, published ports. Autoscaled services (3.23) count with `min` replicas (what a plan commits to; the
 * autoscaler stays within the quota above it), or with the replicas they run now (`autoscaled: 'current'`).
 */
export function projectUsage(
  parsed: readonly ParsedDeployment[],
  resources: readonly ResourceRow[],
  backupBytes: ReadonlyMap<string, number> = new Map(),
  autoscaled: 'min' | 'current' = 'min',
): Map<string, ProjectUsage> {
  const usage = new Map<string, ProjectUsage>();
  const of = (project: string) => {
    let u = usage.get(project);

    if (!u) {
      u = { cpuMillis: 0, memoryBytes: 0, storageBytes: 0, publicIps: 0, ports: 0 };
      usage.set(project, u);
    }

    return u;
  };
  const volumes = new Set<string>();
  const minimum = new Map<string, number>(
    autoscaled === 'min'
      ? parsed.flatMap((d) =>
          d.compose.services.flatMap((s) =>
            s.autoscale && s.kind === 'service'
              ? [[`${d.project}/${d.name}/${s.name}`, s.autoscale.min] as [string, number]]
              : [],
          ),
        )
      : [],
  );

  for (const service of toSchedulerServices(parsed)) {
    const u = of(service.project);
    const replicas = minimum.get(service.id) ?? service.replicas;

    u.cpuMillis += replicas * service.requests.cpuMillis;
    u.memoryBytes += replicas * service.requests.memoryBytes;

    for (const v of service.volumes) {
      if (volumes.has(v.id)) continue;

      volumes.add(v.id);
      u.storageBytes += v.sizeBytes;
    }
  }

  for (const d of parsed) for (const s of d.compose.services) of(d.project).ports += s.ports.length;

  for (const [project, bytes] of backupBytes) of(project).storageBytes += bytes;

  for (const r of resources.filter((x) => x.kind === 'Policy' && x.project))
    of(r.project as string).publicIps += policySpecSchema.parse(r.spec).egress?.pools.length ?? 0;

  return usage;
}

/** Plans over a project's quota are rejected (3.17); only projects the plan touches are judged. */
export function quotaIssues(
  usage: ReadonlyMap<string, ProjectUsage>,
  resources: readonly ResourceRow[],
  touched: readonly string[],
): string[] {
  const issues: string[] = [];

  for (const project of touched) {
    const resource = resources.find((r) => r.kind === 'Project' && r.name === project);
    const quota = resource ? projectSpecSchema.parse(resource.spec).quota : undefined;
    const u = usage.get(project);

    if (!quota || !u) continue;

    const check = (label: string, used: number, limit: number | null | undefined, format: (n: number) => string) => {
      if (limit !== null && limit !== undefined && used > limit)
        issues.push(`project ${project}: ${label} ${format(used)} exceeds the quota of ${format(limit)}`);
    };
    const gib = (n: number) => `${(n / 1024 ** 3).toFixed(2).replace(/\.?0+$/, '')} GiB`;

    check('CPU', u.cpuMillis, quota.cpu ? parseCpus(quota.cpu) : undefined, (n) => `${n / 1000}`);
    check('memory', u.memoryBytes, quota.memory ? parseBytes(quota.memory) : undefined, gib);
    check('storage', u.storageBytes, quota.storage ? parseBytes(quota.storage) : undefined, gib);
    check('public IPs', u.publicIps, quota.publicIps, String);
    check('published ports', u.ports, quota.ports, String);
  }

  return issues;
}

/** How much of each quota a project uses (0–1+), for the "quota near the limit" alert (3.18). */
export function quotaShares(
  usage: ReadonlyMap<string, ProjectUsage>,
  resources: readonly ResourceRow[],
): { project: string; resource: string; used: number; limit: number; share: number }[] {
  const out: { project: string; resource: string; used: number; limit: number; share: number }[] = [];

  for (const r of resources.filter((x) => x.kind === 'Project')) {
    const quota = projectSpecSchema.parse(r.spec).quota;
    const u = usage.get(r.name);

    if (!quota || !u) continue;

    for (const [resource, used, limit] of [
      ['cpu', u.cpuMillis, quota.cpu ? parseCpus(quota.cpu) : undefined],
      ['memory', u.memoryBytes, quota.memory ? parseBytes(quota.memory) : undefined],
      ['storage', u.storageBytes, quota.storage ? parseBytes(quota.storage) : undefined],
      ['public IPs', u.publicIps, quota.publicIps ?? undefined],
      ['published ports', u.ports, quota.ports ?? undefined],
    ] as const)
      if (limit !== undefined && limit !== null && limit > 0)
        out.push({ project: r.name, resource, used, limit, share: used / limit });
  }

  return out;
}

/** Egress addresses only from pools the project may use (3.17 / 3.27). */
export function poolRightIssues(resources: readonly ResourceRow[]): string[] {
  const pools = new Map(
    resources.filter((r) => r.kind === 'IpPool').map((r) => [r.name, ipPoolSpecSchema.parse(r.spec).projects]),
  );

  return resources
    .filter((r) => r.kind === 'Policy' && r.project)
    .flatMap((r) =>
      (policySpecSchema.parse(r.spec).egress?.pools ?? []).flatMap((pool) => {
        const allowed = pools.get(pool);

        return allowed && !allowed.includes(r.project as string)
          ? [`Policy ${r.project}/${r.name}: project ${r.project} may not use IP pool ${pool}`]
          : [];
      }),
    );
}

/**
 * Why a project's part of a plan is risky (the `risky` approval mode): unacknowledged pins, policies to or from
 * the internet, and changed deployments that expose hostnames or ports.
 */
export function planRisk(
  changes: readonly Change[],
  warnings: readonly Record<string, unknown>[],
  parsed: readonly ParsedDeployment[],
): Record<string, string[]> {
  const risk: Record<string, string[]> = {};
  const add = (project: string, reason: string) => {
    risk[project] = [...new Set([...(risk[project] ?? []), reason])];
  };

  for (const w of warnings)
    if (w['pin'] === true && typeof w['project'] === 'string') add(w['project'], 'unacknowledged pins');

  for (const c of changes) {
    if (!c.project || (c.action !== 'create' && c.action !== 'update') || !c.after) continue;

    if (c.kind === 'Policy') {
      const spec = policySpecSchema.parse((c.after as { spec: unknown }).spec);

      if ([...spec.from, ...spec.to].some((p) => 'builtin' in p && p.builtin === 'internet'))
        add(c.project, 'internet exposure');
    }

    if (c.kind === 'Deployment') {
      const d = parsed.find((x) => x.project === c.project && x.name === c.name);

      if (d?.compose.services.some((s) => s.http.length > 0 || s.ports.length > 0)) add(c.project, 'internet exposure');
    }
  }

  return risk;
}
