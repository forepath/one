import { isValidTimeZone, parseCron } from '@forepath/loadweaver/shared/util-scheduler';
import { PRIVATE_REGISTRY_HOST } from '@forepath/loadweaver/shared/util-model';
import { parseDocument } from 'yaml';

import { parseImageReference } from './image-reference';

import { serviceExtensionSchema, volumeExtensionSchema, type ServiceExtension } from './extensions';
import type {
  ComposeDeployment,
  ComposeIssue,
  ComposeParseResult,
  FileMount,
  HealthCheck,
  Pin,
  PortExposure,
  Rate,
  ResourceAmount,
  ServiceSpec,
  VolumeMount,
  VolumeSpec,
} from './model';
import { parseBytes, parseCpus, parseDuration } from './units';

export interface ComposeParseOptions {
  /** Deployment (compose project) name. */
  name: string;
  /** Owning Loadweaver project, used for secret references. */
  project: string;
  /** Values for `${VAR}` interpolation. Nothing is read from the process environment. */
  variables?: Record<string, string>;
  /** Project defaults for services without `deploy.resources` (3.11). */
  defaultRequests: ResourceAmount;
  defaultVolumeSizeBytes?: number;
}

export const MAX_COMPOSE_BYTES = 1024 * 1024;
/** Binding one of these hands the node's Docker to the service (Agenstra's Docker-host agent manager, 4). */
const DOCKER_SOCKETS = ['/var/run/docker.sock', '/run/docker.sock'];
const NAME = /^[a-z0-9]([a-z0-9_.-]{0,61}[a-z0-9])?$/;
const DEFAULT_NETWORK = 'default';

type Obj = Record<string, unknown>;

function isObj(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

class Issues {
  readonly list: ComposeIssue[] = [];

  error(path: string, message: string): void {
    this.list.push({ level: 'error', path, message });
  }

  warn(path: string, message: string): void {
    this.list.push({ level: 'warning', path, message });
  }

  get hasErrors(): boolean {
    return this.list.some((i) => i.level === 'error');
  }
}

/** Compose variable interpolation: `$VAR`, `${VAR}`, `${VAR:-default}`, `${VAR-default}`, `${VAR:?err}`, `$$`. */
const RATE_UNITS: Record<string, Rate['unit']> = {
  s: 'second',
  m: 'minute',
  h: 'hour',
  d: 'day',
  second: 'second',
  minute: 'minute',
  hour: 'hour',
  day: 'day',
};

/** `100/m` → 100 per minute (validated by the extension schema). */
export function parseRate(value: string): Rate {
  const [requests, unit] = value.split('/');

  return { requests: Number(requests), unit: RATE_UNITS[unit] };
}

export function interpolate(
  value: string,
  variables: Record<string, string>,
  onMissing: (name: string, message?: string) => void,
): string {
  return value.replace(
    /\$(\$|\{([A-Za-z_][A-Za-z0-9_]*)(?:(:?[-?])([^}]*))?\}|([A-Za-z_][A-Za-z0-9_]*))/g,
    (match, escaped, braced, op, arg, bare) => {
      if (escaped === '$') return '$';

      const name: string = braced ?? bare;
      const set = Object.prototype.hasOwnProperty.call(variables, name);
      const current = set ? variables[name] : undefined;
      const empty = current === undefined || current === '';

      switch (op) {
        case ':-':
          return empty ? arg : (current as string);
        case '-':
          return set ? (current as string) : arg;
        case ':?':
        case '?':
          if (op === ':?' ? empty : !set) {
            onMissing(name, arg || undefined);

            return '';
          }

          return current as string;
        default:
          if (!set) {
            onMissing(name);

            return '';
          }

          return current as string;
      }
    },
  );
}

function interpolateTree(value: unknown, variables: Record<string, string>, issues: Issues, path: string): unknown {
  if (typeof value === 'string') {
    return interpolate(value, variables, (name, message) =>
      issues.error(path, message ?? `variable ${name} is not set`),
    );
  }

  if (Array.isArray(value)) return value.map((v, i) => interpolateTree(v, variables, issues, `${path}[${i}]`));

  if (isObj(value)) {
    // Extension fields (x-*) are interpolated too; keys never are.
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, interpolateTree(v, variables, issues, path ? `${path}.${k}` : k)]),
    );
  }

  return value;
}

function stringList(value: unknown, issues: Issues, path: string): string[] | undefined {
  if (value === undefined || value === null) return undefined;

  if (typeof value === 'string') return splitCommand(value);

  if (Array.isArray(value) && value.every((v) => typeof v === 'string' || typeof v === 'number'))
    return value.map(String);

  issues.error(path, 'expected a string or a list of strings');

  return undefined;
}

