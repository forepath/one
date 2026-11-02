import type { Incident } from '@forepath/loadweaver/frontend/data-access-console';

import { latestUpdate, mayWriteIncidents, sortIncidents, statusPageUrl } from './status-page-format';

function incident(id: string, status: Incident['status'], createdAt: string): Incident {
  return { id, project: 'shop', title: id, status, updates: [], createdAt, updatedAt: createdAt, resolvedAt: null };
}

describe('status page format', () => {
  it('lets operators, admins and cluster admins write incidents', () => {
    const me = { userId: 'u', clusterRole: null, projects: { shop: 'operator', blog: 'developer' } } as const;

    expect(mayWriteIncidents(me, 'shop')).toBe(true);
    expect(mayWriteIncidents(me, 'blog')).toBe(false);
    expect(mayWriteIncidents(me, 'other')).toBe(false);
    expect(mayWriteIncidents({ userId: 'a', clusterRole: 'cluster-admin', projects: {} }, 'other')).toBe(true);
    expect(mayWriteIncidents({ userId: 'a', clusterRole: 'auditor', projects: {} }, 'shop')).toBe(false);
    expect(mayWriteIncidents(null, 'shop')).toBe(false);
  });

  it('links the public page and sorts open incidents first', () => {
    expect(
      statusPageUrl({
        apiVersion: 'loadweaver.com/v1',
        kind: 'StatusPage',
        metadata: { name: 'public', project: 'shop' },
        spec: { host: 'status.example.com', title: 'Shop', services: [] },
      }),
    ).toBe('https://status.example.com/');
    expect(
      sortIncidents([
        incident('old', 'investigating', '2026-10-01'),
        incident('done', 'resolved', '2026-10-17'),
        incident('new', 'monitoring', '2026-10-10'),
      ]).map((i) => i.id),
    ).toEqual(['new', 'old', 'done']);
    expect(latestUpdate(incident('x', 'identified', '2026-10-01'))).toBeNull();
  });
});
