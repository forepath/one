import type { TopologyEdge } from '@forepath/loadweaver/frontend/data-access-console';

import {
  topologyDetails,
  topologyEdgeKind,
  topologyEdgeLinks,
  topologyHighlight,
  topologyStatus,
} from './topology-format';

function edge(overrides: Partial<TopologyEdge>): TopologyEdge {
  return { id: 'e', kind: 'policy', source: 'a', target: 'b', layer: 'policies', data: {}, ...overrides };
}

describe('topology format', () => {
  it('maps edges to canvas kinds', () => {
    expect(topologyEdgeKind(edge({ data: { mode: 'enforce' } }))).toBe('policy');
    expect(topologyEdgeKind(edge({ data: { mode: 'monitor' } }))).toBe('monitor');
    expect(topologyEdgeKind(edge({ data: { proposed: true, mode: 'monitor' } }))).toBe('proposed');
    expect(topologyEdgeKind(edge({ kind: 'flow', data: { decision: 'denied' } }))).toBe('denied');
    expect(topologyEdgeKind(edge({ kind: 'flow', data: { decision: 'observed' } }))).toBe('flow');
    expect(topologyEdgeKind(edge({ kind: 'tunnel', layer: 'tunnels' }))).toBe('tunnel');
  });

  it('keeps the plan marks and adds the traced path', () => {
    expect(topologyHighlight(null, [])).toBeNull();
    expect(topologyHighlight({ a: 'delete' }, ['a', 'b'])).toEqual({ a: 'delete', b: 'update' });
  });

  it('links a flow to the decisions around its time and a tunnel to its logs', () => {
    const [decisions] = topologyEdgeLinks(
      edge({ kind: 'flow', data: { decision: 'denied', policy: null } }),
      '2026-10-18T10:00:00.000Z',
    );

    expect(decisions.queryParams).toEqual({
      sources: 'firewall,proxy',
      from: '2026-10-18T09:55:00.000Z',
      to: '2026-10-18T10:01:00.000Z',
    });
    expect(
      topologyEdgeLinks(edge({ kind: 'tunnel', source: 'node:n1', target: 'node:n2' }), null)[0].queryParams,
    ).toEqual({ sources: 'tunnel', node: 'n1' });
  });

  it('shows scalar details readably', () => {
    expect(topologyDetails({ bytes: 3072, overlay: ['10.0.0.1'], packets: 1.25, nested: { a: 1 }, empty: '' })).toEqual(
      [
        { key: 'bytes', value: '3.0 KiB' },
        { key: 'overlay', value: '10.0.0.1' },
        { key: 'packets', value: '1.3' },
      ],
    );
  });
});

describe('topologyStatus', () => {
  it('maps health to a status dot; healthy stays unmarked', () => {
    expect(topologyStatus('failed')).toBe('danger');
    expect(topologyStatus('degraded')).toBe('warning');
    expect(topologyStatus('at-risk')).toBe('warning');
    expect(topologyStatus('unknown')).toBe('secondary');
    expect(topologyStatus('healthy')).toBeNull();
    expect(topologyStatus(undefined)).toBeNull();
  });
});
