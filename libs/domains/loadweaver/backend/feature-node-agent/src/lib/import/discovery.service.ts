import { readdir, readFile, stat } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, isAbsolute, join, resolve } from 'node:path';

import {
  DISCOVERY_REPORT_VERSION,
  discoveryReportSchema,
  redactCompose,
  type DiscoveredComposeProject,
  type DiscoveredContainer,
  type DiscoveredDrbdResource,
  type DiscoveredInterface,
  type DiscoveredMount,
  type DiscoveredNetwork,
  type DiscoveredRoute,
  type DiscoveredVolume,
  type DiscoveryReport,
  type FormerInstallation,
} from '@forepath/loadweaver/shared/util-agent-protocol';
import { Inject, Injectable } from '@nestjs/common';
import type Docker from 'dockerode';

import { CommandRunner } from '../host/command-runner';
import { DOCKER } from '../host/docker.provider';
import { MANAGED_LABEL } from '../host/managed-containers';
import { stateDir } from '../state/agent-state.store';
import { storageConfig } from '../volumes/volume.manager';
import {
  LOADWEAVER_INTERFACE,
  detectVpns,
  parseDrbdResource,
  parseDrbdStatus,
  parseEnvFile,
  parseIpAddresses,
  parseIpRoutes,
  parseLvs,
  parseNftTables,
  parseSsListeners,
  parseWgListenPorts,
  reportedLabels,
} from './discovery.parsers';

/** Compose file contents reported at most (all projects together); the join request is limited to 3 MB. */
const CONTENT_BUDGET = 1_536 * 1024;
const MAX_FILE_BYTES = 256 * 1024;
/** Where `join --discover` archives the identity of a former installation (`former-<cluster id>`). */
export const FORMER_PREFIX = 'former-';

export interface DiscoverOptions {
  /** The state directory holds this agent's own (pending) identity: only archived former identities count. */
  ownIdentity?: boolean;
}

function message(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split('\n')[0].slice(0, 300);
}

/**
 * Read-only discovery of a host before it joins (3.21): what runs (compose projects with their files and `.env`,
 * containers, volumes with sizes, networks), what the host uses (listeners, interfaces, routes, VPN interfaces,
 * nftables tables) and what a former Loadweaver installation left (state directory, DRBD resources, `lw-*`
 * interfaces, tables, managed containers). Only reads: Docker's API (list / inspect / disk usage), `ss`, `ip -j`,
 * `wg show`, `nft -j list tables`, `lvs`, `drbdsetup status` and files. Secrets stay on the host: compose files are
 * redacted (`redactCompose`), sensitive `.env` values are left out, labels other than compose's are not reported.
 */
@Injectable()
export class DiscoveryService {
  constructor(
    private readonly commands: CommandRunner,
    @Inject(DOCKER) private readonly docker: Docker,
  ) {}

