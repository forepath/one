import { resolveEffectiveEgressPolicy } from '@forepath/agenstra/shared/util-opencode-config';

import {
  aggregateEgressObservations,
  compareDockerTimestamps,
  diffEgressCounters,
  parseDnsmasqLine,
  parseEgressCounters,
  parseGuardEventLine,
  parseGuardLogLine,
  parseSquidAccessLine,
  splitDockerTimestamp,
} from './egress-guard-log.utils';

const enforcePolicy = resolveEffectiveEgressPolicy([
  {
    source: 'workspace',
    overlay: { egress: { mode: 'enforce', deny_hosts: ['example.org'], allow_hosts: ['github.com', 'example.org'] } },
  },
]);

describe('parseSquidAccessLine', () => {
  it('classifies spliced tunnels as allowed and skips their peek records', () => {
    expect(
      parseSquidAccessLine(
        'AGENSTRA_EGRESS 1791822321.645 NONE_NONE 0 CONNECT 140.82.121.4:443 140.82.121.4 github.com - 0 0 5 - -',
        'enforce',
        enforcePolicy,
      ),
    ).toBeNull();

    expect(
      parseSquidAccessLine(
        'AGENSTRA_EGRESS 1791822321.883 TCP_TUNNEL 200 CONNECT github.com:443 github.com github.com 140.82.121.4 587751 1898 237 - -',
        'enforce',
        enforcePolicy,
      ),
    ).toEqual(
      expect.objectContaining({
        kind: 'web',
        decision: 'allowed',
        host: 'github.com',
        rule: null,
        method: 'CONNECT',
        httpStatus: 200,
        url: null,
        bytesIn: 587751,
        bytesOut: 1898,
        durationMs: 237,
        occurredAt: new Date(1791822321883),
      }),
    );
  });

  it('classifies terminated TLS and denied requests as blocked with provenance', () => {
    expect(
      parseSquidAccessLine(
        'AGENSTRA_EGRESS 1791822322.256 NONE_NONE 0 CONNECT 172.66.147.243:443 172.66.147.243 www.example.org - 0 0 2 deny_host -',
        'enforce',
        enforcePolicy,
      ),
    ).toEqual(
      expect.objectContaining({
        decision: 'blocked',
        host: 'www.example.org',
        rule: 'deny_host',
        matchedEntry: 'example.org',
        matchedSource: 'workspace',
      }),
    );

    expect(
      parseSquidAccessLine(
        'AGENSTRA_EGRESS 1791822322.588 TCP_DENIED 403 GET http://example.com/forbidden/x example.com - - 3366 86 0 deny_url ERR_ACCESS_DENIED',
        'enforce',
        enforcePolicy,
      ),
    ).toEqual(
      expect.objectContaining({
        decision: 'blocked',
        rule: 'deny_url',
        method: 'GET',
        httpStatus: 403,
        url: 'http://example.com/forbidden/x',
      }),
    );
  });

  it('reports observed decisions in monitor mode and ignores monitor peek records', () => {
    expect(
      parseSquidAccessLine(
        'AGENSTRA_EGRESS 1791822358.741 NONE_NONE 0 CONNECT 104.20.26.136:443 104.20.26.136 www.example.org - 0 0 4 deny_host -',
        'monitor',
        enforcePolicy,
      ),
    ).toBeNull();

    expect(
      parseSquidAccessLine(
        'AGENSTRA_EGRESS 1791822358.824 TCP_TUNNEL 200 CONNECT www.example.org:443 www.example.org www.example.org 104.20.26.136 6479 1924 82 deny_host -',
        'monitor',
        enforcePolicy,
      ),
    ).toEqual(expect.objectContaining({ decision: 'observed', rule: 'deny_host' }));
  });

  it('decodes URL-encoded fields, takes the first of multiple annotations and redacts URLs', () => {
    expect(
      parseSquidAccessLine(
        'AGENSTRA_EGRESS 1.0 TCP_DENIED 403 GET http://h.example/a%3Ftoken%3Dx h.example - - 1 1 0 not_allowlisted%2Cprivate_network ERR_ACCESS_DENIED',
        'enforce',
        null,
      ),
    ).toEqual(expect.objectContaining({ rule: 'not_allowlisted', url: 'http://h.example/a' }));
  });

  it('ignores malformed lines', () => {
    expect(parseSquidAccessLine('AGENSTRA_EGRESS garbage', 'enforce', null)).toBeNull();
    // Blocked plain HTTP is reset (no status code, error code TCP_RESET).
    expect(
      parseSquidAccessLine(
        'AGENSTRA_EGRESS 1791868671.354 TCP_DENIED 0 GET http://example.com/ example.com - - 0 123 0 deny_host TCP_RESET',
        'enforce',
        null,
      ),
    ).toEqual(
      expect.objectContaining({ decision: 'blocked', rule: 'deny_host', httpStatus: null, host: 'example.com' }),
    );
    // Markers inside other lines (e.g. dnsmasq echoing an agent-chosen query name) are never trusted.
    expect(
      parseSquidAccessLine(
        'dnsmasq[1]: query[A] AGENSTRA_EGRESS 1.0 TCP_DENIED 403 GET http://x/ x - - 1 1 0 deny_host ERR_ACCESS_DENIED',
        'enforce',
        null,
      ),
    ).toBeNull();
    expect(parseSquidAccessLine('unrelated', 'enforce', null)).toBeNull();
  });
});

