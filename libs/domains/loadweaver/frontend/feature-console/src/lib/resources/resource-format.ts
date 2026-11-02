import { resourceObjectRoute } from '../objects/object-route';
import { SCHEMA_KIND_LABELS } from '../objects/schema-form-labels';
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
  VirtualMachine: 'bi-pc-display',
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
  AutonomousSystem: 'bi-diagram-2',
  BgpPeer: 'bi-hdd-network',
  BgpAnnouncement: 'bi-megaphone',
  BackupPolicy: 'bi-archive',
  BackupTarget: 'bi-cloud-arrow-up',
  Restore: 'bi-arrow-counterclockwise',
  MaintenanceWindow: 'bi-calendar-week',
  NodeImport: 'bi-box-arrow-in-down',
};

export function kindIcon(kind: string): string {
  return KIND_ICONS[kind] ?? 'bi-file-earmark-code';
}

/**
 * A kind's readable, translated name for visible text (D7): `BackupPolicy` → "Backup policy"; kinds without a label
 * are split into words (`FooBar` → "Foo bar", acronyms kept).
 */
export function kindDisplayName(kind: string): string {
  const label = SCHEMA_KIND_LABELS[kind];

  if (label) return label;

  const words = kind.replace(/([a-z0-9])([A-Z])/g, '$1 $2').split(' ');

  return words.map((w, i) => (i === 0 ? w : /^[A-Z]{2,}$/.test(w) ? w : w.toLowerCase())).join(' ');
}

export function resourceKey(resource: ConsoleResource<unknown>): ResourceKey {
  return { kind: resource.kind, name: resource.metadata.name, project: resource.metadata.project ?? null };
}

/** `?project=` for project resources, nothing for cluster-level ones. */
export function projectParams(project: string | null | undefined): Record<string, string> {
  return project ? { project } : {};
}

/** Router commands of a resource's object page (3.37; the project is part of the path). */
export function resourceLink(key: ResourceKey): string[] {
  return [...resourceObjectRoute(key)];
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
