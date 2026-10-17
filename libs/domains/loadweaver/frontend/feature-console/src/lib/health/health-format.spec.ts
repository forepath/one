import { UrlSegment } from '@angular/router';
import type { HealthEntity, HealthTreeNode } from '@forepath/loadweaver/frontend/data-access-console';

import { countStates, formatDuration, healthEntityMatcher, unhealthyOnly } from './health-format';

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
