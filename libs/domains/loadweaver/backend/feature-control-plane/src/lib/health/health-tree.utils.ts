/** Health of an entity (3.25), from best to worst for display; `rank` orders them for headlines. */
export type HealthState = 'healthy' | 'degraded' | 'at-risk' | 'failed' | 'unknown';

export const HEALTH_RANK: Record<HealthState, number> = {
  healthy: 0,
  unknown: 1,
  degraded: 2,
  'at-risk': 3,
  failed: 4,
};

export type HealthKind = 'cluster' | 'site' | 'node' | 'project' | 'deployment' | 'service' | 'replica' | 'volume';

/** Why an entity is in its state: machine-readable code, a sentence, and the entities behind it. */
export interface HealthReason {
  code: string;
  message: string;
  entities?: string[];
}

export interface HealthNode {
  key: string;
  kind: HealthKind;
  name: string;
  parent: string | null;
  project: string | null;
  state: HealthState;
  reasons: HealthReason[];
}

export interface HealthInput {
  now: number;
  heartbeatTimeoutMs: number;
  nodes: {
    name: string;
    site: string;
    lifecycle: string;
    connected: boolean;
    lastSeenAt: number | null;
    controlPlane: boolean;
    witness: boolean;
    capacity: { cpuMillis: number; memoryBytes: number; diskBytes: number } | null;
    usage: { cpuMillis: number; memoryBytes: number; diskBytes: number } | null;
  }[];
  replicas: {
    id: string;
    project: string;
    deployment: string;
    service: string;
    node: string;
    state?: string;
    exitCode?: number;
    cron: boolean;
  }[];
  volumes: {
    id: string;
    primaryNode: string;
    syncReplicas: string[];
    remoteReplicas: string[];
    crossSite: string;
  }[];
  /** Plans whose rollback failed (inconsistent until a fix-forward applies), with their projects. */
  rollbackFailed: { id: string; projects: string[] }[];
  /** Projects that exist (so empty ones show up healthy). */
  projects: string[];
  /** Pins of the backup setup (3.20): kit not confirmed, no external target. */
  backupPins?: string[];
}

const node = (name: string) => `node/${name}`;

function reason(code: string, message: string, entities?: string[]): HealthReason {
  return { code, message, ...(entities?.length ? { entities } : {}) };
}

/**
 * Parents from their children with rules instead of "worst child wins" (3.25): all children failed → failed, some
 * failed or degraded → degraded, any at risk → at risk, nothing known → unknown. The reasons name the children.
 */
function rollUp(children: readonly HealthNode[], noun: string): { state: HealthState; reasons: HealthReason[] } {
  const known = children.filter((c) => c.state !== 'unknown');

  if (children.length === 0) return { state: 'healthy', reasons: [] };

  if (known.length === 0) return { state: 'unknown', reasons: [reason('no-data', `no ${noun} reported yet`)] };

  const failed = known.filter((c) => c.state === 'failed');
  const degraded = known.filter((c) => c.state === 'degraded');
  const atRisk = known.filter((c) => c.state === 'at-risk');
  const reasons: HealthReason[] = [];

  if (failed.length)
    reasons.push(
      reason(
        `${noun}-failed`,
        `${failed.length} of ${children.length} ${noun} failed`,
        failed.map((c) => c.key),
      ),
    );

  if (degraded.length)
    reasons.push(
      reason(
        `${noun}-degraded`,
        `${degraded.length} ${noun} degraded`,
        degraded.map((c) => c.key),
      ),
    );

  if (atRisk.length)
    reasons.push(
      reason(
        `${noun}-at-risk`,
        `${atRisk.length} ${noun} at risk`,
        atRisk.map((c) => c.key),
      ),
    );

  if (failed.length === known.length) return { state: 'failed', reasons };

  if (failed.length || degraded.length) return { state: 'degraded', reasons };

  if (atRisk.length) return { state: 'at-risk', reasons };

  return { state: 'healthy', reasons };
}

/** Worse of two states (for adding own reasons to a rolled-up state). */
function worse(a: HealthState, b: HealthState): HealthState {
  return HEALTH_RANK[a] >= HEALTH_RANK[b] ? a : b;
}

/**
 * The explained health tree (3.25): cluster → site → node and project → deployment → service → replica (+ volumes),
 * every entity with a state and the reasons for it.
 */
