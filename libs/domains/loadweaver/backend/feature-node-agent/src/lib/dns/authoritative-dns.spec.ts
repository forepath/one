import type { AuthoritativeDns } from '@forepath/loadweaver/shared/util-agent-protocol';
import { generateDnssecKey } from '@forepath/loadweaver/shared/util-pki';

import type { ManagedContainers } from '../host/managed-containers';
import type { AgentStateStore } from '../state/agent-state.store';
import { AuthoritativeDnsManager } from './authoritative-dns.manager';
import { renderNamedConf, renderTsigConf } from './bind9-config';

const key = generateDnssecKey();
const config: AuthoritativeDns = {
  listen: ['198.51.100.1', '2001:db8::1'],
  zones: [
    {
      name: 'example.com',
      file: 'zone',
      transfers: [
        { address: '192.0.2.53', key: 'lw-axfr' },
        { address: '192.0.2.54', key: 'lw-other' },
      ],
      dnssec: { mode: 'signed', keys: [{ ...key, created: '2026-10-17T00:00:00.000Z' }] },
    },
    { name: 'ext.example', primaries: ['192.0.2.1', '2001:db8::53'], transferKey: 'lw-axfr' },
    { name: 'plain.example', file: 'zone' },
  ],
  tsigKeys: [
    { name: 'lw-axfr', algorithm: 'hmac-sha256', secret: 'c2VjcmV0' },
    { name: 'lw-other', algorithm: 'hmac-sha512', secret: 'b3RoZXI=' },
  ],
};
const paths = { zones: '/etc/bind/lw/zones', signed: '/var/lib/bind/signed' };

describe('bind9 configuration', () => {
  it('signs DNSSEC zones with the pushed keys only and validates DS lookups', () => {
    const conf = renderNamedConf(config, paths);

    expect(conf).toContain('dnssec-validation auto;');
    expect(conf).toContain('keys { csk key-directory lifetime unlimited algorithm ecdsap256sha256; };');
    expect(conf).toContain(
      [
        'zone "example.com" {',
        '  type primary;',
        '  file "/var/lib/bind/signed/example.com.zone";',
        '  dnssec-policy "lw";',
        '  key-directory "/var/lib/bind/keys/example.com";',
        '  inline-signing yes;',
      ].join('\n'),
    );
    expect(conf).toContain(
      'zone "plain.example" {\n  type primary;\n  file "/etc/bind/lw/zones/plain.example.zone";\n};',
    );
    expect(
      renderNamedConf(
        { ...config, zones: [{ ...config.zones[0], dnssec: { ...config.zones[0].dnssec!, mode: 'insecure' } }] },
        paths,
      ),
    ).toContain('dnssec-policy "insecure";');
  });

  it('transfers only to the listed servers with the key, and pulls from external primaries with it', () => {
    const conf = renderNamedConf(config, paths);

    expect(conf).toContain('allow-transfer { !{ !192.0.2.53; !192.0.2.54; any; }; key "lw-axfr"; key "lw-other"; };');
    expect(conf).toContain('also-notify { 192.0.2.53 key "lw-axfr"; 192.0.2.54 key "lw-other"; };');
    expect(conf).toContain('notify explicit;');
    expect(conf).toContain('primaries { 192.0.2.1 key "lw-axfr"; 2001:db8::53 key "lw-axfr"; };');
    expect(conf).toContain('file "/var/lib/bind/secondary/ext.example.db";');
    expect(conf.startsWith('// Managed')).toBe(true);
    expect(conf).toContain('include "/etc/bind/lw/tsig.conf";');
    // The secret never lands in named.conf.
    expect(conf).not.toContain('c2VjcmV0');
    expect(renderTsigConf(config)).toBe(
      'key "lw-axfr" { algorithm hmac-sha256; secret "c2VjcmV0"; };\nkey "lw-other" { algorithm hmac-sha512; secret "b3RoZXI="; };\n',
    );
  });

  it('stays without transfers, NOTIFY and validation when nothing needs them', () => {
    const conf = renderNamedConf({ listen: ['198.51.100.1'], zones: [{ name: 'plain.example', file: 'zone' }] }, paths);

    expect(conf).toContain('notify no;');
    expect(conf).toContain('dnssec-validation no;');
    expect(conf).not.toContain('dnssec-policy');
    expect(conf).not.toContain('include');
  });

  it('serves steering views, sharing every zone they do not override', () => {
    const conf = renderNamedConf(
      {
        ...config,
        views: [
          {
            name: 'lw-1',
            country: 'DE',
            continent: 'EU',
            networks: ['0.0.0.0/10', '2000::/13'],
            zones: [{ name: 'example.com', file: 'v' }],
          },
          { name: 'lw-2', networks: ['0.64.0.0/10'], zones: [{ name: 'plain.example', file: 'v' }] },
        ],
        geoip: { sha256: 'a'.repeat(64) },
      },
      paths,
    );

    expect(conf).toContain('geoip-directory "/etc/bind/lw/geoip";');
    expect(conf).toContain('view "lw-base" {\n  match-clients { none; };\n  zone "example.com" {');
    expect(conf).toContain(
      'view "lw-1" {\n  match-clients { !{ !geoip country DE; any; }; !{ !geoip continent EU; any; }; 0.0.0.0/10; 2000::/13; };',
    );
    // The view's own variant of a signed zone: its own file and key directory, no transfers.
    expect(conf).toContain('    file "/var/lib/bind/signed/views/lw-1/example.com.zone";');
    expect(conf).toContain('    key-directory "/var/lib/bind/keys/lw-1/example.com";');
    expect(conf).toContain('  zone "ext.example" { in-view "lw-base"; };');
    expect(conf).toContain('view "lw-2" {\n  match-clients { 0.64.0.0/10; };');
    expect(conf).toContain('    file "/etc/bind/lw/zones/views/lw-2/plain.example.zone";');
    expect(conf).toContain(
      ['view "default" {', '  match-clients { any; };', '  zone "example.com" { in-view "lw-base"; };'].join('\n'),
    );
    expect(conf.match(/allow-transfer \{ !/g)).toHaveLength(1);
  });

  describe('manager', () => {
    const manager = new AuthoritativeDnsManager({} as ManagedContainers, { dir: '/nonexistent' } as AgentStateStore);

    it('keeps the running zones when a DNSSEC key or TSIG secret did not arrive', async () => {
      const withoutKey = structuredClone(config);

      delete withoutKey.zones[0].dnssec?.keys[0].privateKey;
      await expect(manager.apply(withoutKey)).rejects.toThrow('DNSSEC key for example.com is missing');

      const foreignKey = structuredClone(config);

      foreignKey.zones[0].dnssec!.keys[0].privateKey = generateDnssecKey().privateKey;
      await expect(manager.apply(foreignKey)).rejects.toThrow('does not match');

      await expect(
        manager.apply({ ...config, tsigKeys: [{ name: 'lw-axfr', algorithm: 'hmac-sha256' }] }),
      ).rejects.toThrow('TSIG key lw-axfr for example.com is missing');
    });
  });
});
