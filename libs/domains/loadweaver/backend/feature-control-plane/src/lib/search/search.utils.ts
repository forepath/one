/** One searchable entity (3.25 global search): what it is, where it lives, which project it belongs to. */
export interface SearchDocument {
  /** `kind:key`, stable across re-indexing. */
  id: string;
  kind: string;
  name: string;
  title: string;
  /** Null: cluster-level (cluster roles only). */
  project: string | null;
  /** Console route. */
  link: string;
  text: string;
}

export interface SearchInput {
  resources: { kind: string; name: string; project: string | null; spec: Record<string, unknown> }[];
  services: { project: string; deployment: string; service: string; hosts: string[] }[];
  nodes: { name: string; site: string }[];
  plans: { id: string; status: string; projects: string[]; createdAt: Date }[];
  alerts: { id: string; title: string; project: string | null }[];
}

const KIND_LABEL: Record<string, string> = {
  Project: 'Project',
  Deployment: 'Deployment',
  WorkloadGroup: 'Group',
  NodeGroup: 'Node group',
  Policy: 'Policy',
  DnsRecord: 'DNS record',
  DnsZone: 'DNS zone',
  AlertRule: 'Alert rule',
  Dashboard: 'Dashboard',
  StatusPage: 'Status page',
  IpPool: 'IP pool',
};

/** Everything the global search covers, as documents. Secrets never: only names of what exists. */
export function searchDocuments(input: SearchInput): SearchDocument[] {
  const docs: SearchDocument[] = [];

  for (const r of input.resources) {
    if (r.kind === 'Cluster') continue;

    const project = r.kind === 'Project' ? r.name : r.project;
    // Console routes (like the overview's inbox links).
    const path = `/resources/${r.kind}/${r.name}${r.project ? `?project=${encodeURIComponent(r.project)}` : ''}`;
    const label = KIND_LABEL[r.kind] ?? r.kind;
    const description = typeof r.spec['description'] === 'string' ? (r.spec['description'] as string) : '';

    docs.push({
      id: `${r.kind}:${r.project ?? ''}/${r.name}`,
      kind: r.kind,
      name: r.name,
      title: `${label} ${r.project && r.kind !== 'Project' ? `${r.project}/` : ''}${r.name}`,
      project,
      link: path,
      text: [r.name, r.project ?? '', description, typeof r.spec['title'] === 'string' ? r.spec['title'] : '']
        .join(' ')
        .trim(),
    });
  }

  for (const s of input.services)
    docs.push({
      id: `Service:${s.project}/${s.deployment}/${s.service}`,
      kind: 'Service',
      name: s.service,
      title: `Service ${s.project}/${s.deployment}/${s.service}`,
      project: s.project,
      link: `/health/service/${s.project}/${s.deployment}/${s.service}`,
      text: [s.service, s.deployment, s.project, ...s.hosts].join(' '),
    });

  for (const n of input.nodes)
    docs.push({
      id: `Node:${n.name}`,
      kind: 'Node',
      name: n.name,
      title: `Node ${n.name}`,
      project: null,
      link: `/nodes/${n.name}`,
      text: `${n.name} ${n.site}`,
    });

  for (const p of input.plans)
    docs.push({
      id: `Plan:${p.id}`,
      kind: 'Plan',
      name: p.id,
      title: `Plan ${p.id.slice(0, 8)} (${p.status})`,
      // A plan touching one project belongs to it; others are visible to cluster roles.
      project: p.projects.length === 1 ? p.projects[0] : null,
      link: `/plans/${p.id}`,
      text: `${p.id} ${p.status} ${p.projects.join(' ')}`,
    });

  for (const a of input.alerts)
    docs.push({
      id: `Alert:${a.id}`,
      kind: 'Alert',
      name: a.id,
      title: a.title,
      project: a.project,
      link: `/alerts/${a.id}`,
      text: a.title,
    });

  return docs;
}

export interface SearchAction {
  title: string;
  /** Navigate to a console route, or call the API (the client confirms first). */
  kind: 'navigate' | 'api';
  link?: string;
  request?: { method: 'POST'; path: string };
}

/**
 * Actions for the command palette (3.25): matched by verb and target, only those the caller may do.
 * "drain node n2", "cordon n1", "create plan", "logs of api", "health of shop".
 */
export function matchActions(
  query: string,
  context: {
    nodes: string[];
    services: { project: string; deployment: string; service: string }[];
    projects: string[];
    canManageNodes: boolean;
    canPlan: boolean;
  },
): SearchAction[] {
  const q = query.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const target = words
    .slice(1)
    .filter((w) => w !== 'node' && w !== 'of' && w !== 'in')
    .join(' ');
  const actions: SearchAction[] = [];

  if (!q) return actions;

  const verb = words[0];

  if (context.canManageNodes && ['drain', 'cordon', 'uncordon'].includes(verb))
    for (const node of context.nodes.filter((n) => !target || n.startsWith(target)).slice(0, 5))
      actions.push({
        title: `${verb[0].toUpperCase()}${verb.slice(1)} node ${node}`,
        kind: 'api',
        request: { method: 'POST', path: `/nodes/${node}/${verb}` },
      });

  if (context.canPlan && ('create plan'.startsWith(q) || 'new plan'.startsWith(q)))
    actions.push({ title: 'Create plan', kind: 'navigate', link: '/resources/new' });

  if (verb === 'logs')
    for (const s of context.services.filter((x) => !target || x.service.startsWith(target)).slice(0, 5))
      actions.push({
        title: `Logs of ${s.project}/${s.deployment}/${s.service}`,
        kind: 'navigate',
        link: `/logs?project=${encodeURIComponent(s.project)}&deployment=${encodeURIComponent(s.deployment)}&service=${encodeURIComponent(s.service)}`,
      });

  if (verb === 'health')
    for (const p of context.projects.filter((x) => !target || x.startsWith(target)).slice(0, 5))
      actions.push({ title: `Health of ${p}`, kind: 'navigate', link: `/health/project/${p}` });

  return actions;
}

/** Favourites first, then recently visited, then by relevance (3.25). */
export function rankResults<T extends { id: string; score: number }>(
  hits: readonly T[],
  favourites: ReadonlySet<string>,
  recents: ReadonlyMap<string, number>,
): T[] {
  const tier = (h: T) => (favourites.has(h.id) ? 0 : recents.has(h.id) ? 1 : 2);

  return [...hits].sort(
    (a, b) => tier(a) - tier(b) || (recents.get(b.id) ?? 0) - (recents.get(a.id) ?? 0) || b.score - a.score,
  );
}
