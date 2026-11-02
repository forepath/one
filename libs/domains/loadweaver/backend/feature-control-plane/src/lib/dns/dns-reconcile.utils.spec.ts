import type { DnsRecord } from '@forepath/shared/backend/util-hosting-providers';

import { reconcileZone } from './dns-reconcile.utils';

const want = (fqdn: string, type: 'A' | 'AAAA' | 'TXT', values: string[]) => ({
  zone: 'z',
  fqdn,
  type,
  values,
  ttl: 300,
  source: 'test',
});
const rec = (id: string, name: string, type: DnsRecord['type'], content: string, ttl = 300): DnsRecord => ({
  id,
  name,
  type,
  content,
  ttl,
});
const marker = (id: string, fqdn: string, types: string, cluster = 'c1') =>
  rec(id, `_loadweaver.${fqdn}`, 'TXT', `"heritage=loadweaver,cluster=${cluster},types=${types}"`);

describe('reconcileZone', () => {
  it('creates free names together with their ownership marker', () => {
    const ops = reconcileZone([want('www.example.com', 'A', ['203.0.113.10'])], [], 'c1');

    expect(ops.upsert).toEqual([
      { name: 'www.example.com', type: 'A', content: '203.0.113.10', ttl: 300 },
      { name: '_loadweaver.www.example.com', type: 'TXT', content: 'heritage=loadweaver,cluster=c1,types=A', ttl: 300 },
    ]);
    expect(ops.delete).toEqual([]);
  });

  it('never touches names someone else manages', () => {
    const ops = reconcileZone(
      [want('www.example.com', 'A', ['203.0.113.10'])],
      [rec('x', 'www.example.com', 'A', '192.0.2.1'), marker('m', 'www.example.com', 'A', 'other-cluster')],
      'c1',
    );

    expect(ops).toEqual({
      upsert: [],
      delete: [],
      conflicts: ['A www.example.com exists and is not managed by this cluster'],
    });
  });

  it('moves owned record sets value by value and drops types it no longer wants', () => {
    const actual = [
      rec('a1', 'www.example.com', 'A', '203.0.113.10'),
      rec('a2', 'www.example.com', 'A', '203.0.113.11'),
      rec('v6', 'www.example.com', 'AAAA', '2001:db8::1'),
      rec('t', 'www.example.com', 'TXT', 'someone else'),
      marker('m', 'www.example.com', 'A+AAAA'),
    ];
    const ops = reconcileZone([want('www.example.com', 'A', ['203.0.113.11', '203.0.113.12'])], actual, 'c1');

    expect(ops.upsert).toEqual([
      { name: 'www.example.com', type: 'A', content: '203.0.113.12', ttl: 300 },
      {
        id: 'm',
        name: '_loadweaver.www.example.com',
        type: 'TXT',
        content: 'heritage=loadweaver,cluster=c1,types=A',
        ttl: 300,
      },
    ]);
    // The foreign TXT at the same name stays.
    expect(ops.delete.sort()).toEqual(['a1', 'v6']);
  });

  it('removes names it owns but no longer wants, marker last', () => {
    const ops = reconcileZone(
      [],
      [
        rec('a', 'old.example.com', 'A', '203.0.113.10'),
        rec('t', 'old.example.com', 'TXT', 'keep'),
        marker('m', 'old.example.com', 'A'),
        marker('o', 'theirs.example.com', 'A', 'c2'),
      ],
      'c1',
    );

    expect(ops.delete).toEqual(['a', 'm']);
  });
});