/** Shell-like split for the string form of `command` / `entrypoint` (quotes, no expansion). */
export function splitCommand(value: string): string[] {
  const out: string[] = [];
  const re = /"((?:[^"\\]|\\.)*)"|'([^']*)'|(\S+)/g;
  let match: RegExpExecArray | null;

  while ((match = re.exec(value)) !== null)
    out.push(match[1] !== undefined ? match[1].replace(/\\(.)/g, '$1') : (match[2] ?? match[3]));

  return out;
}

function keyValues(value: unknown, issues: Issues, path: string): Record<string, string> {
  const out: Record<string, string> = {};

  if (value === undefined || value === null) return out;

  if (Array.isArray(value)) {
    for (const entry of value) {
      if (typeof entry !== 'string') {
        issues.error(path, 'list entries must be KEY=value strings');
        continue;
      }

      const index = entry.indexOf('=');

      // `KEY` without value would pass through the local environment in compose; there is none here.
      if (index < 0) issues.warn(path, `${entry} has no value and is set to an empty string`);

      out[index < 0 ? entry : entry.slice(0, index)] = index < 0 ? '' : entry.slice(index + 1);
    }

    return out;
  }

  if (isObj(value)) {
    for (const [k, v] of Object.entries(value)) out[k] = v === null || v === undefined ? '' : String(v);

    return out;
  }

  issues.error(path, 'expected a map or a list');

  return out;
}

function parsePortRange(text: string): [number, number] | null {
  const match = /^(\d{1,5})(?:-(\d{1,5}))?$/.exec(text);

  if (!match) return null;

  const start = Number(match[1]);
  const end = Number(match[2] ?? match[1]);

  return start >= 1 && end <= 65535 && start <= end ? [start, end] : null;
}

/** Compose `ports` short and long syntax → exposures (never bound on a host, 3.11). */
function parsePorts(value: unknown, issues: Issues, path: string): PortExposure[] {
  if (value === undefined) return [];

  if (!Array.isArray(value)) {
    issues.error(path, 'ports must be a list');

    return [];
  }

  const out: PortExposure[] = [];

  value.forEach((entry, i) => {
    const p = `${path}[${i}]`;

    if (isObj(entry)) {
      const target = Number(entry['target']);
      const published = entry['published'] === undefined ? target : Number(String(entry['published']).split('-')[0]);
      const protocol = entry['protocol'] === 'udp' ? 'udp' : 'tcp';

      if (
        !Number.isInteger(target) ||
        target < 1 ||
        target > 65535 ||
        !Number.isInteger(published) ||
        published < 1 ||
        published > 65535
      ) {
        issues.error(p, 'invalid port');

        return;
      }

      if (entry['host_ip']) issues.warn(p, 'host_ip is ignored: exposures listen on the failover IPs');

      out.push({ protocol, publishedPort: published, targetPort: target });

      return;
    }

    const text = String(entry);
    const [spec, proto = 'tcp'] = text.split('/');

    if (proto !== 'tcp' && proto !== 'udp') {
      issues.error(p, `unsupported protocol ${proto}`);

      return;
    }

    const parts = spec.split(':');

    if (parts.length === 3) issues.warn(p, 'host IP is ignored: exposures listen on the failover IPs');

    const containerRange = parsePortRange(parts[parts.length - 1]);
    const publishedRange = parts.length > 1 ? parsePortRange(parts[parts.length - 2]) : containerRange;

    if (
      !containerRange ||
      !publishedRange ||
      containerRange[1] - containerRange[0] !== publishedRange[1] - publishedRange[0]
    ) {
      issues.error(p, `invalid port mapping ${text}`);

      return;
    }

    if (parts.length === 1) issues.warn(p, `${text} has no published port; it is exposed on the same port`);

    for (let offset = 0; offset <= containerRange[1] - containerRange[0]; offset++) {
      out.push({ protocol: proto, publishedPort: publishedRange[0] + offset, targetPort: containerRange[0] + offset });
    }
  });

  return out;
}

