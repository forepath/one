import {
  connectSocket,
  connectSocketFailure,
  connectSocketSuccess,
  disconnectSocketSuccess,
  forwardedEventReceived,
  setAgent,
  setChatModel,
  setChatResponseMode,
  setClient,
  setClientSuccess,
  socketReconnected,
} from './container-socket.actions';
import {
  containerSocketReducer,
  initialContainerSocketState,
  type ContainerSocketState,
} from './container-socket.reducer';
import { ChatActor } from './container-socket.types';

describe('containerSocketReducer', () => {
  it('should return initial state', () => {
    const state = containerSocketReducer(undefined, { type: '@@init' } as never);

    expect(state).toEqual(initialContainerSocketState);
  });

  it('should connect and succeed', () => {
    let state = containerSocketReducer(initialContainerSocketState, connectSocket());

    expect(state.connecting).toBe(true);

    state = containerSocketReducer(state, connectSocketSuccess());

    expect(state.connected).toBe(true);
    expect(state.connecting).toBe(false);
  });

  it('should fail connect', () => {
    const state = containerSocketReducer(
      { ...initialContainerSocketState, connecting: true },
      connectSocketFailure({ error: 'boom' }),
    );

    expect(state.connected).toBe(false);
    expect(state.error).toBe('boom');
  });

  it('should set client and remote connection', () => {
    const state = containerSocketReducer(
      initialContainerSocketState,
      setClientSuccess({ message: 'ok', clientId: 'c1' }),
    );

    expect(state.selectedClientId).toBe('c1');
    expect(state.remoteConnections['c1']?.connected).toBe(true);
  });

  it('should set agent from loginSuccess without storing history', () => {
    const state = containerSocketReducer(
      initialContainerSocketState,
      forwardedEventReceived({
        event: 'loginSuccess',
        payload: {
          success: true,
          data: { message: 'ok', agentId: 'a1', agentName: 'Agent' },
          timestamp: new Date().toISOString(),
        },
      }),
    );

    expect(state.selectedAgentId).toBe('a1');
  });

  it('should clear agent on logoutSuccess', () => {
    const prev: ContainerSocketState = { ...initialContainerSocketState, selectedAgentId: 'a1' };
    const state = containerSocketReducer(
      prev,
      forwardedEventReceived({
        event: 'logoutSuccess',
        payload: {
          success: true,
          data: { message: 'bye', agentId: null, agentName: null },
          timestamp: new Date().toISOString(),
        },
      }),
    );

    expect(state.selectedAgentId).toBeNull();
  });

  it('should ignore chatMessage in container state', () => {
    const state = containerSocketReducer(
      initialContainerSocketState,
      forwardedEventReceived({
        event: 'chatMessage',
        payload: {
          success: true,
          data: { from: ChatActor.USER, text: 'hi', timestamp: new Date().toISOString() },
          timestamp: new Date().toISOString(),
        },
      }),
    );

    expect(state).toEqual(initialContainerSocketState);
  });

  it('should set chat prefs and agent', () => {
    let state = containerSocketReducer(initialContainerSocketState, setChatModel({ model: 'm1' }));

    state = containerSocketReducer(state, setChatResponseMode({ mode: 'single' }));
    state = containerSocketReducer(state, setAgent({ agentId: 'a9' }));

    expect(state.chatModel).toBe('m1');
    expect(state.chatResponseMode).toBe('single');
    expect(state.selectedAgentId).toBe('a9');
  });

  it('should reset on disconnect', () => {
    const prev: ContainerSocketState = {
      ...initialContainerSocketState,
      connected: true,
      selectedClientId: 'c1',
      selectedAgentId: 'a1',
    };
    const state = containerSocketReducer(prev, disconnectSocketSuccess());

    expect(state).toEqual(initialContainerSocketState);
  });

  it('should mark reconnected', () => {
    const state = containerSocketReducer(
      { ...initialContainerSocketState, reconnecting: true, reconnectAttempts: 2 },
      socketReconnected(),
    );

    expect(state.connected).toBe(true);
    expect(state.reconnecting).toBe(false);
    expect(state.reconnectAttempts).toBe(0);
  });

  it('should track setClient in flight', () => {
    const state = containerSocketReducer(initialContainerSocketState, setClient({ clientId: 'c2' }));

    expect(state.settingClient).toBe(true);
    expect(state.settingClientId).toBe('c2');
  });
});