  async discover(options: DiscoverOptions = {}): Promise<DiscoveryReport> {
    const warnings: string[] = [];
    const tryRun = async <T>(what: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
      try {
        return await fn();
      } catch (error) {
        warnings.push(`${what}: ${message(error)}`);

        return fallback;
      }
    };

    const docker = await tryRun(
      'docker',
      async () => ({ available: true, version: String((await this.docker.version()).Version ?? '').slice(0, 64) }),
      { available: false } as { available: boolean; version?: string },
    );
    const containers = docker.available ? await tryRun('docker containers', () => this.containers(), []) : [];
    const volumes = docker.available ? await tryRun('docker volumes', () => this.volumes(containers), []) : [];
    const networks = docker.available ? await tryRun('docker networks', () => this.networks(), []) : [];
    const composeProjects = await tryRun('compose projects', () => this.composeProjects(containers, warnings), []);
    const listeners = await tryRun(
      'listeners (ss)',
      async () => parseSsListeners((await this.commands.run('ss', ['-H', '-l', '-t', '-u', '-n', '-p'])).stdout),
      [],
    );
    const interfaces = await tryRun(
      'interfaces (ip)',
      async () => parseIpAddresses(await this.commands.json('ip', ['-j', '-d', 'addr', 'show'])),
      [] as DiscoveredInterface[],
    );
    const routes: DiscoveredRoute[] = [
      ...(await tryRun(
        'routes (ip -4)',
        async () =>
          parseIpRoutes(await this.commands.json('ip', ['-j', '-4', 'route', 'show', 'table', 'all']), 'inet'),
        [],
      )),
      ...(await tryRun(
        'routes (ip -6)',
        async () =>
          parseIpRoutes(await this.commands.json('ip', ['-j', '-6', 'route', 'show', 'table', 'all']), 'inet6'),
        [],
      )),
    ];
    const wgPorts = interfaces.some((i) => i.kind === 'wireguard')
      ? await tryRun(
          'wireguard (wg)',
          async () => parseWgListenPorts((await this.commands.run('wg', ['show', 'all', 'listen-port'])).stdout),
          new Map<string, number>(),
        )
      : new Map<string, number>();
    const nftables = await tryRun(
      'nftables (nft)',
      async () => parseNftTables(await this.commands.json('nft', ['-j', 'list', 'tables'])),
      [],
    );
    const former = await tryRun(
      'former installation',
      () => this.former(interfaces, nftables, containers, options, warnings),
      null,
    );

    return discoveryReportSchema.parse({
      version: DISCOVERY_REPORT_VERSION,
      at: new Date().toISOString(),
      hostname: hostname().slice(0, 64),
      docker,
      composeProjects: composeProjects.slice(0, 256),
      containers: containers.slice(0, 1024),
      volumes: volumes.slice(0, 1024),
      networks: networks.slice(0, 256),
      listeners: listeners.slice(0, 4096),
      interfaces: interfaces.slice(0, 4096),
      routes: routes.slice(0, 16_384),
      vpns: detectVpns(interfaces, wgPorts),
      nftables: nftables.slice(0, 1024),
      former,
      warnings: warnings.slice(0, 256).map((w) => w.slice(0, 1024)),
    });
  }