function parseVolumeMounts(value: unknown, issues: Issues, path: string, pins: Pin[]): VolumeMount[] {
  if (value === undefined) return [];

  if (!Array.isArray(value)) {
    issues.error(path, 'volumes must be a list');

    return [];
  }

  const out: VolumeMount[] = [];

  value.forEach((entry, i) => {
    const p = `${path}[${i}]`;
    let mount: VolumeMount | null = null;

    if (isObj(entry)) {
      const type = entry['type'] ?? 'volume';
      const target = String(entry['target'] ?? '');
      const readOnly = entry['read_only'] === true;

      if (type === 'tmpfs') {
        const size = isObj(entry['tmpfs']) ? parseBytes(entry['tmpfs']['size']) : null;

        mount = { type: 'tmpfs', target, ...(size ? { sizeBytes: size } : {}) };
      } else if (type === 'bind' || type === 'volume') {
        mount = { type, source: String(entry['source'] ?? ''), target, readOnly };
      } else {
        issues.error(p, `unsupported volume type ${String(type)}`);
      }
    } else if (typeof entry === 'string') {
      const parts = entry.split(':');
      const readOnly = parts.length === 3 && parts[2].split(',').includes('ro');

      if (parts.length === 1) {
        issues.warn(p, `anonymous volume ${entry} is not replicated and is lost on migration; use a named volume`);
        mount = { type: 'tmpfs', target: parts[0] };
      } else {
        const source = parts[0];
        const isPath = source.startsWith('/') || source.startsWith('.') || source.startsWith('~');

        mount = { type: isPath ? 'bind' : 'volume', source, target: parts[1], readOnly };
      }
    } else {
      issues.error(p, 'invalid volume entry');
    }

    if (!mount) return;

    if (!mount.target.startsWith('/')) {
      issues.error(p, 'volume target must be an absolute path');

      return;
    }

    if (mount.type === 'bind' && !mount.source.startsWith('/')) {
      issues.error(
        p,
        `relative bind mount ${mount.source}: nodes have no compose directory; use an absolute host path or a volume`,
      );

      return;
    }

    if (mount.type === 'bind') {
      // Host paths only exist on one node: a data and deployment pin (3.11, 3.12).
      pins.push({
        kind: 'data',
        reason: DOCKER_SOCKETS.includes(mount.source)
          ? `bind mount of the Docker socket ${mount.source}: the service controls the node's Docker; containers it starts with its declared labels (loadweaver.com/delegates) are reported as delegated, not drift`
          : `bind mount of host path ${mount.source}`,
      });
    }

    out.push(mount);
  });

  return out;
}

function parseFileMounts(value: unknown, issues: Issues, path: string, kind: 'secrets' | 'configs'): FileMount[] {
  if (value === undefined) return [];

  if (!Array.isArray(value)) {
    issues.error(path, `${kind} must be a list`);

    return [];
  }

  return value.flatMap((entry, i) => {
    if (typeof entry === 'string')
      return [{ source: entry, target: kind === 'secrets' ? `/run/secrets/${entry}` : `/${entry}` }];

    if (isObj(entry) && typeof entry['source'] === 'string') {
      const target =
        typeof entry['target'] === 'string'
          ? entry['target']
          : kind === 'secrets'
            ? `/run/secrets/${entry['source']}`
            : `/${entry['source']}`;
      const mode = typeof entry['mode'] === 'number' ? entry['mode'] : undefined;

      return [
        {
          source: entry['source'],
          target: target.startsWith('/') ? target : `/run/secrets/${target}`,
          ...(mode !== undefined ? { mode } : {}),
        },
      ];
    }

    issues.error(`${path}[${i}]`, `invalid ${kind} entry`);

    return [];
  });
}

function parseHealthcheck(value: unknown, issues: Issues, path: string): HealthCheck | undefined {
  if (value === undefined) return undefined;

  if (!isObj(value)) {
    issues.error(path, 'healthcheck must be a map');

    return undefined;
  }

  const duration = (key: string, fallback: number) => {
    if (value[key] === undefined) return fallback;

    const ms = parseDuration(value[key]);

    if (ms === null) issues.error(`${path}.${key}`, 'invalid duration');

    return ms ?? fallback;
  };

  let test: string[] | null = null;

  if (value['disable'] === true) test = null;
  else if (typeof value['test'] === 'string') test = ['CMD-SHELL', value['test']];
  else if (Array.isArray(value['test'])) {
    const list = value['test'].map(String);

    test = list[0] === 'NONE' ? null : list;
  }

  return {
    test,
    intervalMs: duration('interval', 30_000),
    timeoutMs: duration('timeout', 30_000),
    retries: Number(value['retries'] ?? 3),
    startPeriodMs: duration('start_period', 0),
  };
}

function parseDependsOn(value: unknown, issues: Issues, path: string): ServiceSpec['dependsOn'] {
  if (value === undefined) return [];

  if (Array.isArray(value))
    return value.map((service) => ({ service: String(service), condition: 'started' as const }));

  if (isObj(value)) {
    return Object.entries(value).map(([service, cfg]) => {
      const raw = isObj(cfg) ? cfg['condition'] : undefined;
      const condition =
        raw === 'service_healthy' ? 'healthy' : raw === 'service_completed_successfully' ? 'completed' : 'started';

      return { service, condition };
    });
  }

  issues.error(path, 'depends_on must be a list or a map');

  return [];
}

