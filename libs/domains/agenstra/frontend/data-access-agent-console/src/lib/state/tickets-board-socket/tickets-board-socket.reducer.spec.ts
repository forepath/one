import {
  connectTicketsBoardSocket,
  connectTicketsBoardSocketFailure,
  connectTicketsBoardSocketSuccess,
  disconnectTicketsBoardSocket,
  disconnectTicketsBoardSocketSuccess,
  setTicketsBoardSocketClient,
  setTicketsBoardSocketClientSuccess,
  ticketsBoardSocketError,
  ticketsBoardSocketReconnected,
  ticketsBoardSocketReconnectError,
  ticketsBoardSocketReconnectFailed,
  ticketsBoardSocketReconnecting,
} from './tickets-board-socket.actions';
import {
  initialTicketsBoardSocketState,
  ticketsBoardSocketReducer,
  type TicketsBoardSocketState,
} from './tickets-board-socket.reducer';

describe('ticketsBoardSocketReducer', () => {
  it('returns initial state for unknown action', () => {
    expect(ticketsBoardSocketReducer(undefined, { type: 'UNKNOWN' } as never)).toEqual(initialTicketsBoardSocketState);
  });

  it('connectTicketsBoardSocket sets connecting and clears error', () => {
    const prev: TicketsBoardSocketState = { ...initialTicketsBoardSocketState, error: 'x' };
    const next = ticketsBoardSocketReducer(prev, connectTicketsBoardSocket());

    expect(next.connecting).toBe(true);
    expect(next.disconnecting).toBe(false);
    expect(next.error).toBeNull();
  });

  it('connectTicketsBoardSocketSuccess marks connected', () => {
    const prev: TicketsBoardSocketState = { ...initialTicketsBoardSocketState, connecting: true, reconnecting: true };
    const next = ticketsBoardSocketReducer(prev, connectTicketsBoardSocketSuccess());

    expect(next.connected).toBe(true);
    expect(next.connecting).toBe(false);
    expect(next.reconnecting).toBe(false);
    expect(next.reconnectAttempts).toBe(0);
  });

  it('connectTicketsBoardSocketFailure resets to initial with error', () => {
    const prev: TicketsBoardSocketState = {
      ...initialTicketsBoardSocketState,
      connected: true,
      selectedClientId: 'c1',
    };
    const next = ticketsBoardSocketReducer(prev, connectTicketsBoardSocketFailure({ error: 'bad' }));

    expect(next).toEqual({ ...initialTicketsBoardSocketState, error: 'bad' });
  });

  it('disconnectTicketsBoardSocket sets disconnecting', () => {
    const next = ticketsBoardSocketReducer(initialTicketsBoardSocketState, disconnectTicketsBoardSocket());

    expect(next.disconnecting).toBe(true);
  });

  it('disconnectTicketsBoardSocketSuccess resets state', () => {
    const prev: TicketsBoardSocketState = {
      ...initialTicketsBoardSocketState,
      connected: true,
      selectedClientId: 'c1',
    };

    expect(ticketsBoardSocketReducer(prev, disconnectTicketsBoardSocketSuccess())).toEqual(
      initialTicketsBoardSocketState,
    );
  });

  it('ticketsBoardSocketReconnecting tracks attempt', () => {
    const next = ticketsBoardSocketReducer(
      initialTicketsBoardSocketState,
      ticketsBoardSocketReconnecting({ attempt: 2 }),
    );

    expect(next.reconnecting).toBe(true);
    expect(next.reconnectAttempts).toBe(2);
  });

  it('ticketsBoardSocketReconnected clears reconnect flags', () => {
    const prev: TicketsBoardSocketState = {
      ...initialTicketsBoardSocketState,
      reconnecting: true,
      reconnectAttempts: 3,
    };
    const next = ticketsBoardSocketReducer(prev, ticketsBoardSocketReconnected());

    expect(next.connected).toBe(true);
    expect(next.reconnecting).toBe(false);
    expect(next.reconnectAttempts).toBe(0);
  });

  it('ticketsBoardSocketReconnectError stores error', () => {
    const next = ticketsBoardSocketReducer(
      initialTicketsBoardSocketState,
      ticketsBoardSocketReconnectError({ error: 'e' }),
    );

    expect(next.error).toBe('e');
  });

  it('ticketsBoardSocketReconnectFailed clears connected and reconnecting', () => {
    const prev: TicketsBoardSocketState = {
      ...initialTicketsBoardSocketState,
      connected: true,
      reconnecting: true,
    };
    const next = ticketsBoardSocketReducer(prev, ticketsBoardSocketReconnectFailed({ error: 'gave up' }));

    expect(next.connected).toBe(false);
    expect(next.reconnecting).toBe(false);
    expect(next.error).toBe('gave up');
  });

  it('setTicketsBoardSocketClient marks setting in progress', () => {
    const next = ticketsBoardSocketReducer(
      initialTicketsBoardSocketState,
      setTicketsBoardSocketClient({ clientId: 'c' }),
    );

    expect(next.settingClient).toBe(true);
    expect(next.settingClientId).toBe('c');
  });

  it('setTicketsBoardSocketClientSuccess stores selected client', () => {
    const prev: TicketsBoardSocketState = {
      ...initialTicketsBoardSocketState,
      settingClient: true,
      settingClientId: 'c',
    };
    const next = ticketsBoardSocketReducer(prev, setTicketsBoardSocketClientSuccess({ message: 'ok', clientId: 'c' }));

    expect(next.selectedClientId).toBe('c');
    expect(next.settingClient).toBe(false);
    expect(next.settingClientId).toBeNull();
  });

  it('ticketsBoardSocketError clears setting client and stores message', () => {
    const prev: TicketsBoardSocketState = {
      ...initialTicketsBoardSocketState,
      settingClient: true,
      settingClientId: 'c',
    };
    const next = ticketsBoardSocketReducer(prev, ticketsBoardSocketError({ message: 'nope' }));

    expect(next.settingClient).toBe(false);
    expect(next.settingClientId).toBeNull();
    expect(next.error).toBe('nope');
  });
});
