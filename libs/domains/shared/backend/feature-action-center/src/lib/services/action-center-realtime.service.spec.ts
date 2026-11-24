import { ACTION_CENTER_ERROR_EVENT, ACTION_CENTER_SNAPSHOT_EVENT } from '../constants/action-center.constants';
import type { ActionCenterSnapshot, ActionCenterViewer } from '../interfaces/action-center.types';
import { createActionCenterSnapshot } from '../utils/action-center-view.utils';

import { ActionCenterRealtimeService, type ActionCenterSocketSession } from './action-center-realtime.service';

const viewer: ActionCenterViewer = { userId: 'u-1', role: 'admin', scopeKey: 'tenant-a' };

function snapshotWith(total: number): ActionCenterSnapshot {
  return createActionCenterSnapshot(
    'tenant-a',
    [{ type: 'decabill.invoices.unsent', category: 'r', severity: 'warning', kind: 'task', total, items: [] }],
    new Date('2026-11-24T10:00:00Z'),
  );
}

function setup() {
  let current = snapshotWith(1);
  const listeners: Array<(scope: string) => void> = [];
  const actionCenter = {
    onChange: jest.fn((listener: (scope: string) => void) => {
      listeners.push(listener);

      return () => undefined;
    }),
    getSnapshot: jest.fn(async () => current),
    peekSnapshot: jest.fn(() => current),
    markStale: jest.fn(),
  };
  const silences = { listForScope: jest.fn().mockResolvedValue([]) };
  const revisions = {
    isEnabled: jest.fn(() => true),
    read: jest.fn(async (): Promise<Map<string, string | null>> => new Map([['tenant-a', 'r1']])),
    isOwnRevision: jest.fn(() => false),
  };
  const service = new ActionCenterRealtimeService(actionCenter as never, silences as never, revisions as never);
  const socket = { id: 's-1', emit: jest.fn(), disconnect: jest.fn() };

  return {
    service,
    actionCenter,
    revisions,
    socket,
    listeners,
    setSnapshot: (value: ActionCenterSnapshot) => (current = value),
  };
}

async function flush(): Promise<void> {
  for (let i = 0; i < 10; i++) {
    await Promise.resolve();
  }
}

describe('ActionCenterRealtimeService', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('pushes the initial view and later only changed views', async () => {
    const { service, socket, listeners, setSnapshot } = setup();
    const session: ActionCenterSocketSession = { socket, viewer, revalidate: async () => viewer };

    service.attach();
    service.register(session);
    await service.pushToSocket('s-1');
    expect(socket.emit).toHaveBeenCalledWith(
      ACTION_CENTER_SNAPSHOT_EVENT,
      expect.objectContaining({ counts: expect.objectContaining({ open: 1 }) }),
    );

    // Unchanged content: no emit.
    listeners[0]('tenant-a');
    jest.advanceTimersByTime(500);
    await flush();
    expect(socket.emit).toHaveBeenCalledTimes(1);

    setSnapshot(snapshotWith(4));
    listeners[0]('tenant-a');
    // At most one recompute per scope every 2 s.
    jest.advanceTimersByTime(1_000);
    await flush();
    expect(socket.emit).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(1_500);
    await flush();
    expect(socket.emit).toHaveBeenCalledTimes(2);
    expect(socket.emit).toHaveBeenLastCalledWith(
      ACTION_CENTER_SNAPSHOT_EVENT,
      expect.objectContaining({ counts: expect.objectContaining({ open: 4 }) }),
    );
    service.onModuleDestroy();
  });

  it('ignores changes of scopes without viewers', async () => {
    const { service, actionCenter, listeners } = setup();

    service.attach();
    listeners[0]('tenant-b');
    jest.advanceTimersByTime(500);
    await flush();

    expect(actionCenter.getSnapshot).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('recomputes when another process wrote a new revision', async () => {
    const { service, actionCenter, revisions, socket } = setup();

    service.attach();
    service.register({ socket, viewer, revalidate: async () => viewer });
    await flush();

    revisions.read.mockResolvedValue(new Map([['tenant-a', 'r2']]));
    jest.advanceTimersByTime(2_000);
    await flush();

    expect(actionCenter.markStale).toHaveBeenCalledWith('tenant-a');
    jest.advanceTimersByTime(500);
    await flush();
    expect(actionCenter.getSnapshot).toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('skips revisions written by this process', async () => {
    const { service, actionCenter, revisions, socket } = setup();

    service.attach();
    service.register({ socket, viewer, revalidate: async () => viewer });
    await flush();

    revisions.read.mockResolvedValue(new Map([['tenant-a', 'own']]));
    revisions.isOwnRevision.mockReturnValue(true);
    jest.advanceTimersByTime(2_000);
    await flush();

    expect(actionCenter.markStale).not.toHaveBeenCalled();
    service.onModuleDestroy();
  });

  it('disconnects sessions that lost access and re-sends views on role changes', async () => {
    const { service, socket } = setup();
    const other = { id: 's-2', emit: jest.fn(), disconnect: jest.fn() };

    service.attach();
    service.register({ socket, viewer, revalidate: async () => null });
    service.register({ socket: other, viewer, revalidate: async () => ({ ...viewer, role: 'manager' }) });

    jest.advanceTimersByTime(60_000);
    await flush();

    expect(socket.emit).toHaveBeenCalledWith(ACTION_CENTER_ERROR_EVENT, { message: 'Session no longer valid' });
    expect(socket.disconnect).toHaveBeenCalledWith(true);
    expect(other.disconnect).not.toHaveBeenCalled();
    expect(other.emit).toHaveBeenCalledWith(ACTION_CENTER_SNAPSHOT_EVENT, expect.objectContaining({ role: 'manager' }));
    service.onModuleDestroy();
  });
});