function parseResources(
  deploy: Obj | undefined,
  defaults: ResourceAmount,
  issues: Issues,
  path: string,
): ServiceSpec['resources'] {
  const resources = deploy && isObj(deploy['resources']) ? deploy['resources'] : undefined;
  const reservations = resources && isObj(resources['reservations']) ? resources['reservations'] : undefined;
  const limitsRaw = resources && isObj(resources['limits']) ? resources['limits'] : undefined;
  const limits: Partial<ResourceAmount> = {};

  if (limitsRaw?.['cpus'] !== undefined) {
    const v = parseCpus(limitsRaw['cpus']);

    if (v === null) issues.error(`${path}.limits.cpus`, 'invalid cpus');
    else limits.cpuMillis = v;
  }

  if (limitsRaw?.['memory'] !== undefined) {
    const v = parseBytes(limitsRaw['memory']);

    if (v === null) issues.error(`${path}.limits.memory`, 'invalid memory');
    else limits.memoryBytes = v;
  }

  const cpu = reservations?.['cpus'] !== undefined ? parseCpus(reservations['cpus']) : null;
  const memory = reservations?.['memory'] !== undefined ? parseBytes(reservations['memory']) : null;

  if (reservations?.['cpus'] !== undefined && cpu === null) issues.error(`${path}.reservations.cpus`, 'invalid cpus');

  if (reservations?.['memory'] !== undefined && memory === null)
    issues.error(`${path}.reservations.memory`, 'invalid memory');

  // Requests fall back to the limit, then to the project default (3.11: every service has requests).
  const requests: ResourceAmount = {
    cpuMillis: cpu ?? limits.cpuMillis ?? defaults.cpuMillis,
    memoryBytes: memory ?? limits.memoryBytes ?? defaults.memoryBytes,
  };
  const fromCompose = (cpu ?? limits.cpuMillis) !== undefined && (memory ?? limits.memoryBytes) !== undefined;

  return { requests, limits, source: fromCompose ? 'compose' : 'project-default' };
}

