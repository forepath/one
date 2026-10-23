import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  desiredDnsRecords,
  renderZoneFile,
  zoneBody,
  zoneNameServers,
} from '@forepath/loadweaver/backend/feature-control-plane';
import {
  BIND9_DIR,
  DEFAULT_BIND9_IMAGE,
  renderNamedConf,
  zoneFileName,
} from '@forepath/loadweaver/backend/feature-node-agent';
import type { DnsZoneSpec } from '@forepath/loadweaver/shared/util-model';

/**
 * Hosted bind9 on a real bind9 (3.15): the control plane renders the zone, the agent renders named.conf, bind9 runs
 * with the agent's hardening and answers authoritatively; a broken zone is caught by named-checkconf first.
 */

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

describe('hosted bind9 (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const name = `lw-it-bind9-${run}`;
  const dir = mkdtempSync(join(tmpdir(), 'lw-it-bind9-'));
  const zone: DnsZoneSpec = { zone: 'example.test', provider: 'ns', secondaries: [], dnssec: false, defaultTtl: 300 };
  const longTxt = `v=long-${'x'.repeat(300)}`;
  const network = `lw-it-bind9-${run}`;
  const subnet = `10.${170 + (process.pid % 30)}.${Date.now() % 250}.0/24`;
  const server = `${subnet.split('.').slice(0, 3).join('.')}.53`;
  // UDP port publishing doesn't reach the host here, so queries run with dig from a container on the same network.
  const dig = (qname: string, type: string): string[] => {
    try {
      return docker([
        'run',
        '--rm',
        '--network',
        network,
        '--entrypoint',
        'dig',
        DEFAULT_BIND9_IMAGE,
        `@${server}`,
        '+short',
        '+norecurse',
        '+time=2',
        '+tries=1',
        qname,
        type,
      ])
        .split('\n')
        .filter(Boolean)
        .sort();
    } catch {
      // No answer (yet).
      return [];
    }
  };

  beforeAll(async () => {
    const desired = desiredDnsRecords(
      new Map([['example', zone]]),
      [
        { name: 'mx', spec: { zone: 'example', name: '@', type: 'MX', values: ['mx.example.net'], priority: 10 } },
        { name: 'txt', spec: { zone: 'example', name: 'info', type: 'TXT', values: [longTxt, 'say "hi"'] } },
      ],
      ['www.example.test'],
      ['203.0.113.10', '2001:db8::10'],
    );
    const nameServers = zoneNameServers(zone, [
      { name: 'n1', site: 'fra1', labels: null, lifecycle: 'active', controlPlane: true, endpointHost: '198.51.100.1' },
      { name: 'n2', site: 'ams1', labels: null, lifecycle: 'active', controlPlane: true, endpointHost: '198.51.100.2' },
    ]);
    const file = renderZoneFile(zone, zoneBody(zone, desired.records, nameServers), 1_800_000_000, nameServers[0].name);

    chmodSync(dir, 0o755);
    mkdirSync(join(dir, 'zones'), { mode: 0o755 });
    writeFileSync(join(dir, 'zones', zoneFileName('example.test')), file);
    // Like on a node: bind9 listens on the name server's own address only.
    writeFileSync(
      join(dir, 'named.conf'),
      renderNamedConf(
        { listen: [server], zones: [{ name: 'example.test', file }] },
        { zones: `${BIND9_DIR}/zones`, signed: `${BIND9_DIR}/signed` },
      ),
    );

    docker(['network', 'create', '--subnet', subnet, network]);
    docker([
      'run',
      '-d',
      '--name',
      name,
      '--network',
      network,
      '--ip',
      server,
      '--memory',
      '128m',
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

    for (let i = 0; i < 20 && dig('www.example.test', 'A').length === 0; i++)
      await new Promise((r) => setTimeout(r, 500));
  }, 120_000);

  afterAll(() => {
    if (process.env['LW_LAB_KEEP'] === '1') return;

    try {
      docker(['rm', '-f', name]);
      docker(['network', 'rm', network]);
    } catch {
      // gone
    }

    rmSync(dir, { recursive: true, force: true });
  });

  it('answers authoritatively for ingress hostnames and declared records', () => {
    expect(dig('www.example.test', 'A')).toEqual(['203.0.113.10']);
    expect(dig('www.example.test', 'AAAA')).toEqual(['2001:db8::10']);
    expect(dig('example.test', 'MX')).toEqual(['10 mx.example.net.']);
    // Long TXT values arrive as 255-byte strings; quotes stay escaped.
    expect(
      dig('info.example.test', 'TXT')
        .map((t) => t.replace(/" "/g, ''))
        .sort(),
    ).toEqual([`"${longTxt}"`, '"say \\"hi\\""'].sort());
    expect(dig('example.test', 'NS')).toEqual(['ns1.example.test.', 'ns2.example.test.']);
    expect(dig('ns2.example.test', 'A')).toEqual(['198.51.100.2']);
    expect(dig('example.test', 'SOA')[0].split(' ')[2]).toBe('1800000000');
    // Authoritative only: nothing for names elsewhere.
    expect(dig('example.com', 'A')).toEqual([]);
  });

  it('rejects a broken zone before it is served', () => {
    writeFileSync(
      join(dir, 'zones', 'broken.zone'),
      '$ORIGIN broken.test.\n@ 300 IN SOA ns1 h 1 1 1 1 1\nwww 300 IN A not-an-ip\n',
    );
    writeFileSync(
      join(dir, 'named.check.conf'),
      `zone "broken.test" { type primary; file "${BIND9_DIR}/zones/broken.zone"; };\n`,
    );

    expect(() =>
      docker([
        'run',
        '--rm',
        '--network',
        'none',
        '--entrypoint',
        'named-checkconf',
        '-v',
        `${dir}:${BIND9_DIR}:ro`,
        DEFAULT_BIND9_IMAGE,
        '-z',
        `${BIND9_DIR}/named.check.conf`,
      ]),
    ).toThrow();
  });
});
