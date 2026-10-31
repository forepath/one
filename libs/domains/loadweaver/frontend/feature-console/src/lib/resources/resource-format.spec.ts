import type { ConsoleResource } from '@forepath/loadweaver/frontend/data-access-console';

import {
  kindIcon,
  matchesResourceSearch,
  projectParams,
  resourceDescription,
  resourceKey,
  resourceLabel,
  resourceLink,
} from './resource-format';

const policy: ConsoleResource = {
  apiVersion: 'loadweaver.com/v1',
  kind: 'Policy',
  metadata: { name: 'allow-web', project: 'shop', labels: { team: 'checkout' } },
  spec: { description: 'Internet to the shop', from: [], to: [], rules: [] },
};

describe('resource format', () => {
  it('builds keys, labels and links', () => {
    const key = resourceKey(policy);

    expect(key).toEqual({ kind: 'Policy', name: 'allow-web', project: 'shop' });
    expect(resourceLabel(key)).toBe('Policy shop/allow-web');
    expect(resourceLabel({ kind: 'Site', name: 'fra1', project: null })).toBe('Site fra1');
    expect(resourceLink(key)).toEqual(['/resources', 'policy', 'shop', 'allow-web']);
    expect(projectParams('shop')).toEqual({ project: 'shop' });
    expect(projectParams(null)).toEqual({});
  });

  it('reads descriptions, icons and searches', () => {
    expect(resourceDescription(policy)).toBe('Internet to the shop');
    expect(resourceDescription({ ...policy, spec: {} })).toBeNull();
    expect(kindIcon('Policy')).toBe('bi-shield-check');
    expect(kindIcon('Unknown')).toBe('bi-file-earmark-code');
    expect(matchesResourceSearch(policy, 'team=check')).toBe(true);
    expect(matchesResourceSearch(policy, 'INTERNET')).toBe(true);
    expect(matchesResourceSearch(policy, 'blog')).toBe(false);
    expect(matchesResourceSearch(policy, ' ')).toBe(true);
  });
});
