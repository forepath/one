import type { DiscoveredContainer, DiscoveryReport } from '@forepath/loadweaver/shared/util-agent-protocol';

import type { DiscoveredItem } from './types';

/** Docker sockets: bind mounts of these hand the node's Docker to the service, they are never copied. */
const DOCKER_SOCKETS = new Set(['/var/run/docker.sock', '/run/docker.sock']);

/** Resource-name form of a compose project / container name (`[a-z0-9-]`, 63 characters). */
export function resourceName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 63)
      .replace(/-+$/g, '') || 'imported'
  );
}

/** Compose service-name form (`[a-z0-9_.-]`). */
export function composeName(value: string): string {
  return (
    value
      .toLowerCase()
      .replace(/[^a-z0-9_.-]+/g, '-')
      .replace(/^[^a-z0-9]+|[^a-z0-9]+$/g, '')
      .slice(0, 63) || 'service'
  );
}

function serviceOf(container: DiscoveredContainer): string {
  return composeName(container.compose?.service ?? container.name.replace(/^\//, ''));
}

function itemFrom(
  id: string,
  kind: DiscoveredItem['kind'],
  name: string,
  containers: DiscoveredContainer[],
  report: DiscoveryReport,
): DiscoveredItem {
  const sizes = new Map(report.volumes.map((v) => [v.name, v.sizeBytes]));
  const mounts: DiscoveredItem['mounts'] = [];
  const seen = new Set<string>();

  for (const c of containers) {
    for (const m of c.mounts) {
      if (m.type !== 'volume' && m.type !== 'bind') continue;

      if (m.type === 'bind' && DOCKER_SOCKETS.has(m.source)) continue;

      const key = m.type === 'volume' ? `volume:${m.name ?? m.source}` : `bind:${m.source}`;

      if (seen.has(`${key}|${m.destination}`)) continue;

      seen.add(`${key}|${m.destination}`);
      mounts.push({
        key,
        type: m.type,
        source: m.source,
        destination: m.destination,
        service: serviceOf(c),
        sizeBytes: m.type === 'volume' ? (sizes.get(m.name ?? '') ?? null) : null,
        ...(m.directory !== undefined ? { directory: m.directory } : {}),
      });
    }
  }

  return {
    id,
    kind,
    name,
    containers: containers.map((c) => c.id),
    services: [...new Set(containers.map(serviceOf))],
    ports: containers.flatMap((c) =>
      c.ports
        .filter((p) => p.hostPort > 0)
        .map((p) => ({
          protocol: p.protocol,
          hostPort: p.hostPort,
          containerPort: p.containerPort,
          service: serviceOf(c),
        })),
    ),
    mounts,
    stateful: containers.some((c) =>
      c.mounts.some(
        (m) => (m.type === 'volume' || (m.type === 'bind' && !DOCKER_SOCKETS.has(m.source))) && !m.readOnly,
      ),
    ),
    managed: containers.some((c) => c.managed),
  };
}

/**
 * The units the import wizard decides on (3.21): every compose project (by `com.docker.compose.project`) and every
 * other container. Containers of a former Loadweaver installation of the same cluster are not offered: their
 * deployments still exist and the node gets them back.
 */
export function discoveredItems(report: DiscoveryReport, options: { skipManaged?: boolean } = {}): DiscoveredItem[] {
  const byProject = new Map<string, DiscoveredContainer[]>();
  const standalone: DiscoveredContainer[] = [];

  for (const c of report.containers) {
    if (options.skipManaged && c.managed) continue;

    if (c.compose) byProject.set(c.compose.project, [...(byProject.get(c.compose.project) ?? []), c]);
    else standalone.push(c);
  }

  const projects = [...new Set([...report.composeProjects.map((p) => p.name), ...byProject.keys()])].sort();

  return [
    ...projects
      .map((p) => itemFrom(`compose:${p}`, 'compose', p, byProject.get(p) ?? [], report))
      .filter((i) => i.containers.length > 0),
    ...standalone
      .map((c) =>
        itemFrom(`container:${c.name.replace(/^\//, '')}`, 'container', c.name.replace(/^\//, ''), [c], report),
      )
      .sort((a, b) => a.id.localeCompare(b.id)),
  ];
}
