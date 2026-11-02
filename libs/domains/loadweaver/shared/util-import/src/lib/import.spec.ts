import { discoveryReportSchema, type DiscoveryReport } from '@forepath/loadweaver/shared/util-agent-protocol';
import { parseCompose } from '@forepath/loadweaver/shared/util-compose';
import { parse } from 'yaml';

import { resolveConflicts } from './conflicts';
import { classifyFormer } from './former';
import { discoveredItems, resourceName } from './items';
import { bindVolumeKey, buildJoinPlan, importVolumeSize } from './join-plan';
import type { ImportClusterContext } from './types';

const NGINX = 'a'.repeat(64);
const DB = 'b'.repeat(64);
const TOOL = 'c'.repeat(64);

const COMPOSE = `
name: shop
services:
  web:
    image: nginx:1.27
    ports: ["80:80"]
    volumes: ["html:/usr/share/nginx/html"]
    depends_on: [db]
    environment:
      GREETING: \${GREETING}
  db:
    image: postgres:17
    environment:
      POSTGRES_PASSWORD: \${DB_PASSWORD}
    volumes: ["data:/var/lib/postgresql/data", "./init:/docker-entrypoint-initdb.d:ro"]
volumes:
  html: {}
  data: {}
`;

function report(overrides: Partial<DiscoveryReport> = {}): DiscoveryReport {
  return discoveryReportSchema.parse({
    version: 1,
    at: '2026-10-20T10:00:00.000Z',
    hostname: 'host1',
    docker: { available: true, version: '29.9.1' },
    composeProjects: [
      {
        name: 'shop',
        workingDir: '/srv/shop',
        configFiles: [{ path: '/srv/shop/compose.yaml', content: COMPOSE }],
        envFile: {
          path: '/srv/shop/.env',
          variables: [
            { name: 'GREETING', value: 'hello', sensitive: false },
            { name: 'DB_PASSWORD', sensitive: true },
          ],
        },
        services: ['db', 'web'],
        containers: [NGINX, DB],
      },
    ],
    containers: [
      {
        id: NGINX,
        name: 'shop-web-1',
        image: 'nginx:1.27',
        state: 'running',
        restartPolicy: 'unless-stopped',
        ports: [{ protocol: 'tcp', hostIp: '0.0.0.0', hostPort: 80, containerPort: 80 }],
        mounts: [
          {
            type: 'volume',
            name: 'shop_html',
            source: '/var/lib/docker/volumes/shop_html/_data',
            destination: '/usr/share/nginx/html',
            readOnly: false,
          },
        ],
        networks: ['shop_default'],
        labels: { 'com.docker.compose.project': 'shop', 'com.docker.compose.service': 'web' },
        compose: { project: 'shop', service: 'web', number: 1 },
        managed: false,
      },
      {
        id: DB,
        name: 'shop-db-1',
        image: 'postgres:17',
        state: 'running',
        ports: [],
        mounts: [
          {
            type: 'volume',
            name: 'shop_data',
            source: '/var/lib/docker/volumes/shop_data/_data',
            destination: '/var/lib/postgresql/data',
            readOnly: false,
          },
          {
            type: 'bind',
            source: '/srv/shop/init',
            destination: '/docker-entrypoint-initdb.d',
            readOnly: true,
            directory: true,
          },
        ],
        networks: ['shop_default'],
        labels: { 'com.docker.compose.project': 'shop', 'com.docker.compose.service': 'db' },
        compose: { project: 'shop', service: 'db', number: 1 },
        managed: false,
      },
      {
        id: TOOL,
        name: 'metrics_exporter',
        image: 'prom/node-exporter:v1.9.1',
        state: 'running',
        ports: [{ protocol: 'tcp', hostIp: '0.0.0.0', hostPort: 9100, containerPort: 9100 }],
        mounts: [],
        networks: ['bridge'],
        labels: {},
        managed: false,
      },
    ],
    volumes: [
      {
        name: 'shop_html',
        driver: 'local',
        mountpoint: '/var/lib/docker/volumes/shop_html/_data',
        sizeBytes: 2048,
        compose: { project: 'shop', volume: 'html' },
        usedBy: [NGINX],
      },
      {
        name: 'shop_data',
        driver: 'local',
        mountpoint: '/var/lib/docker/volumes/shop_data/_data',
        sizeBytes: 3 * 1024 ** 3,
        compose: { project: 'shop', volume: 'data' },
        usedBy: [DB],
      },
    ],
    networks: [
      {
        name: 'shop_default',
        driver: 'bridge',
        subnets: ['172.18.0.0/16'],
        compose: { project: 'shop', network: 'default' },
      },
    ],
    listeners: [
      { protocol: 'tcp', address: '0.0.0.0', port: 80, process: 'docker-proxy', pid: 100 },
      { protocol: 'tcp', address: '0.0.0.0', port: 22, process: 'sshd', pid: 1 },
      { protocol: 'udp', address: '0.0.0.0', port: 51820 },
      { protocol: 'tcp', address: '127.0.0.1', port: 5432, process: 'postgres' },
    ],
    interfaces: [
      { name: 'lo', kind: 'loopback', up: true, addresses: ['127.0.0.1/8'] },
      { name: 'eth0', kind: 'device', up: true, addresses: ['192.0.2.10/24'] },
      { name: 'wg0', kind: 'wireguard', up: true, addresses: ['10.200.0.2/24'] },
    ],
    routes: [
      { destination: 'default', gateway: '192.0.2.1', device: 'eth0', family: 'inet' },
      { destination: '192.0.2.0/24', device: 'eth0', family: 'inet' },
      { destination: '10.200.0.0/24', device: 'wg0', family: 'inet' },
    ],
    vpns: [{ interface: 'wg0', kind: 'wireguard', listenPort: 51820 }],
    nftables: [{ family: 'inet', name: 'filter' }],
    former: null,
    warnings: [],
    ...overrides,
  });
}

