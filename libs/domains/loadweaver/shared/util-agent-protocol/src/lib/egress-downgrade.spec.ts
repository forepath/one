import { foldEgressPoliciesForLegacy } from './egress-downgrade';
import { forNode, type NegotiatedProtocol } from './versioning';

const source = (address: string, extra: Record<string, unknown> = {}) => ({
  address,
  ports: [{ port: 443 as const, destinations: ['0.0.0.0/0'] }],
  allow: [{ host: 'example.com', ports: [443], policy: 'p', monitor: false }],
  deny: [],
  allowCidrs: ['10.20.0.0/16', '192.0.2.0/24'],
  unrestricted: false,
  ...extra,
});
const filter = (sources: ReturnType<typeof source>[], mode: 'monitor' | 'enforce' | 'offline' = 'monitor') => ({
  mode,
  blockPrivateNetworks: false,
  blockIpLiterals: false,
  logAllowed: false,
  clusterRanges: [],
  sources,
});

describe('per-source egress settings for agents without egress-policies (M6 review M5)', () => {
  it('folds stricter modes and blocks into the node level, never looser', () => {
    const { filter: folded, unexpressible } = foldEgressPoliciesForLegacy(
      filter([
        source('10.0.0.2', { mode: 'enforce', blockPrivateNetworks: true }),
        source('10.0.0.3', { blockIpLiterals: true, logAllowed: true }),
        source('10.0.0.4'),
      ]),
    );

    expect(folded).toMatchObject({
      mode: 'enforce',
      blockPrivateNetworks: true,
      blockIpLiterals: true,
      logAllowed: true,
    });
    expect(unexpressible).toEqual([]);
    // A per-source mode looser than the node level just falls back to the node level (stricter).
    expect(foldEgressPoliciesForLegacy(filter([source('10.0.0.2', { mode: 'monitor' })], 'enforce')).filter.mode).toBe(
      'enforce',
    );
  });

  it('takes the allow lists of offline sources and the CIDRs enforced denies overlap', () => {
    const { filter: folded, unexpressible } = foldEgressPoliciesForLegacy(
      filter([
        source('10.0.0.2', { mode: 'offline', denyUrlRegexes: ['^https://x/'] }),
        source('10.0.0.3', {
          denyCidrs: [
            { cidr: '10.20.30.0/24', ports: [443], policy: 'p', monitor: false },
            { cidr: '192.0.2.0/24', ports: [443], policy: 'p', monitor: true },
          ],
        }),
      ]),
    );

    expect(folded.mode).toBe('enforce');
    expect(folded.sources[0]).toMatchObject({ allow: [], allowCidrs: [], unrestricted: false });
    // The enforced deny overlaps 10.20.0.0/16 (removed); the monitor-only deny removes nothing.
    expect(folded.sources[1].allowCidrs).toEqual(['192.0.2.0/24']);
    expect(unexpressible).toEqual([]);
  });

  it('reports what the legacy shape cannot express', () => {
    const { unexpressible } = foldEgressPoliciesForLegacy(
      filter([
        source('10.0.0.2', { denyUrlRegexes: ['^https://example\\.com/admin'] }),
        source('10.0.0.3', {
          unrestricted: true,
          denyCidrs: [{ cidr: '203.0.113.0/24', ports: [443], policy: 'p', monitor: false }],
        }),
      ]),
    );

    expect(unexpressible).toEqual([
      { address: '10.0.0.2', setting: 'denyUrlRegexes' },
      { address: '10.0.0.3', setting: 'denyCidrs' },
    ]);
  });

  it('applies the fold before stripping the gated fields for nodes without the feature only', () => {
    const payload = {
      revision: 1,
      network: { egressFilter: filter([source('10.0.0.2', { mode: 'offline', blockPrivateNetworks: true })]) },
    };
    const legacy: NegotiatedProtocol = { version: 2, features: new Set() };
    const current: NegotiatedProtocol = { version: 2, features: new Set(['egress-policies']) };
    const sent = forNode({ type: 'desiredState', payload: payload as never }, legacy)
      .payload as unknown as typeof payload;

    expect(sent.network.egressFilter).toMatchObject({ mode: 'enforce', blockPrivateNetworks: true });
    expect(sent.network.egressFilter.sources[0]).toEqual(
      expect.not.objectContaining({ mode: expect.anything(), blockPrivateNetworks: expect.anything() }),
    );
    expect(sent.network.egressFilter.sources[0]).toMatchObject({ allow: [], allowCidrs: [] });
    expect(forNode({ type: 'desiredState', payload: payload as never }, current).payload).toBe(payload);
  });
});
