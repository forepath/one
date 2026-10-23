import type { PolicyResource } from '@forepath/loadweaver/frontend/data-access-console';

import { peerGroupKey, peerIcon, peerLabel, policySummary, ruleLabel, selectorLabel } from './policy-format';

describe('policy format', () => {
  it('describes selectors', () => {
    expect(
      selectorLabel({
        names: ['web'],
        matchLabels: { app: 'shop' },
        matchExpressions: [
          { key: 'tier', operator: 'In', values: ['a', 'b'] },
          { key: 'canary', operator: 'DoesNotExist' },
        ],
      }),
    ).toBe('name In (web), app=shop, tier In (a, b), canary DoesNotExist');
    expect(selectorLabel({})).toBe('everything');
  });

  it('describes peers and rules', () => {
    expect(peerLabel({ group: 'web' })).toBe('group web');
    expect(peerLabel({ group: 'api', project: 'blog' })).toBe('group blog/api');
    expect(peerLabel({ builtin: 'internet' })).toBe('internet');
    expect(peerLabel({ site: 'fra1' })).toBe('site fra1');
    expect(peerLabel({ selector: { matchLabels: { app: 'db' } } })).toBe('selector app=db');
    expect(peerLabel({ cidr: '10.0.0.0/8' })).toBe('10.0.0.0/8');
    expect(peerLabel({ host: '*.example.com' })).toBe('host *.example.com');
    expect(peerLabel({ clients: 'staff' })).toBe('clients staff');
    expect(peerIcon({ builtin: 'internet' })).toBe('bi-globe');
    expect(ruleLabel({ protocol: 'tcp', ports: [443, '8000-8100'] })).toBe('tcp 443, 8000-8100');
    expect(ruleLabel({ http: { methods: ['GET'], paths: ['/api'], hosts: ['shop.example.com'] } })).toBe(
      'tcp · GET /api on shop.example.com',
    );
    expect(ruleLabel({ protocol: 'icmp' })).toBe('icmp');
  });

  it('summarizes policies and finds group keys', () => {
    const policy = {
      metadata: { name: 'p', project: 'shop' },
      spec: { from: [{ builtin: 'internet' }], to: [{ group: 'web' }, { group: 'api' }], rules: [] },
    } as unknown as PolicyResource;

    expect(policySummary(policy)).toBe('internet → group web, group api');
    expect(peerGroupKey({ group: 'web' }, 'shop')).toBe('shop/web');
    expect(peerGroupKey({ group: 'api', project: 'blog' }, 'shop')).toBe('blog/api');
    expect(peerGroupKey({ group: 'web' }, null)).toBeNull();
    expect(peerGroupKey({ builtin: 'internet' }, 'shop')).toBeNull();
  });
});
