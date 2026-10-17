import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { decodeAgentMessage, type Envelope } from '@forepath/loadweaver/shared/util-agent-protocol';

import {
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
import { DiscoveryService } from './discovery.service';
import { ImportExecutor, rsyncArgs, rsyncBytes } from './import-executor.service';

const ID = 'a'.repeat(64);
const IMPORT = '7f1c4d3e-2b1a-4c5d-8e9f-0a1b2c3d4e5f';

describe('discovery parsers (3.21)', () => {
  it('reads listeners from ss', () => {
    const out = [
      'tcp   LISTEN 0      4096         0.0.0.0:80         0.0.0.0:*    users:(("docker-proxy",pid=1234,fd=4))',
      'tcp   LISTEN 0      4096            [::]:80            [::]:*    users:(("docker-proxy",pid=1240,fd=4))',
      'tcp   LISTEN 0      128             [::]:22            [::]:*    users:(("sshd",pid=1,fd=4))',
      'tcp   LISTEN 0      4096   127.0.0.53%lo:53         0.0.0.0:*    users:(("systemd-resolve",pid=300,fd=14))',
      'udp   UNCONN 0      0            0.0.0.0:51820      0.0.0.0:*',
      'udp   UNCONN 0      0                  *:5353             *:*',
      'garbage',
    ].join('\n');

    expect(parseSsListeners(out)).toEqual([
      { protocol: 'tcp', address: '::', port: 22, process: 'sshd', pid: 1 },
      { protocol: 'tcp', address: '127.0.0.53', port: 53, process: 'systemd-resolve', pid: 300 },
      { protocol: 'tcp', address: '::', port: 80, process: 'docker-proxy', pid: 1240 },
      { protocol: 'tcp', address: '0.0.0.0', port: 80, process: 'docker-proxy', pid: 1234 },
      { protocol: 'udp', address: '*', port: 5353 },
      { protocol: 'udp', address: '0.0.0.0', port: 51820 },
    ]);
  });

  it('reads interfaces, routes, nftables and WireGuard ports', () => {
    const interfaces = parseIpAddresses([
      {
        ifname: 'lo',
        flags: ['LOOPBACK', 'UP'],
        link_type: 'loopback',
        addr_info: [{ family: 'inet', local: '127.0.0.1', prefixlen: 8 }],
      },
      {
        ifname: 'eth0',
        flags: ['UP'],
        link_type: 'ether',
        addr_info: [{ family: 'inet6', local: '2001:db8::5', prefixlen: 64 }],
      },
      { ifname: 'wg0', flags: ['UP'], link_type: 'none', linkinfo: { info_kind: 'wireguard' }, addr_info: [] },
      { ifname: 'tailscale0', flags: [], link_type: 'none', linkinfo: { info_kind: 'tun' } },
      { ifname: 'lw-0a1b2c3d', flags: ['UP'], linkinfo: { info_kind: 'wireguard' } },
    ]);

    expect(interfaces.map((i) => [i.name, i.kind, i.up, i.addresses])).toEqual([
      ['lo', 'loopback', true, ['127.0.0.1/8']],
      ['eth0', 'device', true, ['2001:db8::5/64']],
      ['wg0', 'wireguard', true, []],
      ['tailscale0', 'tun', false, []],
      ['lw-0a1b2c3d', 'wireguard', true, []],
    ]);
    expect(detectVpns(interfaces, parseWgListenPorts('wg0\t51820\nlw-0a1b2c3d\t51821\n'))).toEqual([
      { interface: 'wg0', kind: 'wireguard', listenPort: 51820 },
      { interface: 'tailscale0', kind: 'tailscale' },
    ]);
    expect(
      parseIpRoutes(
        [
          { dst: 'default', gateway: '192.0.2.1', dev: 'eth0' },
          { dst: '10.8.0.0/24', dev: 'tun0', table: 'vpn' },
          { dst: '192.0.2.10', dev: 'eth0', table: 'local', type: 'local' },
          { nonsense: true },
        ],
        'inet',
      ),
    ).toEqual([
      { destination: 'default', device: 'eth0', gateway: '192.0.2.1', family: 'inet' },
      { destination: '10.8.0.0/24', device: 'tun0', table: 'vpn', family: 'inet' },
      { destination: '192.0.2.10', device: 'eth0', table: 'local', family: 'inet' },
    ]);
    expect(
      parseNftTables({
        nftables: [{ metainfo: { version: '1.1.3' } }, { table: { family: 'inet', name: 'filter', handle: 1 } }],
      }),
    ).toEqual([{ family: 'inet', name: 'filter' }]);
  });

  it('keeps sensitive .env values and URL credentials on the host', () => {
    expect(
      parseEnvFile(
        [
          '# comment',
          'GREETING=hello # trailing',
          'export MODE="prod"',
          "DB_PASSWORD='s3cret'",
          'DATABASE_URL=postgres://app:pw@db/app',
          'UPSTREAM=redis://:pw@cache:6379',
          'PUBLIC=https://shop.example.com',
          'not a line',
        ].join('\n'),
      ),
    ).toEqual([
      { name: 'GREETING', value: 'hello', sensitive: false },
      { name: 'MODE', value: 'prod', sensitive: false },
      { name: 'DB_PASSWORD', sensitive: true },
      { name: 'DATABASE_URL', sensitive: true },
      { name: 'UPSTREAM', sensitive: true },
      { name: 'PUBLIC', value: 'https://shop.example.com', sensitive: false },
    ]);
  });

  it('reads Loadweaver DRBD resources, their status and backing LVs', () => {
    const conf = [
      '# Managed by Loadweaver. Changes are overwritten on the next apply.',
      'resource "lw-3" {',
      '  device minor 3;',
      '  on "host1" { node-id 1; address ipv4 10.255.0.1:7790; }',
      '  on "host2" { node-id 2; address ipv4 10.255.0.2:7790; }',
      '}',
    ].join('\n');

    expect(parseDrbdResource('lw-3.res', conf)).toEqual({
      name: 'lw-3',
      minor: 3,
      port: 7790,
      hosts: [
        { host: 'host1', nodeId: 1 },
        { host: 'host2', nodeId: 2 },
      ],
    });
    expect(parseDrbdResource('lw-3.res', 'resource "lw-3" {}')).toBeNull();
    expect(parseDrbdResource('r0.res', conf)).toBeNull();
    expect(parseDrbdStatus([{ name: 'lw-3', role: 'Secondary', devices: [{ 'disk-state': 'Outdated' }] }])).toEqual(
      new Map([['lw-3', { role: 'Secondary', diskState: 'Outdated' }]]),
    );
    expect(
      parseLvs({
        report: [
          {
            lv: [
              { lv_name: 'lw-3', lv_size: '2147483648' },
              { lv_name: 'pool', lv_size: '9B' },
            ],
          },
        ],
      }),
    ).toEqual(
      new Map([
        ['lw-3', 2147483648],
        ['pool', 9],
      ]),
    );
  });

  it('reports only compose and Loadweaver labels', () => {
    expect(
      reportedLabels({ 'com.docker.compose.project': 'shop', 'loadweaver.com/managed': 'true', 'app.token': 'x' }),
    ).toEqual({
      'com.docker.compose.project': 'shop',
      'loadweaver.com/managed': 'true',
    });
  });
});

describe('discovery service', () => {
  let dir: string;
  const env = { ...process.env };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-discovery-'));
    process.env['LOADWEAVER_STATE_DIR'] = join(dir, 'state');
    process.env['LOADWEAVER_DRBD_CONFIG_DIR'] = join(dir, 'drbd.d');
  });

  afterEach(async () => {
    process.env = { ...env };
    await rm(dir, { recursive: true, force: true });
  });

  function docker(composeDir: string) {
    const container = {
      Id: ID,
      Name: '/shop-web-1',
      Config: {
        Image: 'nginx:1.27',
        Labels: {
          'com.docker.compose.project': 'shop',
          'com.docker.compose.service': 'web',
          'com.docker.compose.container-number': '1',
          'com.docker.compose.project.working_dir': composeDir,
          'com.docker.compose.project.config_files': 'compose.yaml',
          'secret.label': 'nope',
        },
      },
      State: { Status: 'running', Running: true },
      HostConfig: { RestartPolicy: { Name: 'unless-stopped' }, NetworkMode: 'shop_default' },
      NetworkSettings: {
        Ports: { '80/tcp': [{ HostIp: '0.0.0.0', HostPort: '80' }], '443/tcp': null },
        Networks: { shop_default: {} },
      },
      Mounts: [
        {
          Type: 'volume',
          Name: 'shop_html',
          Source: '/var/lib/docker/volumes/shop_html/_data',
          Destination: '/usr/share/nginx/html',
          RW: true,
        },
        { Type: 'bind', Source: composeDir, Destination: '/etc/shop', RW: false },
      ],
    };
    const calls: string[] = [];

    return {
      calls,
      version: async () => ({ Version: '29.9.1' }),
      listContainers: async () => [{ Id: ID, Names: ['/shop-web-1'], Image: 'nginx:1.27', State: 'running' }],
      getContainer: () => ({ inspect: async () => container }),
      df: async () => ({
        Volumes: [
          {
            Name: 'shop_html',
            Driver: 'local',
            Mountpoint: '/var/lib/docker/volumes/shop_html/_data',
            Labels: { 'com.docker.compose.project': 'shop', 'com.docker.compose.volume': 'html' },
            UsageData: { Size: 4096 },
          },
        ],
      }),
      listNetworks: async () => [
        {
          Name: 'shop_default',
          Driver: 'bridge',
          IPAM: { Config: [{ Subnet: '172.18.0.0/16' }] },
          Labels: { 'com.docker.compose.project': 'shop', 'com.docker.compose.network': 'default' },
        },
      ],
    };
  }

  it('reports compose projects (redacted), containers, volumes, host networking and nothing secret', async () => {
    const composeDir = join(dir, 'shop');

    await mkdir(composeDir);
    await writeFile(
      join(composeDir, 'compose.yaml'),
      'services:\n  web:\n    image: nginx:1.27\n    environment:\n      API_TOKEN: abc123\n',
    );
    await writeFile(join(composeDir, '.env'), 'GREETING=hi\nDB_PASSWORD=pw\n');

    const runs: string[][] = [];
    const commands = {
      run: jest.fn(async (cmd: string, args: string[]) => {
        runs.push([cmd, ...args]);

        return {
          stdout: cmd === 'ss' ? 'tcp LISTEN 0 4096 0.0.0.0:80 0.0.0.0:* users:(("docker-proxy",pid=9,fd=4))' : '',
          stderr: '',
        };
      }),
      json: jest.fn(async (cmd: string, args: string[]) => {
        runs.push([cmd, ...args]);

        if (cmd === 'ip' && args.includes('addr'))
          return [
            { ifname: 'eth0', flags: ['UP'], addr_info: [{ family: 'inet', local: '192.0.2.10', prefixlen: 24 }] },
          ];

        if (cmd === 'nft') return { nftables: [{ table: { family: 'inet', name: 'filter' } }] };

        return [];
      }),
    };
    const report = await new DiscoveryService(commands as never, docker(composeDir) as never).discover();

    expect(report.docker).toEqual({ available: true, version: '29.9.1' });
    expect(report.composeProjects).toEqual([
      {
        name: 'shop',
        workingDir: composeDir,
        configFiles: [
          {
            path: join(composeDir, 'compose.yaml'),
            content: 'services:\n  web:\n    image: nginx:1.27\n    environment:\n      API_TOKEN: ${API_TOKEN}\n',
            redacted: [{ variable: 'API_TOKEN', path: 'services.web.environment.API_TOKEN' }],
          },
        ],
        envFile: {
          path: join(composeDir, '.env'),
          variables: [
            { name: 'GREETING', value: 'hi', sensitive: false },
            { name: 'DB_PASSWORD', sensitive: true },
          ],
        },
        services: ['web'],
        containers: [ID],
      },
    ]);
    expect(report.containers[0]).toMatchObject({
      name: 'shop-web-1',
      restartPolicy: 'unless-stopped',
      ports: [{ protocol: 'tcp', hostIp: '0.0.0.0', hostPort: 80, containerPort: 80 }],
      compose: { project: 'shop', service: 'web', number: 1 },
      managed: false,
    });
    expect(report.containers[0].labels['secret.label']).toBeUndefined();
    expect(report.containers[0].mounts[1]).toMatchObject({ type: 'bind', directory: true, readOnly: true });
    expect(report.volumes).toEqual([
      {
        name: 'shop_html',
        driver: 'local',
        mountpoint: '/var/lib/docker/volumes/shop_html/_data',
        sizeBytes: 4096,
        compose: { project: 'shop', volume: 'html' },
        usedBy: [ID],
      },
    ]);
    expect(report.listeners).toEqual([
      { protocol: 'tcp', address: '0.0.0.0', port: 80, process: 'docker-proxy', pid: 9 },
    ]);
    expect(report.former).toBeNull();
    expect(JSON.stringify(report)).not.toMatch(/abc123|"pw"/);
    // Only reading commands.
    expect(runs.map((r) => r[0]).sort()).toEqual(['ip', 'ip', 'ip', 'nft', 'ss']);
  });

  it('finds a former installation (archived identity, DRBD resources, interfaces, tables)', async () => {
    const state = join(dir, 'state');

    await mkdir(join(state, 'former-lw-old'), { recursive: true });
    await writeFile(
      join(state, 'identity.json'),
      JSON.stringify({ clusterId: 'lw-new', nodeName: 'host1', pending: true }),
    );
    await writeFile(
      join(state, 'former-lw-old', 'identity.json'),
      JSON.stringify({ clusterId: 'lw-old', nodeName: 'n7' }),
    );
    await mkdir(join(dir, 'drbd.d'));
    await writeFile(
      join(dir, 'drbd.d', 'lw-4.res'),
      '# Managed by Loadweaver.\nresource "lw-4" {\n  device minor 4;\n  on "host1" { node-id 0; address ipv4 10.0.0.1:7791; }\n}\n',
    );

    const commands = {
      run: jest.fn(async () => ({ stdout: '', stderr: '' })),
      json: jest.fn(async (cmd: string, args: string[]) => {
        if (cmd === 'ip' && args.includes('addr'))
          return [{ ifname: 'lw0', flags: ['UP'], linkinfo: { info_kind: 'dummy' } }];

        if (cmd === 'nft') return { nftables: [{ table: { family: 'inet', name: 'loadweaver' } }] };

        if (cmd === 'lvs') return { report: [{ lv: [{ lv_name: 'lw-4', lv_size: '1073741824' }] }] };

        if (cmd === 'drbdsetup') throw new Error('not loaded');

        return [];
      }),
    };
    const unavailable = { version: async () => Promise.reject(new Error('no docker')) };
    const report = await new DiscoveryService(commands as never, unavailable as never).discover({ ownIdentity: true });

    expect(report.docker.available).toBe(false);
    expect(report.warnings).toEqual(['docker: no docker']);
    expect(report.former).toEqual({
      stateDir: true,
      clusterId: 'lw-old',
      nodeName: 'n7',
      drbdResources: [
        {
          name: 'lw-4',
          minor: 4,
          port: 7791,
          hosts: [{ host: 'host1', nodeId: 0 }],
          backingDevice: true,
          sizeBytes: 1073741824,
        },
      ],
      interfaces: ['lw0'],
      nftTables: ['inet loadweaver'],
      managedContainers: 0,
    });
  });
});