function cluster(overrides: Partial<ImportClusterContext> = {}): ImportClusterContext {
  return {
    clusterId: 'lw-1234abcd',
    node: 'host1',
    network: { podPoolV4: '10.244.0.0/16', servicePoolV4: '10.96.0.0/16', overlayPoolV4: '10.255.0.0/16' },
    nodeSubnets: ['10.244.7.0/24'],
    projects: ['shop', 'ops'],
    deployments: [],
    forwardedPorts: {},
    hostnames: {},
    volumes: [],
    ...overrides,
  };
}

describe('discovered items', () => {
  it('groups compose projects by label and keeps other containers apart', () => {
    const items = discoveredItems(report());

    expect(items.map((i) => i.id)).toEqual(['compose:shop', 'container:metrics_exporter']);
    expect(items[0]).toMatchObject({ services: ['web', 'db'], stateful: true, managed: false });
    expect(items[0].mounts.map((m) => m.key)).toEqual(['volume:shop_html', 'volume:shop_data', 'bind:/srv/shop/init']);
    expect(items[1]).toMatchObject({
      stateful: false,
      ports: [{ hostPort: 9100, containerPort: 9100, protocol: 'tcp' }],
    });
  });

  it('derives resource names and volume keys', () => {
    expect(resourceName('My_Shop.Project')).toBe('my-shop-project');
    expect(resourceName('***')).toBe('imported');
    expect(bindVolumeKey('/srv/shop/init')).toBe('bind-srv-shop-init');
    expect(importVolumeSize(2048)).toBe('1g');
    expect(importVolumeSize(3 * 1024 ** 3)).toBe('5g');
    expect(importVolumeSize(null)).toBe('10g');
  });
});