  private async containers(): Promise<DiscoveredContainer[]> {
    const list = await this.docker.listContainers({ all: true });
    const result: DiscoveredContainer[] = [];

    for (const summary of list) {
      const info = await this.docker.getContainer(summary.Id).inspect();
      const labels = info.Config?.Labels ?? {};
      const ports = Object.entries(
        Object.keys(info.NetworkSettings?.Ports ?? {}).length
          ? info.NetworkSettings.Ports
          : (info.HostConfig?.PortBindings ?? {}),
      ).flatMap(([key, bindings]) => {
        const [port, protocol] = key.split('/');

        return ((bindings as { HostIp?: string; HostPort?: string }[] | null) ?? []).map((b) => ({
          protocol: (protocol === 'udp' || protocol === 'sctp' ? protocol : 'tcp') as 'tcp' | 'udp' | 'sctp',
          hostIp: (b.HostIp || '0.0.0.0').slice(0, 64),
          hostPort: Number(b.HostPort || 0),
          containerPort: Number(port),
        }));
      });
      const mounts: DiscoveredMount[] = [];

      for (const m of info.Mounts ?? []) {
        const type = m.Type === 'volume' || m.Type === 'bind' || m.Type === 'tmpfs' ? m.Type : 'other';
        const directory =
          type === 'bind'
            ? await stat(m.Source).then(
                (s) => s.isDirectory(),
                () => undefined,
              )
            : undefined;

        mounts.push({
          type,
          ...(m.Name ? { name: m.Name.slice(0, 256) } : {}),
          source: (m.Source ?? '').slice(0, 4096),
          destination: (m.Destination ?? '').slice(0, 4096),
          readOnly: m.RW === false,
          ...(directory !== undefined ? { directory } : {}),
        });
      }

      const project = labels['com.docker.compose.project'];
      const service = labels['com.docker.compose.service'];
      const number = Number(labels['com.docker.compose.container-number']);

      result.push({
        id: info.Id,
        name: (info.Name ?? summary.Names?.[0] ?? info.Id).replace(/^\//, '').slice(0, 256),
        image: (info.Config?.Image ?? summary.Image).slice(0, 512),
        state: (info.State?.Status ?? summary.State ?? 'unknown').slice(0, 32),
        ...(info.HostConfig?.RestartPolicy?.Name
          ? { restartPolicy: info.HostConfig.RestartPolicy.Name.slice(0, 32) }
          : {}),
        ports: ports.filter((p) => Number.isInteger(p.containerPort)).slice(0, 1024),
        mounts: mounts.slice(0, 256),
        networks: Object.keys(info.NetworkSettings?.Networks ?? {})
          .slice(0, 64)
          .map((n) => n.slice(0, 256)),
        ...(info.HostConfig?.NetworkMode ? { networkMode: info.HostConfig.NetworkMode.slice(0, 256) } : {}),
        ...(info.HostConfig?.Privileged ? { privileged: true } : {}),
        labels: reportedLabels(labels),
        ...(project && service
          ? {
              compose: {
                project: project.slice(0, 256),
                service: service.slice(0, 256),
                ...(Number.isInteger(number) && number >= 0 ? { number } : {}),
              },
            }
          : {}),
        managed: labels[MANAGED_LABEL] === 'true',
      });
    }

    return result;
  }

  private async volumes(containers: DiscoveredContainer[]): Promise<DiscoveredVolume[]> {
    // Disk usage has the sizes; plain listing if it fails (old daemons, permissions).
    const df = (await this.docker.df().catch(() => null)) as {
      Volumes?: {
        Name: string;
        Driver: string;
        Mountpoint: string;
        Labels?: Record<string, string> | null;
        UsageData?: { Size?: number } | null;
      }[];
    } | null;
    const list =
      df?.Volumes ??
      ((await this.docker.listVolumes()).Volumes ?? []).map((v) => ({
        Name: v.Name,
        Driver: v.Driver,
        Mountpoint: v.Mountpoint,
        Labels: v.Labels,
        UsageData: null,
      }));

    return list.map((v) => {
      const labels = v.Labels ?? {};
      const project = labels['com.docker.compose.project'];
      const volume = labels['com.docker.compose.volume'];
      const size = v.UsageData?.Size;

      return {
        name: v.Name.slice(0, 256),
        driver: (v.Driver || 'local').slice(0, 256),
        mountpoint: (v.Mountpoint ?? '').slice(0, 4096),
        sizeBytes: typeof size === 'number' && size >= 0 ? size : null,
        ...(project && volume ? { compose: { project: project.slice(0, 256), volume: volume.slice(0, 256) } } : {}),
        usedBy: containers
          .filter((c) => c.mounts.some((m) => m.type === 'volume' && m.name === v.Name))
          .map((c) => c.id),
      };
    });
  }

  private async networks(): Promise<DiscoveredNetwork[]> {
    const list = await this.docker.listNetworks();

    return list.map((n) => {
      const labels = n.Labels ?? {};
      const project = labels['com.docker.compose.project'];
      const network = labels['com.docker.compose.network'];

      return {
        name: n.Name.slice(0, 256),
        driver: (n.Driver ?? '').slice(0, 256),
        subnets: (n.IPAM?.Config ?? [])
          .map((c) => c.Subnet)
          .filter((s): s is string => !!s)
          .slice(0, 16),
        ...(project && network ? { compose: { project: project.slice(0, 256), network: network.slice(0, 256) } } : {}),
      };
    });
  }

  private async composeProjects(
    containers: DiscoveredContainer[],
    warnings: string[],
  ): Promise<DiscoveredComposeProject[]> {
    const byProject = new Map<string, DiscoveredContainer[]>();

    for (const c of containers)
      if (c.compose) byProject.set(c.compose.project, [...(byProject.get(c.compose.project) ?? []), c]);

    let budget = CONTENT_BUDGET;
    const projects: DiscoveredComposeProject[] = [];

    for (const [name, members] of [...byProject.entries()].sort(([a], [b]) => a.localeCompare(b))) {
      const labels = members[0].labels;
      const workingDir = labels['com.docker.compose.project.working_dir'];
      const files = (labels['com.docker.compose.project.config_files'] ?? '')
        .split(',')
        .map((f) => f.trim())
        .filter(Boolean)
        .map((f) => (isAbsolute(f) || !workingDir ? f : resolve(workingDir, f)))
        .slice(0, 16);
      const configFiles: DiscoveredComposeProject['configFiles'] = [];

      for (const path of files) {
        try {
          if (!isAbsolute(path)) throw new Error('not an absolute path');

          const info = await stat(path);

          if (info.size > MAX_FILE_BYTES || info.size > budget) {
            configFiles.push({ path, error: 'too large to report' });
            continue;
          }

          const redacted = redactCompose(await readFile(path, 'utf8'));

          if (!redacted) {
            configFiles.push({ path, error: 'not valid YAML; not reported' });
            continue;
          }

          budget -= Buffer.byteLength(redacted.content);
          configFiles.push({
            path,
            content: redacted.content,
            ...(redacted.redacted.length ? { redacted: redacted.redacted.slice(0, 1024) } : {}),
          });
        } catch (error) {
          configFiles.push({ path, error: message(error) });
        }
      }

      const envPath =
        labels['com.docker.compose.project.environment_file'] ??
        (workingDir ? join(workingDir, '.env') : files[0] ? join(dirname(files[0]), '.env') : undefined);
      let envFile: DiscoveredComposeProject['envFile'];

      if (envPath && isAbsolute(envPath)) {
        try {
          const info = await stat(envPath);

          envFile =
            info.size > MAX_FILE_BYTES
              ? { path: envPath, variables: [], error: 'too large to report' }
              : { path: envPath, variables: parseEnvFile(await readFile(envPath, 'utf8')) };
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== 'ENOENT')
            envFile = { path: envPath, variables: [], error: message(error) };
        }
      }

      if (!files.length) warnings.push(`compose project ${name}: no config files in its labels`);

      projects.push({
        name: name.slice(0, 256),
        ...(workingDir ? { workingDir: workingDir.slice(0, 4096) } : {}),
        configFiles,
        ...(envFile ? { envFile } : {}),
        services: [...new Set(members.map((m) => m.compose?.service ?? ''))].filter(Boolean).sort(),
        containers: members.map((m) => m.id),
      });
    }

    return projects;
  }

