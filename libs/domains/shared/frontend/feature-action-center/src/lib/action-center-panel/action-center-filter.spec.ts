import type { ActionCenterGroup, ActionCenterSilence } from '@forepath/shared/frontend/data-access-action-center';

import {
  filterActionCenterGroups,
  filterActionCenterSilences,
  isActionCenterFilterActive,
  type ActionCenterSearchTexts,
} from './action-center-filter';

const groups: ActionCenterGroup[] = [
  {
    type: 'decabill.invoices.overdue',
    category: 'receivables',
    severity: 'danger',
    kind: 'task',
    audience: 'administrative',
    total: 2,
    openCount: 2,
    params: {},
    items: [
      { id: 'i1', params: { number: 'R-1', customer: 'Müller GmbH' }, occurredAt: null, silencedBy: null },
      { id: 'i2', params: { number: 'R-2', customer: 'ACME' }, occurredAt: null, silencedBy: null },
    ],
    silencedBy: null,
  },
  {
    type: 'decabill.offers.draft',
    category: 'offers',
    severity: 'info',
    kind: 'task',
    audience: 'administrative',
    total: 1,
    openCount: 1,
    params: {},
    items: [{ id: 'o1', params: { number: 'A-1', customer: 'ACME' }, occurredAt: null, silencedBy: null }],
    silencedBy: null,
  },
];
const titles: Record<string, string> = {
  'decabill.invoices.overdue': 'Overdue invoices',
  'decabill.offers.draft': 'Draft offers',
};
const texts: ActionCenterSearchTexts = {
  group: (group) => [titles[group.type], group.category],
  item: (_group, item) => [String(item.params['number']), String(item.params['customer'])],
};
const none = { search: '', category: null, severity: null };

describe('filterActionCenterGroups', () => {
  it('keeps everything without search and filters', () => {
    expect(filterActionCenterGroups(groups, none, texts)).toEqual(groups);
    expect(isActionCenterFilterActive(none)).toBe(false);
  });

  it('keeps a whole group when its title matches', () => {
    const result = filterActionCenterGroups(groups, { ...none, search: 'overdue' }, texts);

    expect(result.map((group) => [group.type, group.openCount])).toEqual([['decabill.invoices.overdue', 2]]);
  });

  it('narrows a group to matching records (all terms, accent-insensitive) and counts them', () => {
    const result = filterActionCenterGroups(groups, { ...none, search: 'mull r-1' }, texts);

    expect(result).toEqual([expect.objectContaining({ type: 'decabill.invoices.overdue', openCount: 1 })]);
    expect(result[0].items.map((item) => item.id)).toEqual(['i1']);
  });

  it('finds records across groups', () => {
    expect(
      filterActionCenterGroups(groups, { ...none, search: 'acme' }, texts).map((group) => group.openCount),
    ).toEqual([1, 1]);
  });

  it('filters by area and priority', () => {
    expect(filterActionCenterGroups(groups, { ...none, category: 'offers' }, texts).map((g) => g.type)).toEqual([
      'decabill.offers.draft',
    ]);
    expect(filterActionCenterGroups(groups, { ...none, severity: 'danger' }, texts).map((g) => g.type)).toEqual([
      'decabill.invoices.overdue',
    ]);
    expect(filterActionCenterGroups(groups, { ...none, category: 'offers', severity: 'danger' }, texts)).toEqual([]);
  });
});

describe('filterActionCenterSilences', () => {
  const silence = (id: string, itemType: string): ActionCenterSilence => ({
    id,
    itemType,
    itemId: null,
    audience: 'self',
    until: null,
    createdAt: '2026-11-24T00:00:00Z',
    createdByUserId: 'u',
    removable: true,
  });
  const silences = [
    silence('s1', 'decabill.invoices.overdue'),
    silence('s2', 'decabill.offers.draft'),
    silence('s3', 'decabill.gone.type'),
  ];
  const silenceTexts = (entry: ActionCenterSilence) => [titles[entry.itemType] ?? entry.itemType];

  it('searches silences by their texts', () => {
    expect(
      filterActionCenterSilences(silences, groups, { ...none, search: 'draft' }, silenceTexts).map((s) => s.id),
    ).toEqual(['s2']);
  });

  it('filters by the area / priority of the silenced type', () => {
    expect(
      filterActionCenterSilences(silences, groups, { ...none, category: 'receivables' }, silenceTexts).map((s) => s.id),
    ).toEqual(['s1']);
    expect(filterActionCenterSilences(silences, groups, none, silenceTexts)).toHaveLength(3);
  });
});
