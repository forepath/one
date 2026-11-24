import type { ActionCenterModuleOptions } from '../interfaces/action-center-module.options';
import type { ActionCenterGroupDraft, ActionCenterSource } from '../interfaces/action-center.types';

import { ActionCenterRegistry } from './action-center-registry.service';
import { ActionCenterService } from './action-center.service';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));

  return { promise, resolve };
}

function createService(sources: ActionCenterSource[], options: Partial<ActionCenterModuleOptions> = {}) {
  const registry = new ActionCenterRegistry();

  registry.register(...sources);

  const silences = { listForScope: jest.fn().mockResolvedValue([]) };
  const revisions = { bump: jest.fn().mockResolvedValue('rev') };
  const service = new ActionCenterService(
    { applicationId: 'decabill', resolveScopeKey: () => 'tenant-a', ...options },
    registry,
    silences as never,
    revisions as never,
  );

  return { service, silences, revisions };
}

const unsent: ActionCenterSource = {
  key: 'invoices',
  types: ['decabill.invoices.unsent'],
  collect: jest.fn(
    async (): Promise<ActionCenterGroupDraft[]> => [
      {
        type: 'decabill.invoices.unsent',
        category: 'receivables',
        severity: 'warning',
        kind: 'task',
        total: 2,
        items: [],
      },
    ],
  ),
};

describe('ActionCenterService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('runs every source inside the scope and builds the viewer’s view', async () => {
    const runInScope = jest.fn((_scope: string, fn: () => Promise<unknown>) => fn()) as never;
    const { service } = createService([unsent], { runInScope });
    const view = await service.getView({ userId: 'u', role: 'manager', scopeKey: 'tenant-a' });

    expect(runInScope).toHaveBeenCalledWith('tenant-a', expect.any(Function));
    expect(view.counts.open).toBe(2);
  });

  it('drops failing sources and foreign types without failing the snapshot', async () => {
    const failing: ActionCenterSource = {
      key: 'broken',
      types: ['decabill.x.y'],
      collect: jest.fn().mockRejectedValue(new Error('db down')),
    };
    const foreign: ActionCenterSource = {
      key: 'foreign',
      types: ['decabill.offers.unsent'],
      collect: jest.fn(
        async (): Promise<ActionCenterGroupDraft[]> => [
          { type: 'decabill.invoices.unsent', category: 'c', severity: 'danger', kind: 'task', total: 5, items: [] },
        ],
      ),
    };
    const { service } = createService([unsent, failing, foreign]);
    const snapshot = await service.getSnapshot('tenant-a');

    expect(snapshot.groups).toHaveLength(1);
    expect(snapshot.groups[0].total).toBe(2);
  });

  it('reuses a fresh snapshot and recomputes after a change signal', async () => {
    jest.useFakeTimers();

    try {
      const { service, revisions } = createService([unsent]);

      await service.getSnapshot('tenant-a');
      await service.getSnapshot('tenant-a');
      expect(unsent.collect).toHaveBeenCalledTimes(1);

      const listener = jest.fn();

      service.onChange(listener);
      service.signalChange('tenant-a');
      expect(listener).toHaveBeenCalledWith('tenant-a');

      await service.getSnapshot('tenant-a');
      expect(unsent.collect).toHaveBeenCalledTimes(2);

      // Revision writes are throttled per scope.
      service.signalChange('tenant-a');
      jest.advanceTimersByTime(300);
      expect(revisions.bump).toHaveBeenCalledTimes(1);
      expect(revisions.bump).toHaveBeenCalledWith('tenant-a');
    } finally {
      jest.useRealTimers();
    }
  });

  it('shares one computation between concurrent readers and recomputes when a change arrived meanwhile', async () => {
    const gate = deferred<void>();
    let calls = 0;
    const slow: ActionCenterSource = {
      key: 'slow',
      types: ['decabill.invoices.unsent'],
      collect: async () => {
        calls += 1;

        if (calls === 1) {
          await gate.promise;
        }

        return [
          { type: 'decabill.invoices.unsent', category: 'r', severity: 'info', kind: 'task', total: calls, items: [] },
        ];
      },
    };
    const { service } = createService([slow]);
    const first = service.getSnapshot('tenant-a');
    const second = service.getSnapshot('tenant-a');

    service.markStale('tenant-a');
    gate.resolve();

    expect((await first).groups[0].total).toBe(1);
    // The second reader waited for the first run, saw the change and computed again.
    expect((await second).groups[0].total).toBe(2);
    expect(calls).toBe(2);
  });

  it('silences, signals the change and notifies silence listeners', async () => {
    const { service, silences } = createService([unsent]);
    const created = {
      id: 's-1',
      itemType: 'decabill.invoices.unsent',
      itemId: null,
      userId: null,
      until: new Date('2026-12-01T00:00:00Z'),
    };
    const listener = jest.fn();
    const changes = jest.fn();
    const viewer = { userId: 'u', role: 'admin' as const, scopeKey: 'tenant-a' };

    Object.assign(silences, {
      create: jest.fn().mockResolvedValue(created),
      remove: jest.fn().mockResolvedValue({ ...created, userId: 'u', until: null }),
    });
    service.onChange(changes);
    service.onSilenceChange(listener);

    await service.silence(viewer, { itemType: 'decabill.invoices.unsent', audience: 'everyone' });
    await service.unsilence(viewer, 's-1');

    expect(changes).toHaveBeenCalledWith('tenant-a');
    expect(listener.mock.calls.map(([event]) => event)).toEqual([
      {
        change: 'created',
        actor: viewer,
        silence: {
          id: 's-1',
          itemType: 'decabill.invoices.unsent',
          itemId: null,
          audience: 'everyone',
          until: '2026-12-01T00:00:00.000Z',
        },
      },
      {
        change: 'removed',
        actor: viewer,
        silence: { id: 's-1', itemType: 'decabill.invoices.unsent', itemId: null, audience: 'self', until: null },
      },
    ]);
  });

  it('grants each wiring claim once', () => {
    const { service } = createService([unsent]);

    expect(service.claimWiring('decabill.registrar')).toBe(true);
    expect(service.claimWiring('decabill.registrar')).toBe(false);
  });

  it('uses the request scope for signals without an explicit scope', () => {
    const { service } = createService([unsent]);
    const listener = jest.fn();

    service.onChange(listener);
    service.signalChange();

    expect(listener).toHaveBeenCalledWith('tenant-a');
  });
});
