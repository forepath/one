import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { renderZoneFile, zoneBody } from '@forepath/loadweaver/backend/feature-control-plane';
import {
  BIND9_DATA_DIR,
  BIND9_DIR,
  bindDataSyncScript,
  DEFAULT_BIND9_IMAGE,
  renderNamedConf,
  renderTsigConf,
  TSIG_CONF,
  zoneFileName,
} from '@forepath/loadweaver/backend/feature-node-agent';
import type { AuthoritativeDns } from '@forepath/loadweaver/shared/util-agent-protocol';
import type { DnsZoneSpec } from '@forepath/loadweaver/shared/util-model';
import {
  bindKeyFileStem,
  dnssecDs,
  dnssecKeyTag,
  generateDnssecKey,
  renderBindKeyFiles,
  type DnssecKeyMaterial,
} from '@forepath/loadweaver/shared/util-pki';

/**
 * DNSSEC and zone transfers on real bind9 (3.15): two hosted instances sign with the same control-plane key (one
 * DNSKEY set, valid against the DS the control plane computes), an external secondary pulls the signed zone with
 * TSIG, a hosted instance is secondary of an external primary, and a pushed successor key rolls over on both
 * instances while the old DS still validates.
 */

function docker(args: string[]): string {
  return execFileSync('docker', args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

describe('hosted bind9 with DNSSEC and transfers (lab)', () => {
  const run = `${process.pid}-${Date.now()}`;
  const network = `lw-it-dnssec-${run}`;
  const subnet = `10.${200 + (process.pid % 30)}.${Date.now() % 250}.0/24`;
  const prefix = subnet.split('.').slice(0, 3).join('.');
  const ip = { a: `${prefix}.10`, b: `${prefix}.11`, x: `${prefix}.20` };
  const names = { a: `lw-it-dnssec-a-${run}`, b: `lw-it-dnssec-b-${run}`, x: `lw-it-dnssec-x-${run}` };
  const root = mkdtempSync(join(tmpdir(), 'lw-it-dnssec-'));
  const zone: DnsZoneSpec = { zone: 'example.test', provider: 'ns', secondaries: [], dnssec: true, defaultTtl: 300 };
  const secret = randomBytes(32).toString('base64');
  const first = generateDnssecKey();
  const created = new Date(Date.now() - 60_000);
  const file = renderZoneFile(
    zone,
    zoneBody(
      zone,
      [{ zone: 'example', fqdn: 'www.example.test', type: 'A', values: ['203.0.113.10'], ttl: 300, source: 'lab' }],
      [{ name: 'ns1.example.test', addresses: [ip.a] }],
    ),
    1_800_000_000,
    'ns1.example.test',
  );

  const config = (listen: string, keys: DnssecKeyMaterial[], secondaryOfX: boolean): AuthoritativeDns => ({
    listen: [listen],
    zones: [
      {
        name: 'example.test',
        file,
        transfers: [{ address: ip.x, key: 'lw-x' }],
        dnssec: {
          mode: 'signed',
          keys: keys.map((k) => ({ ...k, created: created.toISOString() })),
        },
      },
      ...(secondaryOfX ? [{ name: 'ext.test', primaries: [ip.x], transferKey: 'lw-x' }] : []),
    ],
    tsigKeys: [{ name: 'lw-x', algorithm: 'hmac-sha256', secret }],
  });

  /** What the agent writes for an instance (lab: world-writable instead of owned by bind's uid). */
  /**
   * What the agent does for an instance: config files, a staging tree with signed sources and keys, synced into
   * bind's data directory by the agent's sync script as bind's user (lab: world-readable instead of root:bind).
   */
  const writeInstance = (dir: string, cfg: AuthoritativeDns) => {
    const staging = join(dir, 'staging');

    for (const d of [
      dir,
      join(dir, 'zones'),
      join(dir, 'data'),
      staging,
      join(staging, 'signed'),
      join(staging, 'keys'),
    ]) {
      mkdirSync(d, { recursive: true });
      chmodSync(d, d.endsWith('data') ? 0o777 : 0o755);
    }

    writeFileSync(
      join(dir, 'named.conf'),
      renderNamedConf(cfg, { zones: `${BIND9_DIR}/zones`, signed: `${BIND9_DATA_DIR}/signed` }),
    );
    writeFileSync(join(dir, TSIG_CONF), renderTsigConf(cfg), { mode: 0o644 });

    for (const z of cfg.zones) {
      if (z.file)
        writeFileSync(join(z.dnssec ? join(staging, 'signed') : join(dir, 'zones'), zoneFileName(z.name)), z.file, {
          mode: 0o644,
        });

      if (z.dnssec) writeKeys(join(staging, 'keys', z.name), z.dnssec.keys);
    }
  };
  const writeKeys = (dir: string, keys: { publicKey: string; privateKey?: string; created: string }[]) => {
    mkdirSync(dir, { recursive: true });
    chmodSync(dir, 0o755);

    for (const key of keys) {
      const stem = bindKeyFileStem('example.test', key.publicKey);
      const files = renderBindKeyFiles(
        'example.test',
        { publicKey: key.publicKey, privateKey: key.privateKey as string },
        { created: new Date(key.created) },
      );

      writeFileSync(join(dir, `${stem}.private`), files.private, { mode: 0o644 });
      writeFileSync(join(dir, `${stem}.state`), files.state, { mode: 0o644 });
      writeFileSync(join(dir, `${stem}.key`), files.key, { mode: 0o644 });
    }
  };
  const sync = (dir: string): string =>
    docker([
      'run',
      '--rm',
      '--user',
      '53:53',
      '--network',
      'none',
      '--cap-drop',
      'ALL',
      '--security-opt',
      'no-new-privileges:true',
      '-v',
      `${join(dir, 'staging')}:/next:ro`,
      '-v',
      `${join(dir, 'data')}:/data`,
      '--entrypoint',
      'sh',
      DEFAULT_BIND9_IMAGE,
      '-c',
      bindDataSyncScript(),
    ]);

  const start = (name: string, address: string, dir: string, data?: string) =>
    docker([
      'run',
      '-d',
      '--name',
      name,
      '--network',
      network,
      '--ip',
      address,
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
      ...(data ? ['-v', `${data}:${BIND9_DATA_DIR}`] : []),
      DEFAULT_BIND9_IMAGE,
      '-g',
      '-c',
      `${BIND9_DIR}/named.conf`,
    ]);

  const tool = (cmd: string, args: string[], files?: string): string => {
    try {
      return docker([
        'run',
        '--rm',
        '--network',
        network,
        ...(files ? ['-v', `${files}:/lab:ro`] : []),
        '--entrypoint',
        cmd,
        DEFAULT_BIND9_IMAGE,
        ...args,
      ]);
    } catch (error) {
      return String((error as { stdout?: string }).stdout ?? '') + String((error as { stderr?: string }).stderr ?? '');
    }
  };
  const dig = (server: string, ...args: string[]) =>
    tool('dig', [`@${server}`, '+norecurse', '+time=2', '+tries=1', ...args]);
  const dnskeyTags = (server: string) =>
    dig(server, '+short', 'example.test', 'DNSKEY')
      .split('\n')
      .filter(Boolean)
      .map((line) => dnssecKeyTag(line.split(' ').slice(3).join('')))
      .sort();
  /** delv validating from the DS the control plane computes, as the parent would publish it. */
  const validates = (server: string, key: DnssecKeyMaterial): boolean => {
    const ds = dnssecDs('example.test', key.publicKey);

    writeFileSync(
      join(root, 'anchors.conf'),
      `trust-anchors { example.test. static-ds ${ds.keyTag} ${ds.algorithm} ${ds.digestType} "${ds.digest}"; };\n`,
    );

    return tool(
      'delv',
      [`@${server}`, '-a', '/lab/anchors.conf', '+root=example.test', 'www.example.test', 'A'],
      root,
    ).includes('; fully validated');
  };

  const eventually = async (fn: () => boolean, timeoutMs = 30_000) => {
    for (const end = Date.now() + timeoutMs; Date.now() < end; await new Promise((r) => setTimeout(r, 500)))
      if (fn()) return true;

    return fn();
  };

  beforeAll(async () => {
    chmodSync(root, 0o755);
    writeInstance(join(root, 'a'), config(ip.a, [first], true));
    writeInstance(join(root, 'b'), config(ip.b, [first], false));
    expect(sync(join(root, 'a'))).toContain('changed=1');
    expect(sync(join(root, 'b'))).toContain('changed=1');
    // Nothing to do the second time.
    expect(sync(join(root, 'a'))).toContain('changed=0');
    // The external server: secondary of the cluster for example.test, primary for ext.test, both with TSIG.
    mkdirSync(join(root, 'x'));
    writeFileSync(
      join(root, 'x', 'named.conf'),
      [
        `key "lw-x" { algorithm hmac-sha256; secret "${secret}"; };`,
        `options { directory "/var/cache/bind"; listen-on { ${ip.x}; }; listen-on-v6 { none; }; recursion no; dnssec-validation no; allow-transfer { none; }; notify no; };`,
        `zone "example.test" { type secondary; file "/var/cache/bind/example.test.db"; primaries { ${ip.a} key "lw-x"; }; };`,
        `zone "ext.test" { type primary; file "${BIND9_DIR}/ext.test.zone"; allow-transfer { key "lw-x"; }; };`,
        '',
      ].join('\n'),
    );
    writeFileSync(
      join(root, 'x', 'ext.test.zone'),
      '$TTL 300\n@ IN SOA ns.ext.test. h.ext.test. 7 3600 600 86400 300\n@ IN NS ns.ext.test.\nns IN A 192.0.2.1\napi IN A 192.0.2.80\n',
    );
    chmodSync(join(root, 'x'), 0o755);

    docker(['network', 'create', '--subnet', subnet, network]);
    start(names.x, ip.x, join(root, 'x'));
    start(names.a, ip.a, join(root, 'a'), join(root, 'a', 'data'));
    start(names.b, ip.b, join(root, 'b'), join(root, 'b', 'data'));

    await eventually(() => dnskeyTags(ip.a).length > 0 && dnskeyTags(ip.b).length > 0, 60_000);
  }, 180_000);

  afterAll(() => {
    if (process.env['LW_LAB_KEEP'] !== '1') {
      for (const name of Object.values(names)) {
        try {
          docker(['rm', '-f', name]);
        } catch {
          // gone
        }
      }

      try {
        docker(['network', 'rm', network]);
      } catch {
        // gone
      }

      // bind created files as its own user: remove them from inside.
      docker(['run', '--rm', '-v', `${root}:/lab`, '--entrypoint', 'sh', DEFAULT_BIND9_IMAGE, '-c', 'rm -rf /lab/*']);
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('signs on every instance with the same control-plane key, valid against its DS', () => {
    expect(dnskeyTags(ip.a)).toEqual([dnssecKeyTag(first.publicKey)]);
    expect(dnskeyTags(ip.b)).toEqual([dnssecKeyTag(first.publicKey)]);
    expect(validates(ip.a, first)).toBe(true);
    expect(validates(ip.b, first)).toBe(true);
  });

  it('transfers the signed zone to the external secondary with TSIG only', async () => {
    expect(await eventually(() => dig(ip.x, '+dnssec', 'www.example.test', 'A').includes('RRSIG'))).toBe(true);
    expect(validates(ip.x, first)).toBe(true);
    // Neither without the key, nor with the key from another address than the secondary's.
    expect(dig(ip.a, 'example.test', 'AXFR')).toContain('Transfer failed');
    expect(dig(ip.a, '-y', `hmac-sha256:lw-x:${secret}`, 'example.test', 'AXFR')).toContain('Transfer failed');
  });

  it('serves a zone as secondary of an external primary', async () => {
    expect(await eventually(() => dig(ip.a, '+short', 'api.ext.test', 'A') === '192.0.2.80')).toBe(true);
  });

  it('rolls over to a pushed successor on every instance while the old DS still validates', async () => {
    const next = generateDnssecKey();
    const later = new Date().toISOString();

    for (const instance of ['a', 'b'])
      writeKeys(join(root, instance, 'staging', 'keys', 'example.test'), [{ ...next, created: later }]);

    for (const instance of ['a', 'b']) expect(sync(join(root, instance))).toContain('changed=1');

    docker(['kill', '-s', 'HUP', names.a]);
    docker(['kill', '-s', 'HUP', names.b]);

    const both = [dnssecKeyTag(first.publicKey), dnssecKeyTag(next.publicKey)].sort();

    expect(
      await eventually(() => dnskeyTags(ip.a).join() === both.join() && dnskeyTags(ip.b).join() === both.join()),
    ).toBe(true);
    // The parent still has the old DS: the zone stays valid through it, and already through the new one.
    expect(validates(ip.a, first)).toBe(true);
    expect(validates(ip.b, first)).toBe(true);
    expect(await eventually(() => validates(ip.a, next))).toBe(true);
  }, 120_000);

  it('removes what bind planted in its data directory without following it', () => {
    const dir = join(root, 'a');

    // A compromised bind could leave links pointing anywhere; the sync runs as bind's user and sees only two dirs.
    const asBind = (cmd: string) =>
      docker([
        'run',
        '--rm',
        '--user',
        '53:53',
        '--network',
        'none',
        '-v',
        `${join(dir, 'data')}:/data`,
        '--entrypoint',
        'sh',
        DEFAULT_BIND9_IMAGE,
        '-c',
        cmd,
      ]);

    asBind('ln -s /next/keys /data/keys/lw-9 && ln -s /etc /data/signed/evil.zone');
    expect(sync(dir)).toContain('changed=1');
    expect(asBind('ls -A /data/keys /data/signed')).not.toMatch(/lw-9|evil/);
    expect(existsSync(join(dir, 'staging', 'keys', 'example.test'))).toBe(true);
    expect(dnskeyTags(ip.a).length).toBe(2);
  });
});