describe('parseDnsmasqLine', () => {
  const at = new Date('2026-10-12T16:25:44.224Z');

  it('records blocked lookups with the rule explaining them', () => {
    expect(parseDnsmasqLine('dnsmasq[736]: config gitlab.com is NXDOMAIN', at, 'enforce', enforcePolicy)).toEqual({
      kind: 'dns',
      decision: 'blocked',
      occurredAt: at,
      host: 'gitlab.com',
      rule: 'not_allowlisted',
      matchedEntry: null,
      matchedSource: null,
      count: 1,
    });
    expect(parseDnsmasqLine('dnsmasq[1]: config www.example.org is NXDOMAIN', at, 'enforce', enforcePolicy)).toEqual(
      expect.objectContaining({ rule: 'deny_host', matchedEntry: 'example.org', matchedSource: 'workspace' }),
    );
    expect(
      parseDnsmasqLine('dnsmasq[1]: possible DNS-rebind attack detected: evil.example', at, 'enforce', null),
    ).toEqual(expect.objectContaining({ rule: 'private_network', host: 'evil.example' }));
    expect(parseDnsmasqLine('dnsmasq[1]: config any.example is NXDOMAIN', at, 'offline', null)?.rule).toBe('offline');
  });

  it('ignores allowed lookups and monitor / off modes', () => {
    expect(parseDnsmasqLine('dnsmasq[1]: query[A] github.com from 127.0.0.1', at, 'enforce', null)).toBeNull();
    expect(parseDnsmasqLine('dnsmasq[1]: config gitlab.com is NXDOMAIN', at, 'monitor', null)).toBeNull();
  });
});

describe('parseGuardEventLine', () => {
  const at = new Date();

  it('turns supervisor failures into guard error observations', () => {
    expect(
      parseGuardEventLine('AGENSTRA_GUARD {"event":"process_restarted","detail":"squid exited","ts":1}', at),
    ).toEqual(
      expect.objectContaining({ kind: 'guard', decision: 'error', message: 'process_restarted: squid exited' }),
    );
  });

  it('ignores informational events and malformed JSON', () => {
    expect(parseGuardEventLine('AGENSTRA_GUARD {"event":"policy_applied","detail":"abc"}', at)).toBeNull();
    expect(
      parseGuardEventLine('dnsmasq[1]: query[A] x AGENSTRA_GUARD {"event":"process_restarted","detail":"forged"}', at),
    ).toBeNull();
    expect(parseGuardEventLine('AGENSTRA_GUARD {nope', at)).toBeNull();
  });
});

