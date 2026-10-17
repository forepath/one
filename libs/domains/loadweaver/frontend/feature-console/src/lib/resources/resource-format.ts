import type { ConsoleResource, ResourceKey } from '@forepath/loadweaver/frontend/data-access-console';

/** Icons per kind (Bootstrap Icons); other kinds get a generic file icon. */
const KIND_ICONS: Record<string, string> = {
  Cluster: 'bi-diagram-3',
  Site: 'bi-geo-alt',
  Node: 'bi-hdd',
  NodeGroup: 'bi-hdd-stack',
  WorkloadGroup: 'bi-collection',
  Policy: 'bi-shield-check',
  Project: 'bi-folder',
  Deployment: 'bi-box-seam',
  DnsProvider: 'bi-server',
  DnsZone: 'bi-globe2',
  DnsRecord: 'bi-signpost',
  DnsFailover: 'bi-sign-turn-right',
  IpPool: 'bi-ethernet',
  AlertRule: 'bi-bell',
  Dashboard: 'bi-speedometer2',
  StatusPage: 'bi-broadcast-pin',
  ClientGroup: 'bi-laptop',
  ImagePolicy: 'bi-patch-check',
};

export function kindIcon(kind: string): string {
  return KIND_ICONS[kind] ?? 'bi-file-earmark-code';
}

export function resourceKey(resource: ConsoleResource<unknown>): ResourceKey {
  return { kind: resource.kind, name: resource.metadata.name, project: resource.metadata.project ?? null };
}

/** `?project=` for project resources, nothing for cluster-level ones. */
export function projectParams(project: string | null | undefined): Record<string, string> {
  return project ? { project } : {};
}

/** Router commands of a resource's detail view (with `projectParams` as query parameters). */
export function resourceLink(key: ResourceKey): string[] {
  return ['/resources', key.kind, key.name];
}

/** Router commands of a resource's editor. */
export function resourceEditLink(key: ResourceKey): string[] {
  return ['/resources', key.kind, key.name, 'edit'];
}

/** `Deployment shop/web` or `Site fra1`. */
export function resourceLabel(key: ResourceKey): string {
  return `${key.kind} ${key.project ? `${key.project}/` : ''}${key.name}`;
}

/** The free-text description most specs carry. */
export function resourceDescription(resource: ConsoleResource<unknown>): string | null {
  const description = (resource.spec as { description?: unknown } | null)?.description;

  return typeof description === 'string' && description.trim() ? description : null;
}

/** Case-insensitive search over kind, name, project, labels and description. */
export function matchesResourceSearch(resource: ConsoleResource<unknown>, search: string): boolean {
  const needle = search.trim().toLowerCase();

  if (!needle) return true;

  return [
    resource.kind,
    resource.metadata.name,
    resource.metadata.project ?? '',
    resourceDescription(resource) ?? '',
    ...Object.entries(resource.metadata.labels ?? {}).map(([k, v]) => `${k}=${v}`),
  ].some((value) => value.toLowerCase().includes(needle));
}
