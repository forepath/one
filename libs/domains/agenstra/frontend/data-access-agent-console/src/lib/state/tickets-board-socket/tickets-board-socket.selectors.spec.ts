import { initialTicketsBoardSocketState, type TicketsBoardSocketState } from './tickets-board-socket.reducer';
import {
  selectTicketsBoardSocketConnected,
  selectTicketsBoardSocketError,
  selectTicketsBoardSocketSelectedClientId,
  selectTicketsBoardSocketState,
} from './tickets-board-socket.selectors';

describe('ticketsBoardSocketSelectors', () => {
  const createSlice = (overrides?: Partial<TicketsBoardSocketState>): TicketsBoardSocketState => ({
    ...initialTicketsBoardSocketState,
    ...overrides,
  });

  it('selectTicketsBoardSocketState returns feature slice', () => {
    const slice = createSlice({ connected: true });
    const root = { ticketsBoardSocket: slice };

    expect(selectTicketsBoardSocketState(root as never)).toEqual(slice);
  });

  it('selectTicketsBoardSocketConnected returns connected flag', () => {
    const root = { ticketsBoardSocket: createSlice({ connected: true }) };

    expect(selectTicketsBoardSocketConnected(root as never)).toBe(true);
  });

  it('selectTicketsBoardSocketSelectedClientId returns selected id', () => {
    const root = { ticketsBoardSocket: createSlice({ selectedClientId: 'client-x' }) };

    expect(selectTicketsBoardSocketSelectedClientId(root as never)).toBe('client-x');
  });

  it('selectTicketsBoardSocketError returns error string', () => {
    const root = { ticketsBoardSocket: createSlice({ error: 'failed' }) };

    expect(selectTicketsBoardSocketError(root as never)).toBe('failed');
  });
});