function parseService(
  name: string,
  raw: unknown,
  options: ComposeParseOptions,
  issues: Issues,
  declaredNetworks: Set<string>,
): ServiceSpec | null {
  const path = `services.${name}`;

  if (!NAME.test(name)) issues.error(path, 'service names must be lowercase DNS-style names');

  if (!isObj(raw)) {
    issues.error(path, 'service must be a map');

    return null;
  }

  if (raw['build'] !== undefined && raw['image'] === undefined)
    issues.error(`${path}.build`, 'build is not supported; reference a pushed image');
  else if (raw['build'] !== undefined) issues.warn(`${path}.build`, 'build is ignored; the image is deployed');

  if (raw['env_file'] !== undefined)
    issues.error(`${path}.env_file`, 'env_file is not supported; use environment or secrets');

  for (const unsupported of [
    'extends',
    'links',
    'external_links',
    'volumes_from',
    'pid',
    'ipc',
    'cgroup_parent',
    'userns_mode',
  ]) {
    if (raw[unsupported] !== undefined) issues.error(`${path}.${unsupported}`, `${unsupported} is not supported`);
  }

  const image = typeof raw['image'] === 'string' ? raw['image'] : '';

  if (!image) issues.error(`${path}.image`, 'image is required');
  else {
    const ref = parseImageReference(image);

    if (!ref) issues.error(`${path}.image`, 'invalid image reference');
    // Private images belong to a project; a deployment never pulls another project's images (3.17, 3.22).
    else if (ref.host === PRIVATE_REGISTRY_HOST && !ref.repository.startsWith(`${options.project}/`)) {
      issues.error(
        `${path}.image`,
        `private images of this project are ${PRIVATE_REGISTRY_HOST}/${options.project}/<repository>`,
      );
    }
  }

  const ext = serviceExtensionSchema.safeParse(raw['x-loadweaver'] ?? {});

  if (!ext.success) {
    ext.error.issues.forEach((i) =>
      issues.error(`${path}.x-loadweaver${i.path.length ? `.${i.path.join('.')}` : ''}`, i.message),
    );

    return null;
  }

  const x = ext.data;
  const deploy = isObj(raw['deploy']) ? raw['deploy'] : undefined;
  const pins: Pin[] = [];
  const replicas = x.replicas ?? (typeof deploy?.['replicas'] === 'number' ? deploy['replicas'] : 1);
  const networks = Array.isArray(raw['networks'])
    ? raw['networks'].map(String)
    : isObj(raw['networks'])
      ? Object.keys(raw['networks'])
      : [DEFAULT_NETWORK];
  const aliases = isObj(raw['networks'])
    ? Object.values(raw['networks']).flatMap((n) =>
        isObj(n) && Array.isArray(n['aliases']) ? n['aliases'].map(String) : [],
      )
    : [];

  for (const network of networks) {
    if (network !== DEFAULT_NETWORK && !declaredNetworks.has(network))
      issues.error(`${path}.networks`, `undefined network ${network}`);
  }

  const networkMode = typeof raw['network_mode'] === 'string' ? raw['network_mode'] : undefined;

  if (networkMode === 'host')
    pins.push({ kind: 'deployment', reason: 'network_mode: host binds the service to one host network' });
  else if (networkMode && networkMode !== 'bridge')
    issues.error(`${path}.network_mode`, `network_mode ${networkMode} is not supported`);

  const devices = Array.isArray(raw['devices'])
    ? raw['devices'].map((d) => (isObj(d) ? String(d['source'] ?? '') : String(d)))
    : [];

  if (devices.length > 0) pins.push({ kind: 'deployment', reason: `device access (${devices.join(', ')})` });

  const containerName = typeof raw['container_name'] === 'string' ? raw['container_name'] : undefined;

  if (containerName) {
    if (replicas > 1 || (x.autoscale?.max ?? 1) > 1)
      issues.error(`${path}.container_name`, 'container_name prevents more than one replica');

    pins.push({ kind: 'deployment', reason: `fixed container_name ${containerName} collides during migration` });
  }

  if (x.placement?.selector?.names?.length === 1)
    pins.push({ kind: 'deployment', reason: `placement selector matches only node ${x.placement.selector.names[0]}` });

  if (
    (x.autoscale?.min ?? replicas) === 1 &&
    x.job === undefined &&
    x.cron === undefined &&
    (raw['ports'] !== undefined || x.exposure?.http)
  ) {
    // One exposed replica fails over by restart only; listed so the plan can show the short gap.
    issues.warn(path, 'one replica: traffic is interrupted while the service fails over');
  }

  const restartRaw =
    raw['restart'] ?? (deploy && isObj(deploy['restart_policy']) ? deploy['restart_policy']['condition'] : undefined);
  const restart =
    restartRaw === 'no' || restartRaw === 'none'
      ? 'no'
      : restartRaw === 'on-failure'
        ? 'on-failure'
        : restartRaw === 'unless-stopped'
          ? 'unless-stopped'
          : 'always';
  const timeoutMs = x.cron?.timeout !== undefined ? parseDuration(x.cron.timeout) : null;

  if (x.cron?.timeout !== undefined && timeoutMs === null)
    issues.error(`${path}.x-loadweaver.cron.timeout`, 'invalid duration');

  if (x.cron) {
    try {
      parseCron(x.cron.schedule);
    } catch (error) {
      issues.error(
        `${path}.x-loadweaver.cron.schedule`,
        error instanceof Error ? error.message : 'invalid cron schedule',
      );
    }

    if (!isValidTimeZone(x.cron.timezone))
      issues.error(`${path}.x-loadweaver.cron.timezone`, `unknown timezone ${x.cron.timezone}`);
  }

  const privileged = raw['privileged'] === true;

  if (privileged) issues.warn(`${path}.privileged`, 'privileged containers have full access to the host');

  // Without these a workload can't send with another workload's address (and so its identity, 3.7).
  const spoofing = (Array.isArray(raw['cap_add']) ? raw['cap_add'].map(String) : []).filter((c) =>
    ['NET_RAW', 'NET_ADMIN', 'ALL'].includes(c.toUpperCase().replace(/^CAP_/, '')),
  );

  if (spoofing.length > 0)
    issues.warn(
      `${path}.cap_add`,
      `${spoofing.join(', ')} lets the service send with other workloads' addresses on its node (their policies and identities)`,
    );

  const ulimits: ServiceSpec['ulimits'] = {};

  if (isObj(raw['ulimits'])) {
    for (const [key, v] of Object.entries(raw['ulimits'])) {
      ulimits[key] =
        typeof v === 'number'
          ? { soft: v, hard: v }
          : isObj(v)
            ? { soft: Number(v['soft']), hard: Number(v['hard']) }
            : { soft: 0, hard: 0 };
    }
  }

  const stopGrace = raw['stop_grace_period'] !== undefined ? parseDuration(raw['stop_grace_period']) : 10_000;

  if (stopGrace === null) issues.error(`${path}.stop_grace_period`, 'invalid duration');

  const service: ServiceSpec = {
    name,
    image,
    command: stringList(raw['command'], issues, `${path}.command`),
    entrypoint: stringList(raw['entrypoint'], issues, `${path}.entrypoint`),
    environment: keyValues(raw['environment'], issues, `${path}.environment`),
    labels: keyValues(raw['labels'], issues, `${path}.labels`),
    ...(typeof raw['user'] === 'string' || typeof raw['user'] === 'number' ? { user: String(raw['user']) } : {}),
    ...(typeof raw['working_dir'] === 'string' ? { workingDir: raw['working_dir'] } : {}),
    ...(typeof raw['hostname'] === 'string' ? { hostname: raw['hostname'] } : {}),
    replicas,
    resources: parseResources(deploy, options.defaultRequests, issues, `${path}.deploy.resources`),
    healthcheck: parseHealthcheck(raw['healthcheck'], issues, `${path}.healthcheck`),
    dependsOn: parseDependsOn(raw['depends_on'], issues, `${path}.depends_on`),
    volumes: parseVolumeMounts(raw['volumes'], issues, `${path}.volumes`, pins),
    secrets: parseFileMounts(raw['secrets'], issues, `${path}.secrets`, 'secrets'),
    configs: parseFileMounts(raw['configs'], issues, `${path}.configs`, 'configs'),
    networks,
    groups: x.groups ?? [],
    aliases,
    ports: parsePorts(raw['ports'], issues, `${path}.ports`),
    http: (x.exposure?.http ?? []).map((h) => ({
      host: h.host.toLowerCase(),
      port: h.port,
      path: h.path ?? '/',
      ...(h.rateLimit
        ? {
            rateLimit: {
              ...(h.rateLimit.perIp ? { perIp: parseRate(h.rateLimit.perIp) } : {}),
              ...(h.rateLimit.perKey
                ? {
                    perKey: {
                      header: h.rateLimit.perKey.header.toLowerCase(),
                      rate: parseRate(h.rateLimit.perKey.rate),
                    },
                  }
                : {}),
              ...(h.rateLimit.total ? { total: parseRate(h.rateLimit.total) } : {}),
            },
          }
        : {}),
      ...(h.waf ? { waf: h.waf } : {}),
    })),
    runtime: x.runtime ?? (raw['runtime'] === 'runsc' ? 'sandboxed' : 'runc'),
    ...(x.placement?.selector ? { placement: x.placement.selector } : {}),
    spread: x.placement?.spread ?? 'node',
    kind: x.cron ? 'cron' : x.job ? 'job' : 'service',
    ...(x.job ? { jobPhase: x.job.phase } : {}),
    ...(x.cron
      ? {
          cron: {
            schedule: x.cron.schedule,
            timezone: x.cron.timezone,
            concurrency: x.cron.concurrency,
            retries: x.cron.retries,
            timeoutSeconds: Math.round((timeoutMs ?? 3_600_000) / 1000),
          },
        }
      : {}),
    ...(x.autoscale ? { autoscale: x.autoscale } : {}),
    ...(x.slo ? { slo: x.slo } : {}),
    liveMigration: x.liveMigration ?? true,
    ...(x.backup ? { backup: backupHooks(x.backup, `${path}.x-loadweaver.backup`, issues) } : {}),
    restart,
    capAdd: Array.isArray(raw['cap_add']) ? raw['cap_add'].map(String) : [],
    capDrop: Array.isArray(raw['cap_drop']) ? raw['cap_drop'].map(String) : [],
    readOnly: raw['read_only'] === true,
    privileged,
    init: raw['init'] === true,
    ...(networkMode ? { networkMode } : {}),
    devices,
    ...(containerName ? { containerName } : {}),
    stopGracePeriodMs: stopGrace ?? 10_000,
    ...(typeof raw['stop_signal'] === 'string' ? { stopSignal: raw['stop_signal'] } : {}),
    extraHosts: Array.isArray(raw['extra_hosts']) ? raw['extra_hosts'].map(String) : [],
    ulimits,
    pins,
    ...(x.pinned ? { pinAcknowledgement: x.pinned.reason } : {}),
  };

  // A read-write volume has one writer, so its service runs a single replica (3.5): nothing to scale.
  if (x.autoscale && service.volumes.some((m) => m.type === 'volume' && !m.readOnly))
    issues.error(
      `${path}.x-loadweaver.autoscale`,
      'services with read-write volumes run a single replica and cannot be autoscaled',
    );

  return service;
}

