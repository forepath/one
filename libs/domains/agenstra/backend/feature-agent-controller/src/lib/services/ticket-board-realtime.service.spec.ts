import type { Server } from 'socket.io';

import { TICKETS_BOARD_EVENTS } from './ticket-board-realtime.constants';
import { TicketBoardRealtimeService } from './ticket-board-realtime.service';
import { WorkspaceGraphChangeNotifierService } from './workspace-graph-change-notifier.service';

describe('TicketBoardRealtimeService', () => {
  it('clientRoom returns stable Socket.IO room name', () => {
    expect(TicketBoardRealtimeService.clientRoom('abc-123')).toBe('client:abc-123');
  });

  it('emitToClient is a no-op when server has not been attached', () => {
    const service = new TicketBoardRealtimeService();

    expect(() => service.emitToClient('client-1', TICKETS_BOARD_EVENTS.ticketUpsert, { id: 't1' })).not.toThrow();
  });

  it('emitToClient targets the client room on the attached server', () => {
    const service = new TicketBoardRealtimeService();
    const emit = jest.fn();
    const to = jest.fn().mockReturnValue({ emit });
    const server = { to } as Pick<Server, 'to'>;

    service.attachServer(server as Server);
    service.emitToClient('client-1', TICKETS_BOARD_EVENTS.ticketRemoved, { id: 't1', clientId: 'client-1' });
    // Workspace room for interactive sockets plus the per-event room for permitted PAT / app token sockets.
    expect(to).toHaveBeenCalledWith(['client:client-1', 'client:client-1#event:ticketRemoved']);
    expect(emit).toHaveBeenCalledWith(TICKETS_BOARD_EVENTS.ticketRemoved, { id: 't1', clientId: 'client-1' });
  });

  it('signals graph-relevant ticket changes even without an attached server', () => {
    const changes = new WorkspaceGraphChangeNotifierService();
    const listener = jest.fn();

    changes.register(listener);

    const service = new TicketBoardRealtimeService(changes);

    service.emitToClient('client-1', TICKETS_BOARD_EVENTS.ticketUpsert, { id: 't1' });
    service.emitToClient('client-1', TICKETS_BOARD_EVENTS.ticketRemoved, { id: 't1' });
    service.emitToClient('client-1', TICKETS_BOARD_EVENTS.ticketCommentCreated, { id: 'c1' });
    service.emitToClient('client-1', TICKETS_BOARD_EVENTS.ticketAutomationRunUpsert, { id: 'r1' });
    expect(listener.mock.calls).toEqual([
      ['client-1', 'ticketUpsert'],
      ['client-1', 'ticketRemoved'],
    ]);
  });
});