export function healthTree(input: HealthInput): HealthNode[] {
  const out: HealthNode[] = [];
  const nodes = input.nodes.filter((n) => n.lifecycle !== 'left');
  const sites = [...new Set(nodes.map((n) => n.site))].sort();
  const siteOf = new Map(nodes.map((n) => [n.name, n.site]));
  const nodeState = new Map<string, HealthState>();

  // Nodes.
  for (const n of nodes) {
    const reasons: HealthReason[] = [];
    let state: HealthState = 'healthy';
    const reachable = n.connected && n.lastSeenAt !== null && input.now - n.lastSeenAt <= input.heartbeatTimeoutMs;

    if (n.lastSeenAt === null) {
      state = 'unknown';
      reasons.push(reason('never-reported', `node ${n.name} has not reported yet`));
    } else if (!reachable) {
      state = 'failed';
      reasons.push(
        reason('node-down', `node ${n.name} is not reachable (last seen ${new Date(n.lastSeenAt).toISOString()})`),
      );
    } else {
      if (n.lifecycle !== 'active') {
        state = 'degraded';
        reasons.push(reason('maintenance', `node ${n.name} is ${n.lifecycle}`));
      }

      for (const [resource, used, total] of [
        ['memory', n.usage?.memoryBytes, n.capacity?.memoryBytes],
        ['disk', n.usage?.diskBytes, n.capacity?.diskBytes],
      ] as const)
        if (used !== undefined && total && used / total >= 0.9) {
          state = worse(state, 'at-risk');
          reasons.push(
            reason(`${resource}-full`, `node ${n.name} uses ${Math.round((used / total) * 100)} % of its ${resource}`),
          );
        }
    }

    nodeState.set(n.name, state);
    out.push({
      key: node(n.name),
      kind: 'node',
      name: n.name,
      parent: `site/${n.site}`,
      project: null,
      state,
      reasons,
    });
  }

  // Sites.
  const siteNodes = new Map<string, HealthNode[]>();

  for (const h of out.filter((x) => x.kind === 'node')) {
    const site = siteOf.get(h.name) as string;

    siteNodes.set(site, [...(siteNodes.get(site) ?? []), h]);
  }

  for (const site of sites) {
    const { state, reasons } = rollUp(siteNodes.get(site) ?? [], 'nodes');

    out.push({ key: `site/${site}`, kind: 'site', name: site, parent: 'cluster', project: null, state, reasons });
  }

  // Replicas → services → deployments → projects.
  const replicas: HealthNode[] = [];

  for (const r of input.replicas.filter((x) => !x.cron)) {
    const reasons: HealthReason[] = [];
    let state: HealthState;
    const onNode = nodeState.get(r.node);

    if (onNode === 'failed') {
      state = 'failed';
      reasons.push(reason('node-down', `its node ${r.node} is down`, [node(r.node)]));
    } else if (!r.state) {
      state = 'unknown';
      reasons.push(reason('no-status', 'no status reported yet'));
    } else if (r.state === 'running' || (r.state === 'exited' && (r.exitCode ?? 0) === 0)) {
      state = 'healthy';
    } else if (r.state === 'restarting' || r.state === 'created') {
      state = 'degraded';
      reasons.push(reason(r.state, `replica is ${r.state}`));
    } else {
      state = 'failed';
      reasons.push(
        reason('replica-down', `replica is ${r.state}${r.exitCode !== undefined ? ` (exit code ${r.exitCode})` : ''}`),
      );
    }

    replicas.push({
      key: `replica/${r.id}`,
      kind: 'replica',
      name: r.id,
      parent: `service/${r.project}/${r.deployment}/${r.service}`,
      project: r.project,
      state,
      reasons,
    });
  }

  out.push(...replicas);

  const services = new Map<string, { project: string; deployment: string; name: string; replicas: HealthNode[] }>();

  for (const [i, r] of input.replicas.filter((x) => !x.cron).entries()) {
    const key = `service/${r.project}/${r.deployment}/${r.service}`;
    const s = services.get(key) ?? { project: r.project, deployment: r.deployment, name: r.service, replicas: [] };

    s.replicas.push(replicas[i]);
    services.set(key, s);
  }

  const replicaSite = new Map(input.replicas.map((r) => [`replica/${r.id}`, siteOf.get(r.node)]));
  const serviceNodes: HealthNode[] = [];

  for (const [key, s] of services) {
    const rolled = rollUp(s.replicas, 'replicas');
    let state = rolled.state;
    const reasons = [...rolled.reasons];
    const replicaSites = new Set(s.replicas.map((r) => replicaSite.get(r.key)));

    // Several replicas, all in one site while the cluster has more: one site outage takes the service down.
    if (s.replicas.length >= 2 && sites.length >= 2 && replicaSites.size === 1 && state === 'healthy') {
      state = 'at-risk';
      reasons.push(reason('single-site', `all ${s.replicas.length} replicas run in site ${[...replicaSites][0]}`));
    }

    const h: HealthNode = {
      key,
      kind: 'service',
      name: s.name,
      parent: `deployment/${s.project}/${s.deployment}`,
      project: s.project,
      state,
      reasons,
    };

    serviceNodes.push(h);
  }

  out.push(...serviceNodes);

  // Volumes.
  const volumeNodes: HealthNode[] = [];

  for (const v of input.volumes) {
    const [project, deployment] = v.id.split('/');
    const reasons: HealthReason[] = [];
    let state: HealthState = 'healthy';
    const up = (n: string) => nodeState.get(n) !== 'failed';
    const copies = [v.primaryNode, ...v.syncReplicas, ...v.remoteReplicas];
    const copySites = new Set(copies.map((n) => siteOf.get(n)));

    if (!up(v.primaryNode)) {
      const standby = v.syncReplicas.filter(up);

      state = standby.length ? 'degraded' : 'failed';
      reasons.push(
        reason(
          'primary-down',
          standby.length
            ? `primary ${v.primaryNode} is down; ${standby.join(', ')} can take over`
            : `primary ${v.primaryNode} is down and no synchronous replica is up`,
          [node(v.primaryNode)],
        ),
      );
    } else if ([...v.syncReplicas, ...v.remoteReplicas].some((n) => !up(n))) {
      state = 'degraded';
      reasons.push(
        reason(
          'replica-down',
          'a replica of the volume is down',
          [...v.syncReplicas, ...v.remoteReplicas].filter((n) => !up(n)).map(node),
        ),
      );
    }

    if (sites.length >= 2 && copySites.size === 1 && state === 'healthy') {
      state = 'at-risk';
      reasons.push(reason('single-site', `volume ${v.id} has no replica outside ${[...copySites][0]}`));
    }

    volumeNodes.push({
      key: `volume/${v.id}`,
      kind: 'volume',
      name: v.id,
      parent: `deployment/${project}/${deployment}`,
      project,
      state,
      reasons,
    });
  }

  out.push(...volumeNodes);

  const deployments = new Map<string, { project: string; name: string; children: HealthNode[] }>();

  for (const c of [...serviceNodes, ...volumeNodes]) {
    const key = c.parent as string;
    const [, project, name] = key.split('/');
    const d = deployments.get(key) ?? { project, name, children: [] };

    d.children.push(c);
    deployments.set(key, d);
  }

  const deploymentNodes: HealthNode[] = [...deployments].map(([key, d]) => ({
    key,
    kind: 'deployment',
    name: d.name,
    parent: `project/${d.project}`,
    project: d.project,
    ...rollUp(d.children, 'parts'),
  }));

  out.push(...deploymentNodes);

  for (const project of [...new Set([...input.projects, ...deploymentNodes.map((d) => d.project as string)])].sort()) {
    const rolled = rollUp(
      deploymentNodes.filter((d) => d.project === project),
      'deployments',
    );
    const inconsistent = input.rollbackFailed.filter((p) => p.projects.includes(project));
    const reasons = [...rolled.reasons];
    let state = rolled.state;

    if (inconsistent.length) {
      state = worse(state, 'at-risk');
      reasons.push(
        reason(
          'rollback-failed',
          `a failed rollback left resources inconsistent (plan ${inconsistent.map((p) => p.id).join(', ')})`,
          inconsistent.map((p) => `plan/${p.id}`),
        ),
      );
    }

    out.push({ key: `project/${project}`, kind: 'project', name: project, parent: null, project, state, reasons });
  }

  out.push(clusterHealth(input, nodes, sites, out, nodeState));

  return out;
}