describe('import executor', () => {
  let dir: string;
  const env = { ...process.env };

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'lw-import-'));
    process.env['LOADWEAVER_STATE_DIR'] = dir;
  });

  afterEach(async () => {
    process.env = { ...env };
    await rm(dir, { recursive: true, force: true });
  });

  function setup(overrides: { identity?: object } = {}) {
    const sent: unknown[] = [];
    const runs: string[][] = [];
    const containers = new Map<string, { running: boolean; policy: string }>([
      [ID, { running: true, policy: 'always' }],
    ]);
    const commands = {
      run: jest.fn(async (cmd: string, args: string[]) => {
        runs.push([cmd, ...args]);

        if (cmd === 'rsync')
          return { stdout: 'Number of files: 3\nTotal transferred file size: 1,234 bytes\n', stderr: '' };

        if (cmd === 'systemd-run') return { stdout: 'loadweaver-components: nothing to install\n', stderr: '' };

        return { stdout: '', stderr: '' };
      }),
    };
    const docker = {
      getContainer: (id: string) => ({
        inspect: async () => ({
          Name: '/shop-web-1',
          State: { Running: containers.get(id)?.running },
          HostConfig: { RestartPolicy: { Name: containers.get(id)?.policy } },
        }),
        update: async (o: { RestartPolicy: { Name: string } }) => {
          (containers.get(id) as { policy: string }).policy = o.RestartPolicy.Name;
        },
        stop: async () => {
          (containers.get(id) as { running: boolean }).running = false;
        },
        start: async () => {
          (containers.get(id) as { running: boolean }).running = true;
        },
      }),
    };
    const volumes = {
      mount: jest.fn(async (name: string) => `/var/lib/loadweaver/volumes/${name}`),
      unmount: jest.fn(async () => undefined),
    };
    const state = { dir, identity: async () => overrides.identity ?? { clusterId: 'lw-new', nodeName: 'host1' } };
    const executor = new ImportExecutor(commands as never, docker as never, volumes as never, state as never);

    executor.attach((e: Envelope) => {
      const decoded = decodeAgentMessage(e);

      sent.push(decoded.ok ? { channel: e.channel, ...decoded.message.payload } : decoded.error);
    });

    return { executor, sent, runs, containers, volumes };
  }

  it('builds rsync arguments and reads the copied bytes', () => {
    expect(rsyncArgs('/var/lib/docker/volumes/x/_data/', '/mnt/v', true)).toEqual([
      '-aHAX',
      '--numeric-ids',
      '--stats',
      '--delete',
      '--',
      '/var/lib/docker/volumes/x/_data/',
      '/mnt/v/',
    ]);
    expect(rsyncBytes('Total transferred file size: 1,234 bytes')).toBe(1234);
    expect(rsyncBytes('nothing')).toBe(0);
  });

  it('copies into the mounted volume, unmounts after the final pass and answers re-sent steps from its result', async () => {
    const { executor, sent, runs, volumes } = setup();
    const source = join(dir, 'src');

    await mkdir(source);

    const copies = [{ source, volume: 'lw-vol-shop.shop.html' }];
    const pre = await executor.handle({
      import: IMPORT,
      step: 'shop/shop/precopy',
      action: { kind: 'precopy', copies },
    });

    expect(pre).toMatchObject({ status: 'done', bytes: 1234 });
    expect(volumes.unmount).not.toHaveBeenCalled();
    expect(runs[0]).toEqual([
      'rsync',
      ...rsyncArgs(source, '/var/lib/loadweaver/volumes/lw-vol-shop.shop.html', false),
    ]);

    await executor.handle({ import: IMPORT, step: 'shop/shop/final-sync', action: { kind: 'final-sync', copies } });
    expect(runs[1]).toContain('--delete');
    expect(volumes.unmount).toHaveBeenCalledWith('lw-vol-shop.shop.html');

    await executor.handle({ import: IMPORT, step: 'shop/shop/precopy', action: { kind: 'precopy', copies } });
    expect(runs.filter((r) => r[0] === 'rsync')).toHaveLength(2);
    expect(sent.at(-1)).toMatchObject({ channel: `import:${IMPORT}`, step: 'shop/shop/precopy', status: 'done' });
  });

  it('stops the source with its restart policy off, restarts it on a rollback, checks the handover', async () => {
    const { executor, containers } = setup();
    const stopped = await executor.handle({
      import: IMPORT,
      step: 's/stop',
      action: { kind: 'stop', containers: [ID] },
    });

    expect(stopped).toMatchObject({ status: 'done', restartPolicies: { [ID]: 'always' } });
    expect(containers.get(ID)).toEqual({ running: false, policy: 'no' });
    expect(
      await executor.handle({
        import: IMPORT,
        step: 'handover',
        action: { kind: 'handover', containers: [ID], ports: [{ protocol: 'tcp', port: 80 }] },
      }),
    ).toMatchObject({ status: 'done' });

    await executor.handle({
      import: IMPORT,
      step: 'rollback',
      action: { kind: 'restart-source', containers: [ID], restartPolicies: { [ID]: 'always' } },
    });
    expect(containers.get(ID)).toEqual({ running: true, policy: 'always' });
    expect(
      await executor.handle({
        import: IMPORT,
        step: 'handover-2',
        action: { kind: 'handover', containers: [ID], ports: [] },
      }),
    ).toMatchObject({ status: 'failed', message: 'source container shop-web-1 runs again' });
  });

  it('runs the component script outside the sandbox and removes it', async () => {
    const { executor, runs } = setup();
    const result = await executor.handle({
      import: IMPORT,
      step: 'components',
      action: { kind: 'components', script: 'echo ok' },
    });

    expect(result).toMatchObject({ status: 'done', message: 'loadweaver-components: nothing to install' });
    expect(runs[0].slice(0, 6)).toEqual([
      'systemd-run',
      `--unit=loadweaver-import-${IMPORT.slice(0, 8)}`,
      '--wait',
      '--collect',
      '--quiet',
      '--pipe',
    ]);
    expect(await readdir(join(dir, 'import'))).toEqual([]);
  });

  it('wipes only an archived identity of another cluster', async () => {
    const { executor } = setup();

    expect(
      await executor.handle({ import: IMPORT, step: 'w1', action: { kind: 'wipe-identity', clusterId: 'lw-new' } }),
    ).toMatchObject({ status: 'failed', message: 'refusing to wipe the identity of the cluster this node belongs to' });
    expect(
      await executor.handle({ import: IMPORT, step: 'w2', action: { kind: 'wipe-identity', clusterId: 'lw-old' } }),
    ).toMatchObject({
      status: 'failed',
      message: 'no archived identity of cluster lw-old (join --discover archives it)',
    });

    await mkdir(join(dir, 'former-lw-old'));
    await writeFile(join(dir, 'former-lw-old', 'node.key'), 'key');
    expect(
      await executor.handle({ import: IMPORT, step: 'w3', action: { kind: 'wipe-identity', clusterId: 'lw-old' } }),
    ).toMatchObject({ status: 'done' });
    expect(await readdir(dir)).not.toContain('former-lw-old');
  });
});
