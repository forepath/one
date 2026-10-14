import {
  alignSecuritySeries,
  egressDecisionColor,
  formatBytes,
  formatEgressDecision,
  formatEgressKind,
  formatEgressRule,
  hasEgressData,
} from './audit-security.util';

describe('audit-security.util', () => {
  it('aligns security points with bucket keys and fills gaps with zero', () => {
    const aligned = alignSecuritySeries(
      [
        {
          period: '2026-10-11T10:00:00.000Z',
          filterDrops: 1,
          filterFlags: 0,
          egressAllowed: 5,
          egressBlocked: 2,
          egressObserved: 0,
        },
        {
          period: '2026-10-11T18:00:00.000Z',
          filterDrops: 0,
          filterFlags: 1,
          egressAllowed: 1,
          egressBlocked: 1,
          egressObserved: 3,
        },
      ],
      ['2026-10-10T00:00:00.000Z', '2026-10-11T00:00:00.000Z'],
      'day',
    );

    expect(aligned).toEqual({
      categories: ['2026-10-10T00:00:00.000Z', '2026-10-11T00:00:00.000Z'],
      filterDrops: [0, 1],
      filterFlags: [0, 1],
      egressAllowed: [0, 6],
      egressBlocked: [0, 3],
      egressObserved: [0, 3],
    });
  });

  it('falls back to API periods when no bucket keys exist', () => {
    const aligned = alignSecuritySeries(
      [
        {
          period: '2026-10-11T11:30:00.000Z',
          filterDrops: 2,
          filterFlags: 0,
          egressAllowed: 0,
          egressBlocked: 0,
          egressObserved: 0,
        },
        {
          period: '2026-10-11T10:05:00.000Z',
          filterDrops: 1,
          filterFlags: 0,
          egressAllowed: 0,
          egressBlocked: 0,
          egressObserved: 0,
        },
      ],
      [],
      'hour',
    );

    expect(aligned.categories).toEqual(['2026-10-11T10:00:00.000Z', '2026-10-11T11:00:00.000Z']);
    expect(aligned.filterDrops).toEqual([1, 2]);
  });

  it('detects egress data and formats labels', () => {
    expect(hasEgressData(undefined)).toBe(false);
    expect(hasEgressData([{ kind: 'web', decision: 'blocked', count: 0 }])).toBe(false);
    expect(hasEgressData([{ kind: 'web', decision: 'allowed', count: 2 }])).toBe(true);
    expect(formatEgressRule('deny_host')).toBe('Denylisted destination');
    expect(formatEgressRule(null)).toBe('-');
    expect(formatEgressRule('custom_rule')).toBe('custom_rule');
    expect(formatEgressDecision('observed')).toBe('Would be blocked');
    expect(formatEgressKind('dns')).toBe('DNS');
    expect(egressDecisionColor('blocked')).toBe('danger');
    expect(egressDecisionColor('allowed')).toBe('success');
    expect(egressDecisionColor('other')).toBe('secondary');
  });

  it('formats byte counts', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(50 * 1024 * 1024)).toBe('50 MB');
  });
});