function backupHooks(
  backup: NonNullable<ServiceExtension['backup']>,
  path: string,
  issues: Issues,
): NonNullable<ServiceSpec['backup']> {
  const seconds = (value: string | undefined, field: string, fallback: number): number => {
    if (value === undefined) return fallback;

    const ms = parseDuration(value);

    if (ms === null) {
      issues.error(`${path}.${field}`, 'invalid duration');

      return fallback;
    }

    return Math.max(1, Math.min(3600, Math.round(ms / 1000)));
  };

  return {
    ...(backup.hooks?.pre ? { pre: backup.hooks.pre } : {}),
    ...(backup.hooks?.post ? { post: backup.hooks.post } : {}),
    timeoutSeconds: seconds(backup.hooks?.timeout, 'hooks.timeout', 300),
    ...(backup.check
      ? {
          check: { command: backup.check.command, timeoutSeconds: seconds(backup.check.timeout, 'check.timeout', 600) },
        }
      : {}),
  };
}

function parseVolumes(raw: unknown, options: ComposeParseOptions, issues: Issues): VolumeSpec[] {
  if (raw === undefined || raw === null) return [];

  if (!isObj(raw)) {
    issues.error('volumes', 'volumes must be a map');

    return [];
  }

  return Object.entries(raw).flatMap(([name, cfg]) => {
    const path = `volumes.${name}`;

    if (!NAME.test(name)) issues.error(path, 'volume names must be lowercase DNS-style names');

    const config = isObj(cfg) ? cfg : {};

    if (config['driver'] !== undefined && config['driver'] !== 'local' && config['driver'] !== 'loadweaver') {
      issues.error(`${path}.driver`, 'volumes always use the replicated Loadweaver driver');
    }

    const ext = volumeExtensionSchema.safeParse(config['x-loadweaver'] ?? {});

    if (!ext.success) {
      ext.error.issues.forEach((i) => issues.error(`${path}.x-loadweaver.${i.path.join('.')}`, i.message));

      return [];
    }

    const size =
      ext.data.size !== undefined ? parseBytes(ext.data.size) : (options.defaultVolumeSizeBytes ?? 10 * 1024 ** 3);

    if (size === null) issues.error(`${path}.x-loadweaver.size`, 'invalid size');

    const replicas = ext.data.replicas ?? 2;
    const pins: Pin[] =
      replicas < 2 && ext.data.crossSite === 'none'
        ? [{ kind: 'data', reason: `volume ${name} has no replica outside its node` }]
        : [];

    return [
      {
        name,
        external: config['external'] === true,
        sizeBytes: size ?? 0,
        replicas,
        crossSite: ext.data.crossSite ?? 'async',
        pins,
        ...(ext.data.pinned ? { pinAcknowledgement: ext.data.pinned.reason } : {}),
      },
    ];
  });
}