describe('conflict resolver', () => {
  it('reserves host ports for WireGuard, keeps pre-existing tunnels, frees imported ports', () => {
    const { conflicts, reservedPorts } = resolveConflicts(report(), cluster(), new Set(['tcp/80']));

    expect(reservedPorts.udp).toEqual([51820]);
    expect(reservedPorts.tcp).toEqual([22, 5432]);
    expect(conflicts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ kind: 'port', subject: 'udp/51820', severity: 'resolved' }),
        expect.objectContaining({ kind: 'port', subject: 'tcp/80', severity: 'resolved' }),
        expect.objectContaining({ kind: 'tunnel', subject: 'wg0', severity: 'resolved' }),
      ]),
    );
    expect(conflicts.filter((c) => c.severity === 'error')).toEqual([]);
  });

  it('refuses overlapping subnets, fixed node ports and interfaces named like Loadweaver', () => {
    const r = report({
      listeners: [{ protocol: 'tcp', address: '::', port: 179, process: 'bird' }],
      interfaces: [{ name: 'lw0', kind: 'dummy', up: true, addresses: [] }],
      routes: [{ destination: '10.244.0.0/20', device: 'tailscale0', family: 'inet' }],
    });
    const errors = resolveConflicts(r, cluster()).conflicts.filter((c) => c.severity === 'error');

    // The route overlaps the pod pool and the node's own subnet.
    expect(errors.map((c) => c.kind).sort()).toEqual(['interface', 'port', 'subnet', 'subnet']);
    expect(errors.find((c) => c.kind === 'subnet')?.reason).toBe(
      "route 10.244.0.0/20 dev tailscale0 overlaps the cluster's pod pool 10.244.0.0/16",
    );
  });

  it('accepts a former installation’s interfaces and warns about member ports', () => {
    const r = report({
      listeners: [{ protocol: 'tcp', address: '0.0.0.0', port: 2379, process: 'etcd' }],
      interfaces: [{ name: 'lw-0a1b2c3d', kind: 'wireguard', up: true, addresses: ['10.255.0.9/32'] }],
      routes: [],
      former: {
        stateDir: true,
        clusterId: 'lw-other',
        drbdResources: [],
        interfaces: ['lw-0a1b2c3d'],
        nftTables: [],
        managedContainers: 0,
      },
    });
    const { conflicts } = resolveConflicts(r, cluster());

    expect(conflicts.filter((c) => c.kind !== 'tunnel')).toEqual([
      expect.objectContaining({ kind: 'port', subject: 'tcp/2379', severity: 'warning' }),
      expect.objectContaining({ kind: 'interface', subject: 'lw-0a1b2c3d', severity: 'resolved' }),
    ]);
  });
});

describe('former nodes', () => {
  const drbd = (minor: number, extra: object = {}) => ({
    name: `lw-${minor}`,
    minor,
    hosts: [{ host: 'host1', nodeId: 1 }],
    backingDevice: true,
    sizeBytes: 2 * 1024 ** 3,
    ...extra,
  });

  it('reuses replicas the same cluster still assigns to the node', () => {
    const r = report({
      former: {
        stateDir: true,
        clusterId: 'lw-1234abcd',
        nodeName: 'host1',
        drbdResources: [drbd(3), drbd(4), drbd(5, { backingDevice: false }), drbd(6)],
        interfaces: [],
        nftTables: ['inet loadweaver'],
        managedContainers: 1,
      },
    });
    const former = classifyFormer(
      r,
      cluster({
        volumes: [
          { id: 'shop/web/html', drbdMinor: 3, holders: ['n1', 'host1'], sizeBytes: 1024 ** 3 },
          { id: 'shop/db/data', drbdMinor: 4, holders: ['n1', 'n2'], sizeBytes: 1024 ** 3 },
          { id: 'ops/x/y', drbdMinor: 5, holders: ['host1'], sizeBytes: 1024 ** 3 },
        ],
      }),
    );

    expect(former).toMatchObject({ kind: 'same-cluster', requiresWipe: false });
    expect(former?.reusable).toEqual([expect.objectContaining({ resource: 'lw-3', volume: 'shop/web/html' })]);
    expect(Object.fromEntries((former?.discarded ?? []).map((d) => [d.resource, d.reason]))).toEqual({
      'lw-4': 'the volume no longer has a copy on this node',
      'lw-5': 'the backing device is gone',
      'lw-6': 'no volume of this cluster uses this DRBD minor any more',
    });
  });

  it('discards everything of another cluster and asks for the wipe explicitly', () => {
    const r = report({
      former: {
        stateDir: true,
        clusterId: 'lw-other',
        drbdResources: [drbd(3)],
        interfaces: [],
        nftTables: [],
        managedContainers: 0,
      },
    });

    expect(classifyFormer(r, cluster())).toMatchObject({ kind: 'other-cluster', requiresWipe: true, reusable: [] });

    const refused = buildJoinPlan(r, { items: [] }, cluster());

    expect(refused.errors).toContain(
      'the host belonged to cluster lw-other: confirm discarding its identity and keys (wipeFormerIdentity)',
    );

    const confirmed = buildJoinPlan(r, { items: [], wipeFormerIdentity: true }, cluster());

    expect(confirmed.errors).toEqual([]);
    expect(confirmed.steps.map((s) => s.kind)).toEqual(['components', 'wipe-identity', 'activate']);
    expect(confirmed.wipeFormerIdentity).toBe(true);
  });
});

