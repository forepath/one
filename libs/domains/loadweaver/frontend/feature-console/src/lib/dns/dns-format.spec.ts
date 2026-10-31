import type { DnsRecordResource, DnsZoneRow } from '@forepath/loadweaver/frontend/data-access-console';

import { recordFqdn, recordSyncState, syncLabel } from './dns-format';

const record = {
  metadata: { name: 'www', project: 'shop' },
  spec: { zone: 'example', name: 'www', type: 'A', values: ['203.0.113.10'] },
} as DnsRecordResource;

const row = (overrides: Partial<DnsZoneRow> = {}): DnsZoneRow => ({
  zone: 'example',
  primary: 'bind',
  dnssec: false,
  statuses: [
    {
      zone: 'example',
      provider: 'bind',
      syncedAt: '2026-10-01T10:00:00.000Z',
      error: null,
      conflicts: [],
      changes: 0,
      drift: null,
    },
  ],
  conflicts: 0,
  failing: false,
  ...overrides,
});

describe('DNS format', () => {
  it('builds names', () => {
    expect(recordFqdn('www', 'example.com')).toBe('www.example.com');
    expect(recordFqdn('@', 'example.com')).toBe('example.com');
  });

  it('derives the sync state of a record', () => {
    expect(recordSyncState(record, null, 'example.com')).toBe('unknown');
    expect(recordSyncState(record, row(), 'example.com')).toBe('synced');
    expect(recordSyncState(record, row({ failing: true }), 'example.com')).toBe('failing');
    expect(recordSyncState(record, row({ statuses: [{ ...row().statuses[0], syncedAt: null }] }), 'example.com')).toBe(
      'pending',
    );
    expect(
      recordSyncState(
        record,
        row({ statuses: [{ ...row().statuses[0], conflicts: ['www.example.com'] }], failing: true }),
        'example.com',
      ),
    ).toBe('conflict');
    expect(syncLabel('conflict')).toBe('Owned by someone else');
  });
});