function parseSecretDefs(
  raw: unknown,
  kind: 'secrets' | 'configs',
  options: ComposeParseOptions,
  issues: Issues,
): ComposeDeployment['secrets'] {
  if (raw === undefined || raw === null) return [];

  if (!isObj(raw)) {
    issues.error(kind, `${kind} must be a map`);

    return [];
  }

  return Object.entries(raw).flatMap(([name, cfg]) => {
    const path = `${kind}.${name}`;
    const config = isObj(cfg) ? cfg : {};

    if (config['file'] !== undefined || config['environment'] !== undefined || config['content'] !== undefined) {
      // Values never live in the compose file (3.29); they are stored in the control plane.
      issues.error(path, `${kind} must be external references (secret://...), not file / environment / content`);

      return [];
    }

    const ref =
      typeof config['x-loadweaver-ref'] === 'string'
        ? config['x-loadweaver-ref']
        : `secret://${options.project}/${typeof config['name'] === 'string' ? config['name'] : name}`;

    if (!/^secret:\/\/[a-z0-9-]+\/[a-z0-9][a-z0-9._-]*(@\d+)?$/.test(ref)) {
      issues.error(path, 'invalid secret reference');

      return [];
    }

    return [{ name, ref }];
  });
}

/**
 * Parses a compose file (with `x-loadweaver` extensions) into a deployment (3.11). The file stays valid for plain
 * `docker compose`. Nothing on the machine running the parser is read: no env files, no environment variables.
 */
