import {
  connectNotificationsSocket,
  connectNotificationsSocketFailure,
  connectNotificationsSocketSuccess,
  disconnectNotificationsSocket,
  disconnectNotificationsSocketSuccess,
  markChatSessionRead,
  notificationsSocketError,
  notificationsSocketReconnected,
  notificationsSocketReconnectError,
  notificationsSocketReconnectFailed,
  notificationsSocketReconnecting,
  setActiveEnvironmentLocal,
  statusPatchReceived,
  statusSnapshotReceived,
} from './notifications.actions';
import { initialNotificationsState, notificationsReducer } from './notifications.reducer';

describe('notificationsReducer', () => {
  it('should keep state for progress-only status patches', () => {
    const state = notificationsReducer(
      initialNotificationsState,
      statusPatchReceived({
        patch: { generatedAt: '2024-01-01T00:00:00Z', environmentProgress: [{ clientId: 'c1', operations: [] }] },
      }),
    );

    expect(state).toBe(initialNotificationsState);
  });

  it('applies status snapshot', () => {
    const state = notificationsReducer(
      initialNotificationsState,
      statusSnapshotReceived({
        snapshot: {
          generatedAt: '2026-01-01T00:00:00.000Z',
          environments: [
            {
              clientId: 'c1',
              agentId: 'a1',
              hasUnreadMessages: true,
              gitDirty: false,
              gitConflict: false,
            },
          ],
          clients: [{ clientId: 'c1', hasUnreadMessages: true, gitDirty: false }],
          spacesHasAttention: true,
        },
      }),
    );

    expect(state.environmentsByKey['c1:a1']?.hasUnreadMessages).toBe(true);
    expect(state.environmentsByKey['c1:a1']?.chats).toEqual([]);
    expect(state.spacesHasAttention).toBe(true);
  });

  it('preserves nested chats on snapshot and patch', () => {
    const chats = [{ chatSessionId: 'chat-1', hasUnreadMessages: true }];
    const withSnapshot = notificationsReducer(
      initialNotificationsState,
      statusSnapshotReceived({
        snapshot: {
          generatedAt: '2026-01-01T00:00:00.000Z',
          environments: [
            {
              clientId: 'c1',
              agentId: 'a1',
              hasUnreadMessages: true,
              gitDirty: false,
              gitConflict: false,
              chats,
            },
          ],
          clients: [{ clientId: 'c1', hasUnreadMessages: true, gitDirty: false }],
          spacesHasAttention: true,
        },
      }),
    );

    expect(withSnapshot.environmentsByKey['c1:a1']?.chats).toEqual(chats);

    const patched = notificationsReducer(
      withSnapshot,
      statusPatchReceived({
        patch: {
          generatedAt: '2026-01-02T00:00:00.000Z',
          environments: [
            {
              clientId: 'c1',
              agentId: 'a1',
              hasUnreadMessages: false,
              gitDirty: false,
              gitConflict: false,
              chats: [{ chatSessionId: 'chat-1', hasUnreadMessages: false }],
            },
          ],
        },
      }),
    );

    expect(patched.environmentsByKey['c1:a1']?.chats).toEqual([{ chatSessionId: 'chat-1', hasUnreadMessages: false }]);
  });

  it('optimistically clears chat unread on markChatSessionRead', () => {
    const withUnread = notificationsReducer(
      initialNotificationsState,
      statusSnapshotReceived({
        snapshot: {
          generatedAt: '2026-01-01T00:00:00.000Z',
          environments: [
            {
              clientId: 'c1',
              agentId: 'a1',
              hasUnreadMessages: true,
              gitDirty: false,
              gitConflict: false,
              chats: [
                { chatSessionId: 'chat-1', hasUnreadMessages: true },
                { chatSessionId: 'chat-2', hasUnreadMessages: true },
              ],
            },
          ],
          clients: [{ clientId: 'c1', hasUnreadMessages: true, gitDirty: false }],
          spacesHasAttention: true,
        },
      }),
    );

    const cleared = notificationsReducer(
      withUnread,
      markChatSessionRead({ clientId: 'c1', agentId: 'a1', chatSessionId: 'chat-1' }),
    );

    expect(cleared.environmentsByKey['c1:a1']?.chats).toEqual([
      { chatSessionId: 'chat-1', hasUnreadMessages: false },
      { chatSessionId: 'chat-2', hasUnreadMessages: true },
    ]);
    expect(cleared.environmentsByKey['c1:a1']?.hasUnreadMessages).toBe(true);
  });

  it('ignores stale unread=true patches after optimistic mark-read', () => {
    const withUnread = notificationsReducer(
      initialNotificationsState,
      statusSnapshotReceived({
        snapshot: {
          generatedAt: '2026-01-01T00:00:00.000Z',
          environments: [
            {
              clientId: 'c1',
              agentId: 'a1',
              hasUnreadMessages: true,
              gitDirty: false,
              gitConflict: false,
              chats: [{ chatSessionId: 'chat-1', hasUnreadMessages: true }],
            },
          ],
          clients: [{ clientId: 'c1', hasUnreadMessages: true, gitDirty: false }],
          spacesHasAttention: true,
        },
      }),
    );
    const cleared = notificationsReducer(
      withUnread,
      markChatSessionRead({ clientId: 'c1', agentId: 'a1', chatSessionId: 'chat-1' }),
    );

    const stale = notificationsReducer(
      cleared,
      statusPatchReceived({
        patch: {
          generatedAt: '2025-12-31T23:59:00.000Z',
          environments: [
            {
              clientId: 'c1',
              agentId: 'a1',
              hasUnreadMessages: true,
              gitDirty: false,
              gitConflict: false,
              chats: [{ chatSessionId: 'chat-1', hasUnreadMessages: true }],
            },
          ],
        },
      }),
    );

    expect(stale.environmentsByKey['c1:a1']?.chats).toEqual([{ chatSessionId: 'chat-1', hasUnreadMessages: false }]);
    expect(stale.environmentsByKey['c1:a1']?.hasUnreadMessages).toBe(false);
  });

  it('keeps suppress after server confirms read so late unread=true stays blocked', () => {
    const withUnread = notificationsReducer(
      initialNotificationsState,
      statusSnapshotReceived({
        snapshot: {
          generatedAt: '2026-01-01T00:00:00.000Z',
          environments: [
            {
              clientId: 'c1',
              agentId: 'a1',
              hasUnreadMessages: true,
              gitDirty: false,
              gitConflict: false,
              chats: [{ chatSessionId: 'chat-1', hasUnreadMessages: true }],
            },
          ],
          clients: [{ clientId: 'c1', hasUnreadMessages: true, gitDirty: false }],
          spacesHasAttention: true,
        },
      }),
    );
    const cleared = notificationsReducer(
      withUnread,
      markChatSessionRead({ clientId: 'c1', agentId: 'a1', chatSessionId: 'chat-1' }),
    );
    const confirmed = notificationsReducer(
      cleared,
      statusPatchReceived({
        patch: {
          generatedAt: '2026-01-01T00:00:01.000Z',
          environments: [
            {
              clientId: 'c1',
              agentId: 'a1',
              hasUnreadMessages: false,
              gitDirty: false,
              gitConflict: false,
              chats: [{ chatSessionId: 'chat-1', hasUnreadMessages: false }],
            },
          ],
        },
      }),
    );

    expect(confirmed.optimisticChatReadAtByKey['c1:a1:chat-1']).toBeDefined();

    const lateStale = notificationsReducer(
      confirmed,
      statusPatchReceived({
        patch: {
          generatedAt: '2026-01-01T00:00:02.000Z',
          environments: [
            {
              clientId: 'c1',
              agentId: 'a1',
              hasUnreadMessages: true,
              gitDirty: false,
              gitConflict: false,
              chats: [{ chatSessionId: 'chat-1', hasUnreadMessages: true }],
            },
          ],
        },
      }),
    );

    expect(lateStale.environmentsByKey['c1:a1']?.chats).toEqual([
      { chatSessionId: 'chat-1', hasUnreadMessages: false },
    ]);
  });

  it('merges status patch for environment', () => {
    const withSnapshot = notificationsReducer(
      initialNotificationsState,
      statusSnapshotReceived({
        snapshot: {
          generatedAt: '2026-01-01T00:00:00.000Z',
          environments: [
            {
              clientId: 'c1',
              agentId: 'a1',
              hasUnreadMessages: false,
              gitDirty: false,
              gitConflict: false,
            },
          ],
          clients: [{ clientId: 'c1', hasUnreadMessages: false, gitDirty: false }],
          spacesHasAttention: false,
        },
      }),
    );
    const state = notificationsReducer(
      withSnapshot,
      statusPatchReceived({
        patch: {
          generatedAt: '2026-01-02T00:00:00.000Z',
          environments: [
            {
              clientId: 'c1',
              agentId: 'a1',
              hasUnreadMessages: true,
              gitDirty: true,
              gitConflict: false,
            },
          ],
        },
      }),
    );

    expect(state.environmentsByKey['c1:a1']?.hasUnreadMessages).toBe(true);
    expect(state.environmentsByKey['c1:a1']?.gitDirty).toBe(true);
    expect(state.clientsById['c1']?.gitDirty).toBe(true);
  });

  it('keeps workspace attention when patch carries a single-environment client rollup', () => {
    const withSnapshot = notificationsReducer(
      initialNotificationsState,
      statusSnapshotReceived({
        snapshot: {
          generatedAt: '2026-01-01T00:00:00.000Z',
          environments: [
            {
              clientId: 'c1',
              agentId: 'a1',
              hasUnreadMessages: true,
              gitDirty: true,
              gitConflict: false,
            },
            {
              clientId: 'c1',
              agentId: 'a2',
              hasUnreadMessages: false,
              gitDirty: false,
              gitConflict: false,
            },
          ],
          clients: [{ clientId: 'c1', hasUnreadMessages: true, gitDirty: true }],
          spacesHasAttention: true,
        },
      }),
    );
    const state = notificationsReducer(
      withSnapshot,
      statusPatchReceived({
        patch: {
          generatedAt: '2026-01-02T00:00:00.000Z',
          environments: [
            {
              clientId: 'c1',
              agentId: 'a2',
              hasUnreadMessages: false,
              gitDirty: false,
              gitConflict: false,
            },
          ],
          clients: [{ clientId: 'c1', hasUnreadMessages: false, gitDirty: false }],
          spacesHasAttention: false,
        },
      }),
    );

    expect(state.clientsById['c1']).toEqual({
      clientId: 'c1',
      hasUnreadMessages: true,
      gitDirty: true,
    });
    expect(state.spacesHasAttention).toBe(true);
  });

  it('applies client-only status patch when no environments are present', () => {
    const state = notificationsReducer(
      initialNotificationsState,
      statusPatchReceived({
        patch: {
          generatedAt: '2026-01-02T00:00:00.000Z',
          clients: [{ clientId: 'c1', hasUnreadMessages: true, gitDirty: false }],
        },
      }),
    );

    expect(state.clientsById['c1']?.hasUnreadMessages).toBe(true);
    expect(state.spacesHasAttention).toBe(true);
  });

  it('tracks socket lifecycle and active environment', () => {
    let state = notificationsReducer(initialNotificationsState, connectNotificationsSocket());

    expect(state.socketConnecting).toBe(true);
    expect(state.socketError).toBeNull();

    state = notificationsReducer(state, connectNotificationsSocketSuccess());
    expect(state.socketConnected).toBe(true);
    expect(state.socketConnecting).toBe(false);

    state = notificationsReducer(state, notificationsSocketReconnecting({ attempt: 1 }));
    expect(state.socketConnecting).toBe(true);

    state = notificationsReducer(state, notificationsSocketReconnected());
    expect(state.socketConnected).toBe(true);
    expect(state.socketConnecting).toBe(false);

    state = notificationsReducer(state, notificationsSocketReconnectError({ error: 'retry failed' }));
    expect(state.socketError).toBe('retry failed');

    state = notificationsReducer(state, notificationsSocketReconnectFailed({ error: 'gave up' }));
    expect(state.socketConnected).toBe(false);
    expect(state.socketError).toBe('gave up');

    state = notificationsReducer(state, notificationsSocketError({ message: 'socket error' }));
    expect(state.socketError).toBe('socket error');

    state = notificationsReducer(state, setActiveEnvironmentLocal({ active: { clientId: 'c1', agentId: 'a1' } }));
    expect(state.activeEnvironment).toEqual({ clientId: 'c1', agentId: 'a1' });

    state = notificationsReducer(state, disconnectNotificationsSocket());
    state = notificationsReducer(state, disconnectNotificationsSocketSuccess());
    expect(state).toEqual(initialNotificationsState);

    state = notificationsReducer(
      initialNotificationsState,
      connectNotificationsSocketFailure({ error: 'failed to connect' }),
    );
    expect(state.socketError).toBe('failed to connect');
    expect(state.socketConnected).toBe(false);
  });
});
