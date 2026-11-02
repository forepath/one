import { UrlSegment } from '@angular/router';
import type { HealthEntity, HealthTreeNode } from '@forepath/loadweaver/frontend/data-access-console';

import {
  countStates,
  formatDuration,
  formatInstants,
  healthEntityMatcher,
  healthEntityRef,
  healthReasonText,
  unhealthyOnly,
} from './health-format';

const segments = (...paths: string[]) => paths.map((p) => new UrlSegment(p, {}));

function node(key: string, state: HealthEntity['state'], children: HealthTreeNode[] = []): HealthTreeNode {
  return {
    entity: { key, kind: 'node', name: key, parent: null, project: null, state, reasons: [], since: '' },
    children,
  };
}

describe('health format', () => {
  it('matches entity keys with slashes', () => {
    const match = healthEntityMatcher(segments('health', 'deployment', 'shop', 'store'), null as never, null as never);

    expect(match?.posParams?.['key'].path).toBe('deployment/shop/store');
    expect(healthEntityMatcher(segments('health'), null as never, null as never)).toBeNull();
    expect(healthEntityMatcher(segments('alerts', 'x'), null as never, null as never)).toBeNull();
  });

  it('formats durations in the two largest units', () => {
    expect(formatDuration(42_000_000)).toBe('11h 40m');
    expect(formatDuration(2_550_000_000)).toBe('29d 12h');
    expect(formatDuration(5000)).toBe('5s');
    expect(formatDuration(0)).toBe('0s');
  });

  it('keeps only unhealthy entities and their ancestors, and counts states', () => {
    const tree = [node('cluster', 'healthy', [node('site/a', 'healthy'), node('site/b', 'at-risk')])];

    expect(unhealthyOnly(tree)[0].children.map((n) => n.entity.key)).toEqual(['site/b']);
    expect(unhealthyOnly([node('x', 'healthy')])).toEqual([]);
    expect(countStates(tree)).toEqual({ healthy: 2, 'at-risk': 1 });
  });
});

describe('readable health reasons and entities (D7, LW-04)', () => {
  it('translates reason codes, counts roll-ups and never shows `code: message` or raw instants', () => {
    expect(healthReasonText({ code: 'quorum-lost', message: 'the control plane lost its quorum' }, 'en-US')).toBe(
      'Quorum lost',
    );
    expect(
      healthReasonText(
        { code: 'node-down', message: 'node n1 is not reachable (last seen 2026-10-28T12:47:40.270Z)' },
        'en-US',
      ),
    ).toBe('Node down');
    expect(
      healthReasonText(
        { code: 'nodes-failed', message: '2 of 2 nodes failed', entities: ['node/a', 'node/b'] },
        'en-US',
      ),
    ).toBe('Nodes failed (2)');
    // Unknown codes: the message, instants formatted.
    const text = healthReasonText({ code: 'odd', message: 'since 2026-10-28T12:47:40Z' }, 'en-US');

    expect(text).not.toContain('odd');
    expect(text).not.toContain('T12:47');
    expect(formatInstants('no instant here', 'en-US')).toBe('no instant here');
  });

  it('turns entity keys into kind + name (the cluster once)', () => {
    expect(healthEntityRef('site/default')).toEqual({
      kind: 'site',
      name: 'default',
      icon: 'bi-geo-alt',
      label: 'Site default',
    });
    expect(healthEntityRef('deployment/shop/store').label).toBe('Deployment shop/store');
    expect(healthEntityRef('cluster').label).toBe('Cluster');
    expect(healthEntityRef('cluster/cluster').label).toBe('Cluster');
    expect(healthEntityRef('weird/x')).toEqual({ kind: null, name: 'weird/x', icon: null, label: 'weird/x' });
  });
});
