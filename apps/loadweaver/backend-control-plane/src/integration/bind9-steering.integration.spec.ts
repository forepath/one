import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  renderZoneFile,
  steer,
  steeringViews,
  zoneBody,
  type DesiredRecord,
  type SteeredHost,
} from '@forepath/loadweaver/backend/feature-control-plane';
import {
  BIND9_DIR,
  DEFAULT_BIND9_IMAGE,
  GEOIP_FILE,
  renderNamedConf,
  viewZoneFile,
  zoneFileName,
} from '@forepath/loadweaver/backend/feature-node-agent';
import type { AuthoritativeDns } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { DnsFailoverSpec, DnsZoneSpec } from '@forepath/loadweaver/shared/util-model';

import { geoipTestDb, GEOIP_TEST_DB_SHA256 } from './geoip-test-db';

/**
 * DNS steering on real bind9 (3.28): the control plane's views (geo by country / continent from a GeoIP database,
 * weighted by address bucket) and the agent's named.conf; clients in the GeoIP test ranges get their answers.
 */

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

describe('hosted bind9 steering (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const dir = mkdtempSync(join(tmpdir(), 'lw-it-steer-'));
  const name = `lw-it-steer-${run}`;
  // Client networks inside the test database's ranges, plus one it doesn't know.
  const nets = {
    gb: { name: `lw-it-steer-gb-${run}`, subnet: '81.2.69.160/27', bind: '81.2.69.180', client: '81.2.69.170' },
    se: { name: `lw-it-steer-se-${run}`, subnet: '89.160.20.128/25', bind: '89.160.20.180', client: '89.160.20.170' },
    other: { name: `lw-it-steer-x-${run}`, subnet: `10.${200 + (process.pid % 50)}.${Date.now() % 250}.0/24` },
  };
  const otherPrefix = nets.other.subnet.split('.').slice(0, 3).join('.');
  const other = { bind: `${otherPrefix}.53`, client: `${otherPrefix}.70` };
  const zone: DnsZoneSpec = { zone: 'example.test', provider: 'ns', secondaries: [], dnssec: false, defaultTtl: 300 };
  const failover = (extra: Partial<DnsFailoverSpec>): DnsFailoverSpec => ({
    host: 'www.example.test',
    mode: 'geo',
    endpoints: [],
    check: { protocol: 'tcp', path: '/', expectStatus: [200, 399] },
    intervalSeconds: 10,
    failAfter: 3,
    recoverAfter: 3,
    failback: 'auto',
    stableSeconds: 600,
    ttl: 30,
    ...extra,
  });
  const geo = failover({
    endpoints: [
      { name: 'uk', address: '203.0.113.1', countries: ['GB'] },
      { name: 'eu', address: '203.0.113.2', continents: ['EU'] },
      { name: 'rest', address: '198.51.100.1' },
    ],
  });
  const weighted = failover({
    host: 'api.example.test',
    mode: 'weighted',
    endpoints: [
      { name: 'a', address: '192.0.2.1', weight: 1 },
      { name: 'b', address: '192.0.2.2', weight: 1 },
    ],
  });
  const hosts: SteeredHost[] = [geo, weighted].map((f) => {
    const answer = steer(
      f,
      f.endpoints.map((e) => e.name),
      undefined,
    );

    return { zone: 'example', fqdn: f.host, addresses: answer.addresses, steering: answer.steering! };
  });
  const record = (fqdn: string, values: string[]): DesiredRecord => ({
    zone: 'example',
    fqdn,
    type: 'A',
    values,
    ttl: 30,
    source: 'lab',
  });
  const nameServers = [{ name: 'ns1.example.test', addresses: [other.bind] }];
  const file = (answers: (h: SteeredHost) => string[]) =>
    renderZoneFile(
      zone,
      zoneBody(
        zone,
        hosts.map((h) => record(h.fqdn, answers(h))),
        nameServers,
      ),
      1_800_000_000,
      'ns1.example.test',
    );
  const dig = (network: string, client: string, server: string, qname: string): string => {
    try {
      return docker([
        'run',
        '--rm',
        '--network',
        network,
        '--ip',
        client,
        '--entrypoint',
        'dig',
        DEFAULT_BIND9_IMAGE,
        `@${server}`,
        '+short',
        '+norecurse',
        '+time=2',
        '+tries=1',
        qname,
        'A',
      ]);
    } catch {
      return '';
    }
  };
  /** IPv4 /10 buckets: the first octet and the top two bits of the second. */
  const bucketOf = (ip: string) => (Number(ip.split('.')[0]) << 2) | (Number(ip.split('.')[1]) >> 6);
  let weightedBuckets: string[][] = [];

  beforeAll(async () => {
    const views = steeringViews(hosts, true);

    if ('error' in views) throw new Error(views.error);

    weightedBuckets = hosts[1].steering.buckets ?? [];

    const config: AuthoritativeDns = {
      listen: [nets.gb.bind, nets.se.bind, other.bind],
      zones: [{ name: 'example.test', file: file((h) => h.addresses) }],
      views: views.map((v) => ({
        name: v.name,
        ...(v.country ? { country: v.country } : {}),
        ...(v.continent ? { continent: v.continent } : {}),
        ...(v.networks ? { networks: v.networks } : {}),
        zones: [{ name: 'example.test', file: file((h) => v.answers.get(h.fqdn) ?? h.addresses) }],
      })),
      geoip: { sha256: GEOIP_TEST_DB_SHA256 },
    };

    chmodSync(dir, 0o755);
    mkdirSync(join(dir, 'zones'), { mode: 0o755 });
    mkdirSync(join(dir, 'geoip'), { mode: 0o755 });
    writeFileSync(join(dir, 'geoip', GEOIP_FILE), readFileSync(geoipTestDb()), { mode: 0o644 });
    writeFileSync(join(dir, 'zones', zoneFileName('example.test')), config.zones[0].file as string, { mode: 0o644 });

    for (const view of config.views ?? []) {
      mkdirSync(join(dir, 'zones', 'views', view.name), { recursive: true, mode: 0o755 });
      writeFileSync(join(dir, 'zones', viewZoneFile(view.name, 'example.test')), view.zones[0].file, { mode: 0o644 });
    }

    writeFileSync(
      join(dir, 'named.conf'),
      renderNamedConf(config, { zones: `${BIND9_DIR}/zones`, signed: `${BIND9_DIR}/signed` }),
    );

    for (const net of [nets.gb, nets.se]) docker(['network', 'create', '--subnet', net.subnet, net.name]);
    docker(['network', 'create', '--subnet', nets.other.subnet, nets.other.name]);
    docker([
      'create',
      '--name',
      name,
      '--network',
      nets.other.name,
      '--ip',
      other.bind,
      '--memory',
      '256m',
      '--cap-drop',
      'ALL',
      '--cap-add',
      'NET_BIND_SERVICE',
      '--cap-add',
      'SETUID',
      '--cap-add',
      'SETGID',
      '--read-only',
      '--tmpfs',
      '/var/cache/bind:mode=1777',
      '--tmpfs',
      '/run/named:mode=1777',
      '--tmpfs',
      '/tmp',
      '--security-opt',
      'no-new-privileges:true',
      '-v',
      `${dir}:${BIND9_DIR}:ro`,
      DEFAULT_BIND9_IMAGE,
      '-g',
      '-c',
      `${BIND9_DIR}/named.conf`,
    ]);
    docker(['network', 'connect', '--ip', nets.gb.bind, nets.gb.name, name]);
    docker(['network', 'connect', '--ip', nets.se.bind, nets.se.name, name]);
    docker(['start', name]);

    for (let i = 0; i < 40 && !dig(nets.other.name, other.client, other.bind, 'www.example.test'); i++)
      await new Promise((r) => setTimeout(r, 500));
  }, 180_000);

  afterAll(() => {
    if (process.env['LW_LAB_KEEP'] === '1') return;

    for (const cmd of [
      ['rm', '-f', name],
      ['network', 'rm', nets.gb.name, nets.se.name, nets.other.name],
    ]) {
      try {
        docker(cmd);
      } catch {
        // gone
      }
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('answers by country, then continent, then the default', () => {
    expect(dig(nets.gb.name, nets.gb.client, nets.gb.bind, 'www.example.test')).toBe('203.0.113.1');
    expect(dig(nets.se.name, nets.se.client, nets.se.bind, 'www.example.test')).toBe('203.0.113.2');
    expect(dig(nets.other.name, other.client, other.bind, 'www.example.test')).toBe('198.51.100.1');
  });

  it('splits clients by address bucket for weighted hosts, in every geo view', () => {
    for (const [net, client, server] of [
      [nets.gb.name, nets.gb.client, nets.gb.bind],
      [nets.se.name, nets.se.client, nets.se.bind],
      [nets.other.name, other.client, other.bind],
    ]) {
      expect(dig(net, client, server, 'api.example.test')).toBe(weightedBuckets[bucketOf(client)][0]);
    }

    // 81.0/10 and 10.192/10 land on different endpoints: both halves are served.
    expect(new Set([nets.gb.client, other.client].map((c) => weightedBuckets[bucketOf(c)][0])).size).toBe(2);
  });
});
