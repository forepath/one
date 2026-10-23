import type { DiscoveredComposeProject, DiscoveryReport } from '@forepath/loadweaver/shared/util-agent-protocol';
import { parseCompose, startOrder } from '@forepath/loadweaver/shared/util-compose';
import {
  LOADWEAVER_API_VERSION,
  hostnamePatternSchema,
  type NodeImportStep,
  type Resource,
} from '@forepath/loadweaver/shared/util-model';
import { parse, stringify } from 'yaml';

import { resolveConflicts } from './conflicts';
import { classifyFormer } from './former';
import { composeName, discoveredItems, resourceName } from './items';
import type {
  DiscoveredItem,
  ImportClusterContext,
  ImportConflict,
  ImportedDeployment,
  ImportItemSelection,
  ImportSelections,
  JoinPlan,
  VolumeHandling,
} from './types';

const GIB = 1024 ** 3;
const NAME = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;
/** Ports the HTTP ingress serves itself (3.6): they can't be TCP forwards. */
const HTTP_INGRESS_PORTS = new Set([80, 443]);
/** The import annotations: where a deployment came from, and the node whose join plan holds it until released. */
export const IMPORTED_FROM_ANNOTATION = 'loadweaver.com/imported-from';
export const IMPORT_NODE_ANNOTATION = 'loadweaver.com/import';
/** The label the scheduler gives every node (P4): pins imported deployments to the node their data is on. */
export const NODE_LABEL = 'loadweaver.com/node';

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A replicated volume large enough for the data and growth: 1.5 × used, at least 1 GiB, whole GiB. */
export function importVolumeSize(usedBytes: number | null, fallbackBytes = 10 * GIB): string {
  if (usedBytes === null) return `${Math.max(1, Math.ceil(fallbackBytes / GIB))}g`;

  return `${Math.max(1, Math.ceil((usedBytes * 1.5) / GIB))}g`;
}

/** Compose volume key for a bind mount converted into a replicated volume. */
export function bindVolumeKey(source: string): string {
  return `bind-${composeName(source.replace(/^\/+/, '').replace(/\//g, '-'))}`.slice(0, 63).replace(/[^a-z0-9]+$/, '');
}

interface ComposeBuild {
  compose: string;
  variables: Record<string, string>;
  copies: { source: string; volumeKey: string }[];
  errors: string[];
  warnings: string[];
}

function composeProjectOf(report: DiscoveryReport, item: DiscoveredItem): DiscoveredComposeProject | undefined {
  return item.kind === 'compose' ? report.composeProjects.find((p) => p.name === item.name) : undefined;
}

/**
 * The compose file of an imported item: the project's own file when discovery could read exactly one (its options,
 * environment and dependencies stay as they are), otherwise one generated from the running containers. Ports, mounts
 * and placement always come from what runs: published ports become ingress HTTP routes (with a hostname) or ingress
 * forwards, volumes and bind mounts become replicated volumes the data is copied into (or stay host binds / start
 * empty, as chosen), and the services are pinned to the node (import) or kept off it (migrate).
 */