export function parseCompose(text: string, options: ComposeParseOptions): ComposeParseResult {
  const issues = new Issues();

  if (new TextEncoder().encode(text).length > MAX_COMPOSE_BYTES) {
    return {
      ok: false,
      issues: [{ level: 'error', path: '', message: `compose file exceeds ${MAX_COMPOSE_BYTES} bytes` }],
    };
  }

  const doc = parseDocument(text, { merge: true, uniqueKeys: true, prettyErrors: true });

  if (doc.errors.length > 0) {
    return {
      ok: false,
      issues: doc.errors.map((e) => ({ level: 'error' as const, path: '', message: e.message.split('\n')[0] })),
    };
  }

  let rawTree: unknown;

  try {
    rawTree = doc.toJS({ maxAliasCount: 100 });
  } catch (error) {
    return {
      ok: false,
      issues: [{ level: 'error', path: '', message: error instanceof Error ? error.message : 'invalid YAML' }],
    };
  }

  const tree = interpolateTree(rawTree, options.variables ?? {}, issues, '');

  if (!isObj(tree)) return { ok: false, issues: [{ level: 'error', path: '', message: 'compose file must be a map' }] };

  if (!isObj(tree['services']) || Object.keys(tree['services']).length === 0)
    issues.error('services', 'at least one service is required');

  const networksRaw = isObj(tree['networks']) ? tree['networks'] : {};
  const networks = Object.entries(networksRaw).map(([name, cfg]) => ({
    name,
    external: isObj(cfg) && cfg['external'] === true,
  }));
  const declared = new Set(networks.map((n) => n.name));
  const services = Object.entries(isObj(tree['services']) ? tree['services'] : {})
    .map(([name, raw]) => parseService(name, raw, options, issues, declared))
    .filter((s): s is ServiceSpec => s !== null);
  const volumes = parseVolumes(tree['volumes'], options, issues);
  const secrets = parseSecretDefs(tree['secrets'], 'secrets', options, issues);
  const configs = parseSecretDefs(tree['configs'], 'configs', options, issues);
  const serviceNames = new Set(services.map((s) => s.name));
  const volumeNames = new Set(volumes.map((v) => v.name));

  for (const service of services) {
    for (const dep of service.dependsOn) {
      if (!serviceNames.has(dep.service))
        issues.error(`services.${service.name}.depends_on`, `unknown service ${dep.service}`);
    }

    for (const mount of service.volumes) {
      if (mount.type === 'volume' && !volumeNames.has(mount.source))
        issues.error(`services.${service.name}.volumes`, `undefined volume ${mount.source}`);
    }

    for (const s of service.secrets) {
      if (!secrets.some((d) => d.name === s.source))
        issues.error(`services.${service.name}.secrets`, `undefined secret ${s.source}`);
    }

    for (const c of service.configs) {
      if (!configs.some((d) => d.name === c.source))
        issues.error(`services.${service.name}.configs`, `undefined config ${c.source}`);
    }

    if (service.resources.source === 'project-default')
      issues.warn(`services.${service.name}.deploy.resources`, 'no resource requests; the project defaults apply');

    service.pins
      .filter(() => !service.pinAcknowledgement)
      .forEach((pin) => issues.warn(`services.${service.name}`, `unacknowledged ${pin.kind} pin: ${pin.reason}`));
  }

  detectDependencyCycles(services, issues);

  if (issues.hasErrors) return { ok: false, issues: issues.list };

  const usedNetworks = new Set(services.flatMap((s) => s.networks));

  return {
    ok: true,
    deployment: {
      name: options.name,
      services,
      volumes,
      networks: [
        ...(usedNetworks.has(DEFAULT_NETWORK) && !declared.has(DEFAULT_NETWORK)
          ? [{ name: DEFAULT_NETWORK, external: false }]
          : []),
        ...networks,
      ],
      secrets,
      configs,
    },
    warnings: issues.list,
  };
}

function detectDependencyCycles(services: ServiceSpec[], issues: Issues): void {
  const deps = new Map(services.map((s) => [s.name, s.dependsOn.map((d) => d.service)]));
  const state = new Map<string, 'visiting' | 'done'>();

  const visit = (name: string, trail: string[]): void => {
    if (state.get(name) === 'done') return;

    if (state.get(name) === 'visiting') {
      issues.error(`services.${name}.depends_on`, `dependency cycle: ${[...trail, name].join(' → ')}`);

      return;
    }

    state.set(name, 'visiting');
    (deps.get(name) ?? []).forEach((d) => visit(d, [...trail, name]));
    state.set(name, 'done');
  };

  services.forEach((s) => visit(s.name, []));
}

/** Start order (3.10: dependency order gates start, migration and failover): dependencies first. */
export function startOrder(deployment: ComposeDeployment): string[][] {
  const remaining = new Map(deployment.services.map((s) => [s.name, new Set(s.dependsOn.map((d) => d.service))]));
  const waves: string[][] = [];

  while (remaining.size > 0) {
    const ready = [...remaining.entries()]
      .filter(([, d]) => [...d].every((x) => !remaining.has(x)))
      .map(([n]) => n)
      .sort();

    if (ready.length === 0) throw new Error('dependency cycle');

    ready.forEach((n) => remaining.delete(n));
    waves.push(ready);
  }

  return waves;
}
