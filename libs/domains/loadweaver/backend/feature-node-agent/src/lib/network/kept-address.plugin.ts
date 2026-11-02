import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { dirname, join } from 'node:path';

import { Inject, Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import type Docker from 'dockerode';

import { CommandRunner } from '../host/command-runner';
import { DOCKER } from '../host/docker.provider';
import { stateDir } from '../state/agent-state.store';

/**
 * Kept addresses (3.10): a live-migrated replica keeps its address, which belongs to another node's pod subnet. The
 * node's pod bridge only covers its own subnet, so such replicas attach to `loadweaver-kept`, served by this agent as
 * a Docker network + IPAM plugin: the IPAM hands out exactly the requested address as a /32 (/128) from the cluster
 * pod supernet (any address, the control plane reserved it), the network driver gives the container a routed veth
 * (`lwk…`, Calico style): the container's default route points to a link-local gateway the host side owns, and the
 * host routes the address to the veth (the local half of the host route BIRD originates from `hostRoutes`).
 * Anti-spoofing per veth lives in its own table (`lw_kept`); the Loadweaver table treats `lwk*` as managed.
 */

export const KEPT_DRIVER = 'loadweaver-kept';
export const KEPT_INTERFACE_PREFIX = 'lwk';
export const KEPT_TABLE = 'lw_kept';
/** Link-local gateways the host side of every kept veth owns. */
export const KEPT_GATEWAY_V4 = '169.254.1.1';
export const KEPT_GATEWAY_V6 = 'fe80::1';
/**
 * Endpoint driver option with a full VM's further NIC's real addresses (comma-separated): its container side carries
 * a link-local placeholder (`extraNicCarrierV4`), the routes and anti-spoofing are for these.
 */
export const KEPT_NIC_ADDRESSES_OPTION = 'loadweaver.com/nic-addresses';

export function keptPluginSocketPath(env: NodeJS.ProcessEnv = process.env): string {
  return env['LOADWEAVER_KEPT_PLUGIN_SOCKET'] || `/run/docker/plugins/${KEPT_DRIVER}.sock`;
}

/**
 * One network per address family mix (Docker requests an address of every enabled family). A container can only
 * have one endpoint per network: further NICs of a full VM (3.35, `slot` ≥ 1) get a network of their own each.
 */
export function keptNetworkName(addresses: readonly string[], slot = 0): string {
  const v4 = addresses.some((a) => !a.includes(':'));
  const v6 = addresses.some((a) => a.includes(':'));

  return `${KEPT_DRIVER}-${v4 ? '4' : ''}${v6 ? '6' : ''}${slot > 0 ? `-nic${slot}` : ''}`;
}

/** Host-side veth name of an endpoint (≤ 15 characters); the container side adds `c` before Docker renames it. */
export function keptInterface(endpointId: string): string {
  return `${KEPT_INTERFACE_PREFIX}${createHash('sha256').update(endpointId).digest('hex').slice(0, 10)}`;
}

interface Endpoint {
  id: string;
  v4?: string;
  v6?: string;
}

/** The anti-spoofing table: each kept veth may only send with its own addresses. */
export function renderKeptTable(endpoints: readonly Endpoint[]): string {
  const rules = endpoints.flatMap((e) => {
    const name = keptInterface(e.id);

    return [
      e.v4
        ? `    iifname "${name}" meta nfproto ipv4 ip saddr != ${e.v4} counter drop`
        : `    iifname "${name}" meta nfproto ipv4 counter drop`,
      e.v6
        ? `    iifname "${name}" meta nfproto ipv6 ip6 saddr != { ${e.v6}, fe80::/10, ::/128 } counter drop`
        : `    iifname "${name}" meta nfproto ipv6 ip6 saddr != { fe80::/10, ::/128 } counter drop`,
    ];
  });

  return [
    `table inet ${KEPT_TABLE}`,
    `delete table inet ${KEPT_TABLE}`,
    `table inet ${KEPT_TABLE} {`,
    '  chain prerouting {',
    '    type filter hook prerouting priority raw; policy accept;',
    ...rules,
    '  }',
    '}',
    '',
  ].join('\n');
}

const MAX_BODY_BYTES = 64 * 1024;

type Handler = (body: Record<string, unknown>) => Promise<Record<string, unknown>>;

const strip = (address: unknown): string | undefined =>
  typeof address === 'string' && address ? address.split('/')[0] : undefined;

@Injectable()
export class KeptAddressPlugin implements OnModuleDestroy {
  private readonly logger = new Logger(KeptAddressPlugin.name);
  private server: Server | null = null;
  private endpoints = new Map<string, Endpoint>();
  private readonly file = join(stateDir(), 'kept-endpoints.json');
  private persisting: Promise<unknown> = Promise.resolve();
  private writes = 0;

  constructor(
    private readonly commands: CommandRunner,
    @Inject(DOCKER) private readonly docker: Docker,
  ) {}

  readonly handlers: Record<string, Handler> = {
    '/Plugin.Activate': async () => ({ Implements: ['NetworkDriver', 'IpamDriver'] }),
    '/NetworkDriver.GetCapabilities': async () => ({ Scope: 'local', ConnectivityScope: 'local' }),
    '/NetworkDriver.CreateNetwork': async () => ({}),
    '/NetworkDriver.DeleteNetwork': async () => ({}),
    '/NetworkDriver.CreateEndpoint': async (body) => {
      const id = String(body['EndpointID'] ?? '');
      const iface = (body['Interface'] ?? {}) as Record<string, unknown>;

      if (!id) return { Err: 'endpoint id missing' };

      // A full VM's further NIC: the container side carries a placeholder, the guest's real addresses come as an
      // endpoint driver option (routes and anti-spoofing are for those).
      const options = (body['Options'] ?? {}) as Record<string, unknown>;
      const real =
        typeof options[KEPT_NIC_ADDRESSES_OPTION] === 'string'
          ? String(options[KEPT_NIC_ADDRESSES_OPTION]).split(',')
          : [];
      const v4 = real.length ? real.find((a) => !a.includes(':')) : strip(iface['Address']);
      const v6 = real.length ? real.find((a) => a.includes(':')) : strip(iface['AddressIPv6']);

      this.endpoints.set(id, { id, v4, v6 });
      await this.persist();

      // Docker's addresses (from our IPAM) stay as they are.
      return { Interface: {} };
    },
    '/NetworkDriver.EndpointOperInfo': async () => ({ Value: {} }),
    '/NetworkDriver.DeleteEndpoint': async (body) => {
      const id = String(body['EndpointID'] ?? '');

      await this.commands.run('ip', ['link', 'del', keptInterface(id)]).catch(() => undefined);
      this.endpoints.delete(id);
      await this.persist();
      await this.applyTable();

      return {};
    },
    '/NetworkDriver.Join': async (body) => {
      const id = String(body['EndpointID'] ?? '');
      const endpoint = this.endpoints.get(id);

      if (!endpoint) return { Err: `unknown endpoint ${id}` };

      const host = keptInterface(id);

      await this.commands.run('ip', ['link', 'del', host]).catch(() => undefined);
      await this.commands.run('ip', ['link', 'add', host, 'type', 'veth', 'peer', 'name', `${host}c`]);
      await this.commands.run('ip', ['link', 'set', host, 'up']);

      if (endpoint.v4) {
        await this.commands.run('ip', ['addr', 'replace', `${KEPT_GATEWAY_V4}/32`, 'dev', host]);
        await this.commands.run('ip', ['route', 'replace', `${endpoint.v4}/32`, 'dev', host]);
      }

      if (endpoint.v6) {
        await this.commands.run('ip', ['-6', 'addr', 'replace', `${KEPT_GATEWAY_V6}/64`, 'dev', host, 'nodad']);
        await this.commands.run('ip', ['-6', 'route', 'replace', `${endpoint.v6}/128`, 'dev', host]);
      }

      await this.applyTable();

      return {
        InterfaceName: { SrcName: `${host}c`, DstPrefix: 'eth' },
        ...(endpoint.v4 ? { Gateway: KEPT_GATEWAY_V4 } : {}),
        ...(endpoint.v6 ? { GatewayIPv6: KEPT_GATEWAY_V6 } : {}),
        // The gateway is outside the container's /32: reachable on the link.
        StaticRoutes: endpoint.v4 ? [{ Destination: `${KEPT_GATEWAY_V4}/32`, RouteType: 1 }] : [],
        DisableGatewayService: true,
      };
    },
    '/NetworkDriver.Leave': async () => ({}),
    '/NetworkDriver.DiscoverNew': async () => ({}),
    '/NetworkDriver.DiscoverDelete': async () => ({}),
    '/NetworkDriver.ProgramExternalConnectivity': async () => ({}),
    '/NetworkDriver.RevokeExternalConnectivity': async () => ({}),
    '/IpamDriver.GetCapabilities': async () => ({ RequiresMACAddress: false }),
    '/IpamDriver.GetDefaultAddressSpaces': async () => ({
      LocalDefaultAddressSpace: KEPT_DRIVER,
      GlobalDefaultAddressSpace: KEPT_DRIVER,
    }),
    // Any address of the family: the control plane reserved the kept address on its subnet owner (3.10).
    '/IpamDriver.RequestPool': async (body) =>
      body['V6'] ? { PoolID: 'v6', Pool: '::/0', Data: {} } : { PoolID: 'v4', Pool: '0.0.0.0/0', Data: {} },
    '/IpamDriver.ReleasePool': async () => ({}),
    '/IpamDriver.RequestAddress': async (body) => {
      const v6 = body['PoolID'] === 'v6';
      const options = (body['Options'] ?? {}) as Record<string, unknown>;

      if (options['RequestAddressType'] === 'com.docker.network.gateway')
        return { Address: v6 ? `${KEPT_GATEWAY_V6}/128` : `${KEPT_GATEWAY_V4}/32` };

      const address = strip(body['Address']);

      if (!address) return { Err: 'kept-address networks only assign the address the replica keeps' };

      return { Address: `${address}/${v6 ? 128 : 32}` };
    },
    '/IpamDriver.ReleaseAddress': async () => ({}),
  };

  async start(): Promise<void> {
    if (this.server) return;

    this.endpoints = new Map((await this.load()).map((e) => [e.id, e]));

    const path = keptPluginSocketPath();

    await mkdir(dirname(path), { recursive: true });
    await rm(path, { force: true });

    const server = createServer((req, res) => void this.handle(req, res));

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(path, () => resolve());
    });
    this.server = server;
    await this.applyTable().catch(() => undefined);
  }

  onModuleDestroy(): void {
    this.server?.close();
    this.server = null;
  }

  /** Ensures the kept-address network for an address mix (and NIC slot) exists; returns its name. */
  async ensureNetwork(addresses: readonly string[], slot = 0): Promise<string> {
    await this.start();

    const name = keptNetworkName(addresses, slot);
    const existing = await this.docker.listNetworks({ filters: { name: [name] } });

    if (existing.some((n) => n.Name === name)) return name;

    const v4 = addresses.some((a) => !a.includes(':'));
    const v6 = addresses.some((a) => a.includes(':'));

    await this.docker.createNetwork({
      Name: name,
      Driver: KEPT_DRIVER,
      EnableIPv6: v6,
      ...(v4 ? {} : { EnableIPv4: false }),
      IPAM: { Driver: KEPT_DRIVER, Config: [] },
      Labels: { 'loadweaver.com/managed': 'true' },
    } as Docker.NetworkCreateOptions);
    this.logger.log(`Created kept-address network ${name}`);

    return name;
  }

  /**
   * The endpoints from the state file; a missing file means none, an unreadable one is rebuilt from Docker's
   * kept-address networks (their endpoints and addresses), so a corrupt file never keeps the plugin from starting.
   */
  private async load(): Promise<Endpoint[]> {
    const raw = await readFile(this.file, 'utf8').catch(() => null);

    if (raw === null) return [];

    try {
      const parsed = JSON.parse(raw) as unknown;

      if (Array.isArray(parsed))
        return parsed.filter(
          (e): e is Endpoint => !!e && typeof (e as Endpoint).id === 'string' && !!(e as Endpoint).id,
        );
    } catch {
      // rebuilt below
    }

    this.logger.warn(`${this.file} is unreadable; rebuilding the kept-address endpoints from Docker`);

    const endpoints = await this.fromDocker().catch((error: unknown) => {
      this.logger.warn(
        `Rebuilding kept-address endpoints failed: ${error instanceof Error ? error.message : String(error)}`,
      );

      return [] as Endpoint[];
    });

    this.endpoints = new Map(endpoints.map((e) => [e.id, e]));
    await this.persist();

    return endpoints;
  }

  private async fromDocker(): Promise<Endpoint[]> {
    const endpoints: Endpoint[] = [];

    for (const network of await this.docker.listNetworks({ filters: { driver: [KEPT_DRIVER] } })) {
      const info = (await this.docker.getNetwork(network.Id).inspect()) as {
        Containers?: Record<string, { EndpointID?: string; IPv4Address?: string; IPv6Address?: string }>;
      };

      for (const c of Object.values(info.Containers ?? {}))
        if (c.EndpointID) endpoints.push({ id: c.EndpointID, v4: strip(c.IPv4Address), v6: strip(c.IPv6Address) });
    }

    return endpoints;
  }

  /** Writes are serialized (handlers run concurrently), each through its own temp file. */
  private persist(): Promise<void> {
    const run = this.persisting.then(async () => {
      await mkdir(dirname(this.file), { recursive: true, mode: 0o700 });

      const tmp = `${this.file}.${process.pid}.${++this.writes}.tmp`;

      try {
        await writeFile(tmp, JSON.stringify([...this.endpoints.values()]), { mode: 0o600 });
        await rename(tmp, this.file);
      } catch (error) {
        await rm(tmp, { force: true });
        throw error;
      }
    });

    this.persisting = run.catch(() => undefined);

    return run;
  }

  private async applyTable(): Promise<void> {
    await this.commands.run('nft', ['-f', '-'], { input: renderKeptTable([...this.endpoints.values()]) });
  }

  private async handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const handler = req.method === 'POST' && req.url ? this.handlers[req.url] : undefined;
    const send = (status: number, payload: Record<string, unknown>) => {
      res.writeHead(status, { 'Content-Type': 'application/vnd.docker.plugins.v1.2+json' });
      res.end(JSON.stringify(payload));
    };

    if (!handler) return send(404, { Err: 'unknown endpoint' });

    let size = 0;
    const chunks: Buffer[] = [];

    for await (const chunk of req) {
      size += (chunk as Buffer).length;

      if (size > MAX_BODY_BYTES) return send(413, { Err: 'request too large' });

      chunks.push(chunk as Buffer);
    }

    let body: Record<string, unknown> = {};

    try {
      body = chunks.length ? (JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>) : {};
    } catch {
      return send(400, { Err: 'invalid JSON' });
    }

    try {
      send(200, await handler(body));
    } catch (error) {
      this.logger.warn(`${req.url}: ${error instanceof Error ? error.message : String(error)}`);
      send(200, { Err: `kept-address network: ${error instanceof Error ? error.message : 'failed'}` });
    }
  }
}