function buildCompose(
  report: DiscoveryReport,
  item: DiscoveredItem,
  selection: ImportItemSelection,
  node: string,
  cluster: ImportClusterContext,
): ComposeBuild {
  const errors: string[] = [];
  const warnings: string[] = [];
  const project = composeProjectOf(report, item);
  const readable = project?.configFiles.filter((f) => f.content !== undefined) ?? [];
  let doc: Obj = {};

  if (project && project.configFiles.length === 1 && readable.length === 1) {
    try {
      const parsed = parse(readable[0].content as string, { maxAliasCount: 100 }) as unknown;

      doc = isObj(parsed) ? parsed : {};
    } catch (error) {
      warnings.push(
        `${item.id}: ${readable[0].path} is not valid YAML (${String(error)}); generated from the containers`,
      );
    }
  } else if (project) {
    warnings.push(
      `${item.id}: ${project.configFiles.length === 0 ? 'no compose file found' : project.configFiles.length > 1 ? 'several compose files' : 'the compose file could not be read'}; the compose file is generated from the running containers (environment variables are not copied)`,
    );
  }

  const services: Obj = isObj(doc['services']) ? (doc['services'] as Obj) : {};
  const containers = report.containers.filter((c) => item.containers.includes(c.id));
  const volumes: Obj = isObj(doc['volumes']) ? { ...(doc['volumes'] as Obj) } : {};
  const nextVolumes: Obj = {};
  const copies: ComposeBuild['copies'] = [];
  const handling = (key: string, type: 'volume' | 'bind'): VolumeHandling =>
    selection.volumes?.[key] ?? (type === 'volume' ? 'copy' : 'copy');

  for (const container of containers) {
    const name = composeName(container.compose?.service ?? container.name.replace(/^\//, ''));
    const service: Obj = isObj(services[name]) ? { ...(services[name] as Obj) } : {};

    // What runs: the image the container was created from (a host-built image exists only on this node).
    if (service['build'] !== undefined) {
      if (typeof service['image'] !== 'string') service['image'] = container.image;

      delete service['build'];
      warnings.push(
        `${item.id}/${name}: built on the host; ${selection.choice === 'migrate' ? 'push the image to a registry first' : 'the image exists only on this node'}`,
      );
    }

    if (typeof service['image'] !== 'string') service['image'] = container.image;

    // Ports: HTTP ones go to the ingress by hostname, the rest become ingress forwards.
    const ports: string[] = [];
    const http: { host: string; port: number }[] = [];

    for (const p of container.ports.filter((x) => x.hostPort > 0)) {
      const host = selection.http?.[String(p.hostPort)];

      if (host) {
        if (p.protocol !== 'tcp')
          errors.push(`${item.id}/${name}: ${p.hostPort}/${p.protocol} can't be served over HTTP`);
        else if (!hostnamePatternSchema.safeParse(host).success)
          errors.push(`${item.id}/${name}: ${host} is not a valid hostname`);
        else if (cluster.hostnames[host])
          errors.push(`${item.id}/${name}: ${host} is served by ${cluster.hostnames[host]} already`);
        else http.push({ host, port: p.containerPort });
        continue;
      }

      if (p.protocol === 'sctp') {
        errors.push(`${item.id}/${name}: ${p.hostPort}/sctp is not supported by the ingress`);
        continue;
      }

      if (p.protocol === 'tcp' && HTTP_INGRESS_PORTS.has(p.hostPort)) {
        errors.push(
          `${item.id}/${name}: port ${p.hostPort} is served by the HTTP ingress; give a hostname for it (the ingress routes by host name)`,
        );
        continue;
      }

      const owner = cluster.forwardedPorts[`${p.protocol}/${p.hostPort}`];

      if (owner) {
        errors.push(`${item.id}/${name}: the ingress forwards ${p.hostPort}/${p.protocol} for ${owner} already`);
        continue;
      }

      ports.push(`${p.hostPort}:${p.containerPort}/${p.protocol}`);
    }

    if (ports.length) service['ports'] = [...new Set(ports)];
    else delete service['ports'];

    // Mounts: from what runs (resolved paths), by the chosen handling.
    const mounts: string[] = [];

    for (const m of container.mounts) {
      const ro = m.readOnly ? ':ro' : '';

      if (m.type === 'volume') {
        const discovered = report.volumes.find((v) => v.name === m.name);
        const key = composeName(discovered?.compose?.volume ?? m.name ?? 'data');
        const choice = handling(`volume:${m.name ?? m.source}`, 'volume');

        if (choice === 'keep') {
          errors.push(`${item.id}/${name}: Docker volume ${m.name} can only be copied or started empty`);
          continue;
        }

        mounts.push(`${key}:${m.destination}${ro}`);
        nextVolumes[key] = {
          'x-loadweaver': { size: importVolumeSize(discovered?.sizeBytes ?? null, cluster.defaultVolumeSizeBytes) },
        };

        if (discovered && discovered.driver !== 'local')
          warnings.push(
            `${item.id}: volume ${m.name} used driver ${discovered.driver}; it becomes a replicated volume`,
          );

        if (choice === 'copy' && !copies.some((c) => c.volumeKey === key))
          copies.push({ source: discovered?.mountpoint || m.source, volumeKey: key });
      } else if (m.type === 'bind') {
        if (m.source === '/var/run/docker.sock' || m.source === '/run/docker.sock') {
          mounts.push(`${m.source}:${m.destination}${ro}`);
          continue;
        }

        const choice = handling(`bind:${m.source}`, 'bind');

        if (choice === 'keep') {
          if (selection.choice === 'migrate')
            errors.push(
              `${item.id}/${name}: host path ${m.source} stays on this node; copy it or start empty to migrate`,
            );

          mounts.push(`${m.source}:${m.destination}${ro}`);
          continue;
        }

        if (m.directory === false) {
          errors.push(
            `${item.id}/${name}: ${m.source} is a file; keep it as a host bind or move it into a config / secret`,
          );
          continue;
        }

        const key = bindVolumeKey(m.source);

        mounts.push(`${key}:${m.destination}${ro}`);
        nextVolumes[key] = { 'x-loadweaver': { size: importVolumeSize(null, cluster.defaultVolumeSizeBytes) } };

        if (choice === 'copy' && !copies.some((c) => c.volumeKey === key))
          copies.push({ source: m.source, volumeKey: key });
      } else if (m.type === 'tmpfs') {
        // tmpfs stays as declared in the compose file.
      }
    }

    if (mounts.length) service['volumes'] = mounts;
    else delete service['volumes'];

    const extension: Obj = isObj(service['x-loadweaver']) ? { ...(service['x-loadweaver'] as Obj) } : {};

    extension['placement'] = {
      ...(isObj(extension['placement']) ? (extension['placement'] as Obj) : {}),
      selector:
        selection.choice === 'migrate'
          ? { matchExpressions: [{ key: NODE_LABEL, operator: 'NotIn', values: [node] }] }
          : { matchLabels: { [NODE_LABEL]: node } },
    };

    if (http.length) extension['exposure'] = { http };

    service['x-loadweaver'] = extension;
    services[name] = service;
  }

  for (const [key, value] of Object.entries(volumes)) {
    if (nextVolumes[key]) continue;

    // Declared but unused volumes stay (they get a default size).
    if (isObj(value) && value['external']) continue;

    nextVolumes[key] = value ?? {};
  }

  const out: Obj = { ...doc, services };

  delete out['version'];

  if (Object.keys(nextVolumes).length) out['volumes'] = nextVolumes;
  else delete out['volumes'];

  const variables: Record<string, string> = {};

  for (const v of project?.envFile?.variables ?? []) if (v.value !== undefined) variables[v.name] = v.value;

  for (const v of project?.envFile?.variables ?? [])
    if (v.sensitive && selection.variables?.[v.name] === undefined)
      warnings.push(
        `${item.id}: ${v.name} from ${project?.envFile?.path} looks sensitive and was not reported; give its value in the wizard if the compose file uses it`,
      );

  for (const file of project?.configFiles ?? [])
    for (const r of file.redacted ?? [])
      if (selection.variables?.[r.variable] === undefined)
        warnings.push(
          `${item.id}: ${r.path} held a secret and was redacted on the host; give ${r.variable} in the wizard`,
        );

  Object.assign(variables, selection.variables ?? {});

  return { compose: stringify(out, { lineWidth: 0 }), variables, copies, errors, warnings };
}

/** Container ids in stop order: dependents first (reverse compose start order), unknown services last. */
function stopOrder(item: DiscoveredItem, report: DiscoveryReport, waves: string[][]): string[] {
  const service = (id: string) => {
    const c = report.containers.find((x) => x.id === id);

    return composeName(c?.compose?.service ?? c?.name.replace(/^\//, '') ?? '');
  };
  const rank = new Map(waves.flatMap((wave, i) => wave.map((s) => [s, i] as const)));

  return [...item.containers].sort((a, b) => (rank.get(service(b)) ?? -1) - (rank.get(service(a)) ?? -1));
}

/**
 * Builds the one join plan of a pending node (3.21) from its discovery and the wizard's selections: conflicts
 * (resolved or refused with a reason), the former installation (reuse or wipe), the deployments to create and the
 * ordered steps — install components, wipe / reuse, activate (own tunnel, make-before-break), per deployment rsync
 * pre-copy while the source runs, short stop, final pass, release under Loadweaver, verify, then hand the ports
 * over to the ingress. Pure: the control plane, the console preview and the labs use the same function.
 */
export function buildJoinPlan(
  report: DiscoveryReport,
  selections: ImportSelections,
  cluster: ImportClusterContext,
): JoinPlan {
  const errors: string[] = [];
  const warnings: string[] = [...report.warnings.map((w) => `discovery: ${w}`)];
  const former = classifyFormer(report, cluster);
  const items = discoveredItems(report, { skipManaged: former?.kind === 'same-cluster' });
  const chosen = new Map(selections.items.map((s) => [s.item, s]));

  for (const s of selections.items)
    if (!items.some((i) => i.id === s.item)) errors.push(`${s.item}: not found in the discovery (discover again?)`);

  const deployments: ImportedDeployment[] = [];
  const leftovers: string[] = [];
  const names = new Set<string>();
  const freed = new Set<string>();

  for (const item of items) {
    const selection = chosen.get(item.id);

    if (!selection || selection.choice === 'ignore') {
      leftovers.push(item.id);
      continue;
    }

    const project = selection.project;
    const name = selection.deployment ?? resourceName(item.name);

    if (!project || !NAME.test(project)) {
      errors.push(`${item.id}: choose a target project`);
      continue;
    }

    if (!cluster.projects.includes(project)) errors.push(`${item.id}: project ${project} does not exist`);

    if (!NAME.test(name)) {
      errors.push(`${item.id}: ${name} is not a valid deployment name`);
      continue;
    }

    if (cluster.deployments.includes(`${project}/${name}`))
      errors.push(`${item.id}: deployment ${project}/${name} exists already; choose another name`);

    if (names.has(`${project}/${name}`)) errors.push(`${item.id}: deployment ${project}/${name} is chosen twice`);

    names.add(`${project}/${name}`);

    if (selection.choice === 'migrate' && item.stateful)
      errors.push(
        `${item.id}: has data (read-write volumes or bind mounts); import it here, then move it with a normal plan (the replicated volume syncs to the target)`,
      );

    if (item.managed && former?.kind !== 'same-cluster' && item.stateful)
      errors.push(
        `${item.id}: a workload of the former cluster with Loadweaver volumes; back it up and restore it, its old volumes are removed`,
      );

    const build = buildCompose(report, item, selection, cluster.node, cluster);

    errors.push(...build.errors);
    warnings.push(...build.warnings);

    const parsed = parseCompose(build.compose, {
      name,
      project,
      variables: build.variables,
      defaultRequests: { cpuMillis: 100, memoryBytes: 128 * 1024 * 1024 },
    });
    let waves: string[][] = [];

    if ('issues' in parsed) {
      errors.push(
        ...parsed.issues
          .filter((i) => i.level === 'error')
          .map((i) => `${item.id}: ${i.path ? `${i.path}: ` : ''}${i.message}`),
      );
    } else {
      warnings.push(...parsed.warnings.map((i) => `${item.id}: ${i.path ? `${i.path}: ` : ''}${i.message}`));

      try {
        waves = startOrder(parsed.deployment);
      } catch {
        errors.push(`${item.id}: dependency cycle between services`);
      }
    }

    const variables = Object.fromEntries(Object.entries(build.variables).filter(([k]) => build.compose.includes(k)));
    const resource: Resource<'Deployment'> = {
      apiVersion: LOADWEAVER_API_VERSION,
      kind: 'Deployment',
      metadata: {
        name,
        project,
        annotations: {
          [IMPORTED_FROM_ANNOTATION]: `${cluster.node}/${item.id}`.slice(0, 1024),
          [IMPORT_NODE_ANNOTATION]: cluster.node,
        },
      },
      spec: { compose: build.compose, ...(Object.keys(variables).length ? { variables } : {}) },
    };
    const ports = item.ports
      .filter((p): p is typeof p & { protocol: 'tcp' | 'udp' } => p.protocol !== 'sctp')
      .map((p) => ({ protocol: p.protocol, port: p.hostPort }));

    ports.forEach((p) => freed.add(`${p.protocol}/${p.port}`));
    deployments.push({
      item: item.id,
      choice: selection.choice,
      project,
      name,
      resource,
      containers: stopOrder(item, report, waves),
      copies: build.copies.map((c) => ({ source: c.source, volume: `${project}/${name}/${c.volumeKey}` })),
      ports: [...new Map(ports.map((p) => [`${p.protocol}/${p.port}`, p])).values()],
    });
  }

  const resolution = resolveConflicts(report, cluster, freed);
  const conflicts: ImportConflict[] = resolution.conflicts;

  errors.push(
    ...conflicts
      .filter((c) => c.severity === 'error')
      .map((c) => `${c.subject}: ${c.reason} (${c.resolution ?? 'resolve it'})`),
  );

  if (!report.docker.available && deployments.length) errors.push('Docker is not available on the host');

  const wipe = !!former?.requiresWipe;

  if (wipe && !selections.wipeFormerIdentity)
    errors.push(
      `the host belonged to ${former?.clusterId ? `cluster ${former.clusterId}` : 'another cluster'}: confirm discarding its identity and keys (wipeFormerIdentity)`,
    );

  const steps: NodeImportStep[] = [
    {
      id: 'components',
      kind: 'components',
      description:
        'Install the node components (Docker live-restore, gVisor, WireGuard, nftables, BIRD, storage packages, rsync); present ones are left as they are',
    },
  ];

  if (wipe)
    steps.push({
      id: 'wipe-identity',
      kind: 'wipe-identity',
      description: `Discard the identity and keys of ${former?.clusterId ? `cluster ${former.clusterId}` : 'the former cluster'}${former?.discarded.length ? `; its volumes (${former.discarded.map((r) => r.resource).join(', ')}) are removed on activation` : ''}`,
    });

  if (former?.kind === 'same-cluster' && former.reusable.length)
    steps.push({
      id: 'reuse-replicas',
      kind: 'reuse-replicas',
      description: `Reuse ${former.reusable.length} replica(s) left on the node; DRBD resyncs only the difference`,
      volumes: former.reusable.map((r) => r.volume as string),
    });

  steps.push({
    id: 'activate',
    kind: 'activate',
    description:
      "Activate the node: its own WireGuard tunnel, routes and filtering (in Loadweaver's own nftables tables); the agent's stream switches from the bootstrap path make-before-break",
  });

  const imports = deployments.filter((d) => d.choice === 'import');
  const migrations = deployments.filter((d) => d.choice === 'migrate');

  for (const d of imports.filter((x) => x.copies.length))
    steps.push({
      id: `${d.project}/${d.name}/precopy`,
      kind: 'precopy',
      deployment: `${d.project}/${d.name}`,
      description: `Pre-copy ${d.copies.length} volume(s) of ${d.item} with rsync while it still runs`,
      copies: d.copies,
    });

  for (const d of migrations) {
    const id = `${d.project}/${d.name}`;

    steps.push(
      { id: `${id}/release`, kind: 'release', deployment: id, description: `Start ${id} on other nodes` },
      { id: `${id}/verify`, kind: 'verify', deployment: id, description: `Wait until every replica of ${id} runs` },
      {
        id: `${id}/stop`,
        kind: 'stop',
        deployment: id,
        containers: d.containers,
        description: `Stop ${d.item} on the host (make-before-break: the new replicas run already)`,
      },
    );
  }

  for (const d of imports) {
    const id = `${d.project}/${d.name}`;

    steps.push({
      id: `${id}/stop`,
      kind: 'stop',
      deployment: id,
      containers: d.containers,
      description: `Stop ${d.item} (${d.containers.length} container(s), dependents first): the short stop begins`,
    });

    if (d.copies.length)
      steps.push({
        id: `${id}/final-sync`,
        kind: 'final-sync',
        deployment: id,
        copies: d.copies,
        description: `Final rsync pass of ${d.copies.length} volume(s) (with deletes) while ${d.item} is stopped`,
      });

    steps.push(
      {
        id: `${id}/release`,
        kind: 'release',
        deployment: id,
        description: `Start ${id} under Loadweaver on ${cluster.node}`,
      },
      { id: `${id}/verify`, kind: 'verify', deployment: id, description: `Wait until every replica of ${id} runs` },
    );
  }

  const handedOver = deployments.flatMap((d) => d.ports);

  if (deployments.length)
    steps.push({
      id: 'handover',
      kind: 'handover',
      containers: deployments.flatMap((d) => d.containers),
      ports: handedOver,
      description: `Hand ${handedOver.length ? handedOver.map((p) => `${p.port}/${p.protocol}`).join(', ') : 'the services'} over to the Loadweaver ingress; the stopped containers stay (restart policy off) for a manual rollback`,
    });

  if (leftovers.length) warnings.push(`left unmanaged (visible as drift): ${leftovers.join(', ')}`);

  return {
    node: cluster.node,
    former,
    conflicts,
    errors: [...new Set(errors)],
    warnings: [...new Set(warnings)],
    deployments,
    steps,
    reservedPorts: resolution.reservedPorts,
    leftovers,
    wipeFormerIdentity: wipe && !!selections.wipeFormerIdentity,
  };
}