describe('join plan', () => {
  const selections = {
    items: [
      {
        item: 'compose:shop',
        choice: 'import' as const,
        project: 'shop',
        http: { '80': 'shop.example.com' },
        volumes: { 'bind:/srv/shop/init': 'keep' as const },
        variables: { DB_PASSWORD: 'from-the-wizard' },
      },
      { item: 'container:metrics_exporter', choice: 'migrate' as const, project: 'ops', deployment: 'exporter' },
    ],
  };

  it('imports in dependency order with rsync pre-copy, short stop, final pass and port handover', () => {
    const plan = buildJoinPlan(report(), selections, cluster());

    expect(plan.errors).toEqual([]);
    expect(plan.steps.map((s) => s.id)).toEqual([
      'components',
      'activate',
      'shop/shop/precopy',
      'ops/exporter/release',
      'ops/exporter/verify',
      'ops/exporter/stop',
      'shop/shop/stop',
      'shop/shop/final-sync',
      'shop/shop/release',
      'shop/shop/verify',
      'handover',
    ]);
    // Dependents stop first: web before db.
    expect(plan.steps.find((s) => s.id === 'shop/shop/stop')?.containers).toEqual([NGINX, DB]);
    expect(plan.steps.find((s) => s.id === 'shop/shop/precopy')?.copies).toEqual([
      { source: '/var/lib/docker/volumes/shop_html/_data', volume: 'shop/shop/html' },
      { source: '/var/lib/docker/volumes/shop_data/_data', volume: 'shop/shop/data' },
    ]);
    expect(plan.steps.at(-1)?.ports).toEqual([
      { protocol: 'tcp', port: 80 },
      { protocol: 'tcp', port: 9100 },
    ]);
    expect(plan.reservedPorts.udp).toEqual([51820]);
    expect(plan.warnings.some((w) => w.includes('DB_PASSWORD'))).toBe(false);
  });

  it('turns ports into ingress routes / forwards, pins the import and keeps the migration off the node', () => {
    const plan = buildJoinPlan(report(), selections, cluster());
    const shop = plan.deployments.find((d) => d.name === 'shop');
    const exporter = plan.deployments.find((d) => d.name === 'exporter');
    const compose = parse(shop?.resource.spec.compose ?? '') as {
      services: Record<string, Record<string, unknown>>;
      volumes: Record<string, unknown>;
    };

    expect(compose.services['web']['ports']).toBeUndefined();
    expect(compose.services['web']['x-loadweaver']).toEqual({
      placement: { selector: { matchLabels: { 'loadweaver.com/node': 'host1' } } },
      exposure: { http: [{ host: 'shop.example.com', port: 80 }] },
    });
    expect(compose.services['db']['volumes']).toEqual([
      'data:/var/lib/postgresql/data',
      '/srv/shop/init:/docker-entrypoint-initdb.d:ro',
    ]);
    expect(compose.volumes).toEqual({
      html: { 'x-loadweaver': { size: '1g' } },
      data: { 'x-loadweaver': { size: '5g' } },
    });
    expect(shop?.resource.spec.variables).toEqual({ GREETING: 'hello', DB_PASSWORD: 'from-the-wizard' });
    expect(shop?.resource.metadata.annotations).toEqual({
      'loadweaver.com/imported-from': 'host1/compose:shop',
      'loadweaver.com/import': 'host1',
    });

    const exporterCompose = parse(exporter?.resource.spec.compose ?? '') as {
      services: Record<string, Record<string, unknown>>;
    };

    expect(exporterCompose.services['metrics_exporter']).toEqual({
      image: 'prom/node-exporter:v1.9.1',
      ports: ['9100:9100/tcp'],
      'x-loadweaver': {
        placement: {
          selector: { matchExpressions: [{ key: 'loadweaver.com/node', operator: 'NotIn', values: ['host1'] }] },
        },
      },
    });

    for (const d of plan.deployments)
      expect(
        parseCompose(d.resource.spec.compose, {
          name: d.name,
          project: d.project,
          variables: d.resource.spec.variables,
          defaultRequests: { cpuMillis: 100, memoryBytes: 1 },
        }).ok,
      ).toBe(true);
  });

  it('refuses what it cannot do, with reasons', () => {
    const plan = buildJoinPlan(
      report(),
      {
        items: [
          { item: 'compose:shop', choice: 'migrate', project: 'shop' },
          { item: 'container:metrics_exporter', choice: 'import', project: 'ops' },
          { item: 'compose:gone', choice: 'import', project: 'shop' },
        ],
      },
      cluster({ forwardedPorts: { 'tcp/9100': 'ops/monitor/agent' }, deployments: ['shop/shop'] }),
    );

    expect(plan.errors).toEqual(
      expect.arrayContaining([
        'compose:gone: not found in the discovery (discover again?)',
        'compose:shop: deployment shop/shop exists already; choose another name',
        'compose:shop: has data (read-write volumes or bind mounts); import it here, then move it with a normal plan (the replicated volume syncs to the target)',
        'compose:shop/web: port 80 is served by the HTTP ingress; give a hostname for it (the ingress routes by host name)',
        'container:metrics_exporter/metrics_exporter: the ingress forwards 9100/tcp for ops/monitor/agent already',
      ]),
    );
    expect(plan.errors.some((e) => e.includes('variable DB_PASSWORD is not set'))).toBe(true);
  });

  it('leaves ignored items as drift and generates compose files it could not read', () => {
    const r = report({
      composeProjects: [
        { ...report().composeProjects[0], configFiles: [{ path: '/srv/shop/compose.yaml', error: 'EACCES' }] },
      ],
    });
    const plan = buildJoinPlan(
      r,
      { items: [{ item: 'compose:shop', choice: 'import', project: 'shop', http: { '80': 'shop.example.com' } }] },
      cluster(),
    );

    expect(plan.errors).toEqual([]);
    expect(plan.leftovers).toEqual(['container:metrics_exporter']);
    expect(plan.warnings).toEqual(
      expect.arrayContaining([
        'compose:shop: the compose file could not be read; the compose file is generated from the running containers (environment variables are not copied)',
        'left unmanaged (visible as drift): container:metrics_exporter',
      ]),
    );

    const compose = parse(plan.deployments[0].resource.spec.compose) as {
      services: Record<string, Record<string, unknown>>;
    };

    expect(compose.services['db']['volumes']).toEqual([
      'data:/var/lib/postgresql/data',
      'bind-srv-shop-init:/docker-entrypoint-initdb.d:ro',
    ]);
    expect(plan.deployments[0].copies.map((c) => c.volume)).toEqual([
      'shop/shop/html',
      'shop/shop/data',
      'shop/shop/bind-srv-shop-init',
    ]);
  });
});
