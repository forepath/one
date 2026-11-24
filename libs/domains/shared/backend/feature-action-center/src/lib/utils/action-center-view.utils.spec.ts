import type { ActionCenterSilenceEntity } from '../entities/action-center-silence.entity';
import type { ActionCenterGroupDraft, ActionCenterViewer } from '../interfaces/action-center.types';

import {
  buildActionCenterView,
  canRemoveActionCenterSilence,
  createActionCenterSnapshot,
  normalizeActionCenterGroups,
} from './action-center-view.utils';

const now = new Date('2026-11-24T10:00:00.000Z');
const admin: ActionCenterViewer = { userId: 'u-admin', role: 'admin', scopeKey: 'tenant-a' };
const manager: ActionCenterViewer = { userId: 'u-manager', role: 'manager', scopeKey: 'tenant-a' };

function silence(partial: Partial<ActionCenterSilenceEntity>): ActionCenterSilenceEntity {
  return {
    id: 's-1',
    scopeKey: 'tenant-a',
    userId: null,
    itemType: 'decabill.invoices.unsent',
    itemId: null,
    until: null,
    createdByUserId: 'u-admin',
    createdAt: new Date('2026-11-20T00:00:00.000Z'),
    ...partial,
  };
}

const drafts: ActionCenterGroupDraft[] = [
  {
    type: 'decabill.invoices.unsent',
    category: 'receivables',
    severity: 'warning',
    kind: 'task',
    total: 3,
    items: [
      { id: 'inv-1', occurredAt: '2026-11-20T00:00:00Z', params: { number: 'R-1' } },
      { id: 'inv-2', occurredAt: '2026-11-22T00:00:00Z', params: { number: 'R-2' } },
      { id: 'inv-3', occurredAt: '2026-11-21T00:00:00Z', params: { number: 'R-3' } },
    ],
  },
  {
    type: 'decabill.setup.issuer',
    category: 'setup',
    severity: 'warning',
    kind: 'setup',
    audience: 'admin',
    total: 1,
    items: [],
    params: { missing: 'BILLING_ISSUER_NAME' },
  },
  { type: 'decabill.invoices.overdue', category: 'receivables', severity: 'danger', kind: 'task', total: 0, items: [] },
];

describe('normalizeActionCenterGroups', () => {
  it('drops empty groups, orders setup first then by severity and keeps the first group of a type', () => {
    const groups = normalizeActionCenterGroups([
      ...drafts,
      { type: 'decabill.invoices.unsent', category: 'x', severity: 'info', kind: 'task', total: 9, items: [] },
      { type: 'decabill.offers.unsent', category: 'offers', severity: 'danger', kind: 'task', total: 1, items: [] },
    ]);

    expect(groups.map((group) => group.type)).toEqual([
      'decabill.setup.issuer',
      'decabill.offers.unsent',
      'decabill.invoices.unsent',
    ]);
    expect(groups.find((group) => group.type === 'decabill.invoices.unsent')?.total).toBe(3);
  });

  it('removes non-scalar params and raises total to the number of items', () => {
    const [group] = normalizeActionCenterGroups([
      {
        type: 'a.b',
        category: 'c',
        severity: 'info',
        kind: 'task',
        total: 0,
        items: [{ id: 'x', params: { ok: 'yes', bad: { nested: true } as never, nan: Number.NaN } }],
      },
    ]);

    expect(group.total).toBe(1);
    expect(group.items[0].params).toEqual({ ok: 'yes' });
  });
});

describe('buildActionCenterView', () => {
  const snapshot = createActionCenterSnapshot('tenant-a', drafts, now);

  it('counts open items and shows admin-only groups to admins', () => {
    const view = buildActionCenterView(snapshot, admin, [], now);

    expect(view.counts).toEqual({ open: 4, setup: 1, silenced: 0 });
    expect(view.canSilenceForEveryone).toBe(true);
    expect(view.groups.map((group) => group.type)).toEqual(['decabill.setup.issuer', 'decabill.invoices.unsent']);
    // newest first
    expect(view.groups[1].items.map((item) => item.id)).toEqual(['inv-2', 'inv-3', 'inv-1']);
  });

  it('hides admin-only groups from managers, including their silences', () => {
    const view = buildActionCenterView(
      snapshot,
      manager,
      [silence({ id: 's-admin-type', itemType: 'decabill.setup.issuer' })],
      now,
    );

    expect(view.silences).toEqual([]);

    expect(view.groups.map((group) => group.type)).toEqual(['decabill.invoices.unsent']);
    expect(view.counts).toEqual({ open: 3, setup: 0, silenced: 0 });
    expect(view.canSilenceForEveryone).toBe(false);
  });

  it('applies item silences of the viewer and everyone, but not of other users', () => {
    const view = buildActionCenterView(
      snapshot,
      manager,
      [
        silence({ id: 's-own', userId: 'u-manager', itemId: 'inv-2' }),
        silence({ id: 's-all', userId: null, itemId: 'inv-1' }),
        silence({ id: 's-other', userId: 'u-other', itemId: 'inv-3' }),
      ],
      now,
    );
    const group = view.groups[0];

    expect(group.openCount).toBe(1);
    expect(group.items.map((item) => [item.id, item.silencedBy])).toEqual([
      ['inv-3', null],
      ['inv-2', 's-own'],
      ['inv-1', 's-all'],
    ]);
    expect(view.counts).toEqual({ open: 1, setup: 0, silenced: 2 });
    expect(view.silences.map((entry) => [entry.id, entry.removable])).toEqual([
      ['s-own', true],
      ['s-all', false],
    ]);
  });

  it('silences a whole type and ignores expired silences', () => {
    const view = buildActionCenterView(
      snapshot,
      admin,
      [
        silence({ id: 's-type', userId: 'u-admin' }),
        silence({ id: 's-old', itemType: 'decabill.setup.issuer', until: new Date('2026-11-23T00:00:00Z') }),
      ],
      now,
    );

    expect(view.groups.find((group) => group.type === 'decabill.invoices.unsent')?.silencedBy).toBe('s-type');
    expect(view.counts).toEqual({ open: 1, setup: 1, silenced: 3 });
    expect(view.silences.map((entry) => entry.id)).toEqual(['s-type']);
  });

  it('prefers the viewer’s own silence over an everyone silence of the same target', () => {
    const view = buildActionCenterView(
      snapshot,
      manager,
      [silence({ id: 's-all', userId: null }), silence({ id: 's-own', userId: 'u-manager' })],
      now,
    );

    expect(view.groups[0].silencedBy).toBe('s-own');
  });

  it('ignores silences of other scopes', () => {
    const view = buildActionCenterView(snapshot, admin, [silence({ scopeKey: 'tenant-b' })], now);

    expect(view.counts.silenced).toBe(0);
  });
});