function clusterHealth(
  input: HealthInput,
  nodes: HealthInput['nodes'],
  sites: string[],
  tree: readonly HealthNode[],
  nodeState: ReadonlyMap<string, HealthState>,
): HealthNode {
  const reasons: HealthReason[] = [];
  let state: HealthState = 'healthy';
  const add = (s: HealthState, r: HealthReason) => {
    state = worse(state, s);
    reasons.push(r);
  };

  // Control-plane quorum (members and witnesses vote).
  const voters = nodes.filter((n) => n.controlPlane || n.witness);
  const upVoters = voters.filter((n) => nodeState.get(n.name) !== 'failed' && nodeState.get(n.name) !== 'unknown');

  if (voters.length && upVoters.length < Math.floor(voters.length / 2) + 1)
    add(
      'failed',
      reason(
        'quorum-lost',
        `the control plane lost its quorum (${upVoters.length} of ${voters.length} up)`,
        voters.map((n) => node(n.name)),
      ),
    );
  else if (voters.length && upVoters.length < voters.length)
    add(
      'at-risk',
      reason(
        'quorum-reduced',
        `${voters.length - upVoters.length} control-plane member(s) down; one more failure loses the quorum`,
        voters.filter((n) => !upVoters.includes(n)).map((n) => node(n.name)),
      ),
    );

  const siteNodes = tree.filter((t) => t.kind === 'site');
  const failedSites = siteNodes.filter((s) => s.state === 'failed');

  if (failedSites.length)
    add(
      failedSites.length === siteNodes.length ? 'failed' : 'degraded',
      reason(
        'site-down',
        `site ${failedSites.map((s) => s.name).join(', ')} is down`,
        failedSites.map((s) => s.key),
      ),
    );

  const failedNodes = tree.filter((t) => t.kind === 'node' && t.state === 'failed');

  if (failedNodes.length && !failedSites.length)
    add(
      'degraded',
      reason(
        'nodes-down',
        `${failedNodes.length} node(s) down`,
        failedNodes.map((n) => n.key),
      ),
    );

  // N+1: the remaining nodes must be able to take the largest node's memory.
  const active = nodes.filter((n) => n.capacity && n.usage && !n.witness);
  const largest = Math.max(0, ...active.map((n) => n.capacity?.memoryBytes ?? 0));
  const capacity = active.reduce((sum, n) => sum + (n.capacity?.memoryBytes ?? 0), 0);
  const used = active.reduce((sum, n) => sum + (n.usage?.memoryBytes ?? 0), 0);

  if (active.length >= 2 && used > capacity - largest)
    add('at-risk', reason('no-n-plus-1', 'the cluster could not absorb the loss of its largest node (memory)'));

  const atRiskVolumes = tree.filter((t) => t.kind === 'volume' && t.state === 'at-risk');

  if (atRiskVolumes.length)
    add(
      'at-risk',
      reason(
        'volumes-at-risk',
        atRiskVolumes.length === 1 ? atRiskVolumes[0].reasons[0].message : `${atRiskVolumes.length} volumes at risk`,
        atRiskVolumes.map((v) => v.key),
      ),
    );

  if (input.rollbackFailed.length)
    add(
      'at-risk',
      reason(
        'rollback-failed',
        `${input.rollbackFailed.length} failed rollback(s) left resources inconsistent`,
        input.rollbackFailed.map((p) => `plan/${p.id}`),
      ),
    );

  for (const pin of input.backupPins ?? [])
    add(
      'at-risk',
      reason(pin.startsWith('backups not recoverable') ? 'backups-not-recoverable' : 'backups-not-offsite', pin),
    );

  if (sites.length === 0) state = 'unknown';

  return { key: 'cluster', kind: 'cluster', name: 'cluster', parent: null, project: null, state, reasons };
}