  private async former(
    interfaces: DiscoveredInterface[],
    nftables: { family: string; name: string }[],
    containers: DiscoveredContainer[],
    options: DiscoverOptions,
    warnings: string[],
  ): Promise<FormerInstallation | null> {
    const dir = stateDir();
    const entries = await readdir(dir).catch(() => [] as string[]);
    const archived = entries.filter((e) => e.startsWith(FORMER_PREFIX)).sort();
    const identityFile = archived.length
      ? join(dir, archived[archived.length - 1], 'identity.json')
      : options.ownIdentity
        ? null
        : join(dir, 'identity.json');
    const identity = identityFile
      ? ((await readFile(identityFile, 'utf8')
          .then((t) => JSON.parse(t) as { clusterId?: string; nodeName?: string })
          .catch(() => null)) as { clusterId?: string; nodeName?: string } | null)
      : null;
    const config = storageConfig();
    const resFiles = (await readdir(config.drbdConfigDir).catch(() => [] as string[])).filter((f) =>
      /^lw-\d{1,6}\.res$/.test(f),
    );
    const drbdResources: DiscoveredDrbdResource[] = [];

    if (resFiles.length) {
      const lvs = await this.commands
        .json('lvs', [
          '--reportformat',
          'json',
          '-o',
          'lv_name,lv_size',
          '--units',
          'b',
          '--nosuffix',
          config.volumeGroup,
        ])
        .then(parseLvs)
        .catch((error: unknown) => {
          warnings.push(`lvs: ${message(error)}`);

          return new Map<string, number>();
        });
      const status = await this.commands
        .json('drbdsetup', ['status', '--json'])
        .then(parseDrbdStatus)
        .catch(() => new Map<string, { role?: string; diskState?: string }>());

      for (const file of resFiles.sort()) {
        const parsed = parseDrbdResource(
          file,
          await readFile(join(config.drbdConfigDir, file), 'utf8').catch(() => ''),
        );

        if (!parsed) continue;

        const size = lvs.get(parsed.name);

        drbdResources.push({
          ...parsed,
          backingDevice: size !== undefined,
          ...(size !== undefined ? { sizeBytes: size } : {}),
          ...(status.get(parsed.name) ?? {}),
        });
      }
    }

    const lwInterfaces = interfaces.filter((i) => LOADWEAVER_INTERFACE.test(i.name)).map((i) => i.name);
    const lwTables = nftables
      .filter((t) => t.name === 'loadweaver' || t.name.startsWith('lw_'))
      .map((t) => `${t.family} ${t.name}`);
    const managedContainers = containers.filter((c) => c.managed).length;

    if (!identity && !drbdResources.length && !lwInterfaces.length && !lwTables.length && !managedContainers)
      return null;

    return {
      stateDir: !!identity,
      ...(identity?.clusterId ? { clusterId: identity.clusterId.slice(0, 64) } : {}),
      ...(identity?.nodeName ? { nodeName: identity.nodeName.slice(0, 63) } : {}),
      drbdResources,
      interfaces: lwInterfaces,
      nftTables: lwTables,
      managedContainers,
    };
  }
}