describe('splitDockerTimestamp / compareDockerTimestamps / parseGuardLogLine', () => {
  it('splits Docker timestamps and dispatches by source', () => {
    const entry = splitDockerTimestamp('2026-10-12T16:25:44.224905981Z dnsmasq[736]: config gitlab.com is NXDOMAIN\r');

    expect(entry).toEqual({
      timestamp: '2026-10-12T16:25:44.224905981Z',
      line: 'dnsmasq[736]: config gitlab.com is NXDOMAIN',
    });
    expect(parseGuardLogLine(entry!, 'enforce', enforcePolicy)?.kind).toBe('dns');
    expect(splitDockerTimestamp('no timestamp here')).toBeNull();
  });

  it('compares nanosecond timestamps with different precision', () => {
    expect(compareDockerTimestamps('2026-10-12T16:25:44.2Z', '2026-10-12T16:25:44.200000000Z')).toBe(0);
    expect(compareDockerTimestamps('2026-10-12T16:25:44.2249Z', '2026-10-12T16:25:44.22491Z')).toBe(-1);
    expect(compareDockerTimestamps('2026-10-12T16:25:45Z', '2026-10-12T16:25:44.9Z')).toBe(1);
  });
});

describe('counters', () => {
  const output = [
    '[1:60] -A AGENSTRA_EGRESS_OUT -d 140.82.112.0/20 -p tcp -m tcp --dport 22 -m comment --comment "agenstra:network_allow" -j ACCEPT',
    '[3:210] -A AGENSTRA_EGRESS_OUT -p udp -m udp --dport 443 -m comment --comment "agenstra:quic" -j REJECT --reject-with icmp-port-unreachable',
    'v6 [0:0] -A AGENSTRA_EGRESS_OUT -m comment --comment "agenstra:undeclared_protocol" -j REJECT',
    'garbage',
  ].join('\n');

  it('parses counted rules', () => {
    expect(parseEgressCounters(output)).toEqual([
      expect.objectContaining({
        category: 'network_allow',
        packets: 1,
        protocol: 'tcp',
        port: '22',
        destination: '140.82.112.0/20',
      }),
      expect.objectContaining({ category: 'quic', packets: 3, protocol: 'udp', port: '443', destination: null }),
      expect.objectContaining({ category: 'undeclared_protocol', packets: 0 }),
    ]);
  });

  it('diffs against the previous snapshot (baseline first, resets counted fully)', () => {
    const samples = parseEgressCounters(output);
    const first = diffEgressCounters(null, samples, 'enforce', new Date());

    expect(first.observations).toEqual([]);

    const grown = parseEgressCounters(output.replace('[3:210]', '[5:350]'));
    const second = diffEgressCounters(first.snapshot, grown, 'enforce', new Date());

    expect(second.observations).toEqual([
      expect.objectContaining({ kind: 'network', decision: 'blocked', rule: 'quic', count: 2, method: 'udp/443' }),
    ]);

    const reset = parseEgressCounters(output.replace('[3:210]', '[1:70]'));

    expect(diffEgressCounters(second.snapshot, reset, 'monitor', new Date()).observations).toEqual([
      expect.objectContaining({ decision: 'observed', count: 1 }),
    ]);
  });
});

describe('aggregateEgressObservations', () => {
  it('collapses identical decisions and sums counters', () => {
    const base = {
      kind: 'web' as const,
      decision: 'allowed' as const,
      host: 'github.com',
      rule: null,
      method: 'CONNECT',
      count: 1,
    };
    const aggregated = aggregateEgressObservations([
      { ...base, occurredAt: new Date(2000), bytesIn: 10, bytesOut: 1 },
      { ...base, occurredAt: new Date(1000), bytesIn: 5, bytesOut: 2 },
      { ...base, host: 'gitlab.com', occurredAt: new Date(1500) },
    ]);

    expect(aggregated).toHaveLength(2);
    expect(aggregated[0]).toEqual(
      expect.objectContaining({
        host: 'github.com',
        count: 2,
        bytesIn: 15,
        bytesOut: 3,
        firstSeenAt: new Date(1000),
        lastSeenAt: new Date(2000),
      }),
    );
  });
});