/** The headline (3.25): the worst state among the given roots, with its first reason. */
export function headline(roots: readonly HealthNode[]): { state: HealthState; message: string; key: string | null } {
  const worst = [...roots].sort((a, b) => HEALTH_RANK[b.state] - HEALTH_RANK[a.state])[0];

  if (!worst) return { state: 'unknown', message: 'Nothing to show yet', key: null };

  const label = {
    healthy: 'Healthy',
    degraded: 'Degraded',
    'at-risk': 'At risk',
    failed: 'Failed',
    unknown: 'Unknown',
  }[worst.state];

  return {
    state: worst.state,
    message: worst.reasons[0] ? `${label}: ${worst.reasons[0].message}` : label,
    key: worst.key,
  };
}

/** What changed between two evaluations (state-change events, 3.25). */
export function healthChanges(
  previous: ReadonlyMap<string, HealthState>,
  current: readonly HealthNode[],
): { key: string; from: HealthState | null; to: HealthState; node: HealthNode }[] {
  return current
    .filter((n) => previous.get(n.key) !== n.state)
    .map((n) => ({ key: n.key, from: previous.get(n.key) ?? null, to: n.state, node: n }));
}

/**
 * Time spent per state within a window (3.25: "how long were we at risk last month"), from state-change events
 * (oldest first) and the state at the window's start.
 */
export function stateDurations(
  initial: HealthState | null,
  changes: readonly { at: number; to: HealthState }[],
  from: number,
  to: number,
): Partial<Record<HealthState, number>> {
  const out: Partial<Record<HealthState, number>> = {};
  let state = initial;
  let since = from;

  for (const change of changes.filter((c) => c.at > from && c.at < to)) {
    if (state) out[state] = (out[state] ?? 0) + (change.at - since);

    state = change.to;
    since = change.at;
  }

  if (state) out[state] = (out[state] ?? 0) + (to - since);

  return out;
}