describe('viewer restrictions (e.g. PAT workspace access)', () => {
  const restricted = createActionCenterSnapshot(
    'instance',
    [
      {
        type: 'agenstra.tasks.approval_pending',
        category: 'automation',
        severity: 'warning',
        kind: 'task',
        total: 3,
        items: [
          { id: 't1', params: { clientId: 'c-1' } },
          { id: 't2', params: { clientId: 'c-2' } },
          { id: 't3', params: { clientId: 'c-1' } },
        ],
      },
      {
        type: 'agenstra.deployments.run_failed',
        category: 'deployments',
        severity: 'danger',
        kind: 'task',
        total: 1,
        items: [{ id: 'w1', params: { clientId: 'c-2' } }],
      },
      {
        type: 'agenstra.connections.test_failed',
        category: 'integrations',
        severity: 'warning',
        kind: 'task',
        total: 1,
        items: [{ id: 'x1', params: { clientId: null, label: 'GitHub' } }],
      },
      { type: 'platform.updates.available', category: 'platform', severity: 'info', kind: 'task', total: 1, items: [] },
    ],
    now,
  );

  it('keeps only items of allowed workspaces and recounts their groups', () => {
    const view = buildActionCenterView(
      restricted,
      { userId: 'u', role: 'admin', scopeKey: 'instance', restriction: { param: 'clientId', values: ['c-1'] } },
      [],
      now,
    );

    expect(view.groups.map((group) => [group.type, group.total, group.items.map((item) => item.id)])).toEqual([
      ['agenstra.connections.test_failed', 1, ['x1']],
      ['agenstra.tasks.approval_pending', 2, ['t1', 't3']],
      ['platform.updates.available', 1, []],
    ]);
    expect(view.counts.open).toBe(4);
  });

  it('hides groups outside the group filter, and their silences', () => {
    const view = buildActionCenterView(
      restricted,
      {
        userId: 'u',
        role: 'admin',
        scopeKey: 'instance',
        groupFilter: (_type, category) => category !== 'automation',
      },
      [
        silence({
          id: 's-hidden',
          scopeKey: 'instance',
          userId: null,
          itemType: 'agenstra.tasks.approval_pending',
          itemId: 't1',
        }),
        silence({
          id: 's-shown',
          scopeKey: 'instance',
          userId: null,
          itemType: 'agenstra.deployments.run_failed',
          itemId: 'w1',
        }),
        silence({
          id: 's-foreign',
          scopeKey: 'instance',
          userId: null,
          itemType: 'agenstra.deployments.run_failed',
          itemId: 'w9',
        }),
      ],
      now,
    );

    expect(view.groups.map((group) => group.type)).not.toContain('agenstra.tasks.approval_pending');
    expect(view.silences.map((entry) => entry.id)).toEqual(['s-shown']);
  });

  it('shows everything without a restriction', () => {
    expect(buildActionCenterView(restricted, admin, [], now).counts.open).toBe(6);
  });
});

describe('canRemoveActionCenterSilence', () => {
  it('allows own silences and everyone silences only to admins', () => {
    expect(canRemoveActionCenterSilence(silence({ userId: 'u-manager' }), manager)).toBe(true);
    expect(canRemoveActionCenterSilence(silence({ userId: 'u-admin' }), manager)).toBe(false);
    expect(canRemoveActionCenterSilence(silence({ userId: null }), manager)).toBe(false);
    expect(canRemoveActionCenterSilence(silence({ userId: null }), admin)).toBe(true);
  });
});
