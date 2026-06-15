import { TestBed } from '@angular/core/testing';
import { Store } from '@ngrx/store';
import { of } from 'rxjs';

import {
  chatEnhancementStarted,
  ticketBodyGenerationStarted,
  connectSocket,
  disconnectSocket,
  forwardEvent,
  setChatModel,
  setChatResponseMode,
  setClient,
} from './sockets.actions';
import { getSocketInstance } from './sockets.effects';
import { SocketsFacade } from './sockets.facade';
import { ChatActor, ForwardableEvent, type ForwardedEventPayload } from './sockets.types';

// Mock socket.io-client
jest.mock('socket.io-client', () => ({
  io: jest.fn(),
}));

// Mock getSocketInstance
jest.mock('./sockets.effects', () => ({
  getSocketInstance: jest.fn(),
}));

describe('SocketsFacade', () => {
  let facade: SocketsFacade;
  let store: jest.Mocked<Store>;
  let mockSocket: any;
  const mockForwardedPayload: ForwardedEventPayload = {
    success: true,
    data: {
      from: ChatActor.USER,
      text: 'Test message',
      timestamp: '2024-01-01T00:00:00Z',
    },
    timestamp: '2024-01-01T00:00:00Z',
  };
  const createFacadeWithMock = (mockSelectReturn: any): SocketsFacade => {
    const mockStore = {
      select: jest.fn().mockReturnValue(of(mockSelectReturn)),
      dispatch: jest.fn(),
    } as any;

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        SocketsFacade,
        {
          provide: Store,
          useValue: mockStore,
        },
      ],
    });

    return TestBed.inject(SocketsFacade);
  };

  beforeEach(() => {
    mockSocket = {
      connected: true,
      emit: jest.fn(),
      disconnect: jest.fn(),
    };

    (getSocketInstance as jest.Mock).mockReturnValue(mockSocket);

    store = {
      select: jest.fn().mockReturnValue(of(null)),
      dispatch: jest.fn(),
    } as any;

    TestBed.configureTestingModule({
      providers: [
        SocketsFacade,
        {
          provide: Store,
          useValue: store,
        },
      ],
    });

    facade = TestBed.inject(SocketsFacade);
  });

  describe('State Observables', () => {
    it('should expose connected$ observable', (done) => {
      const testFacade = createFacadeWithMock(true);

      testFacade.connected$.subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should expose connecting$ observable', (done) => {
      const testFacade = createFacadeWithMock(false);

      testFacade.connecting$.subscribe((result) => {
        expect(result).toBe(false);
        done();
      });
    });

    it('should expose disconnecting$ observable', (done) => {
      const testFacade = createFacadeWithMock(true);

      testFacade.disconnecting$.subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should expose selectedClientId$ observable', (done) => {
      const clientId = 'client-1';
      const testFacade = createFacadeWithMock(clientId);

      testFacade.selectedClientId$.subscribe((result) => {
        expect(result).toEqual(clientId);
        done();
      });
    });

    it('should expose forwarding$ observable', (done) => {
      const testFacade = createFacadeWithMock(true);

      testFacade.forwarding$.subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should expose error$ observable', (done) => {
      const error = 'Test error';
      const testFacade = createFacadeWithMock(error);

      testFacade.error$.subscribe((result) => {
        expect(result).toEqual(error);
        done();
      });
    });

    it('should expose forwardedEvents$ observable', (done) => {
      const events = [{ event: 'chatMessage', payload: mockForwardedPayload, timestamp: 1000 }];
      const testFacade = createFacadeWithMock(events);

      testFacade.forwardedEvents$.subscribe((result) => {
        expect(result).toEqual(events);
        done();
      });
    });

    it('should expose reconnecting$ observable', (done) => {
      const testFacade = createFacadeWithMock(true);

      testFacade.reconnecting$.subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should expose reconnectAttempts$ observable', (done) => {
      const testFacade = createFacadeWithMock(3);

      testFacade.reconnectAttempts$.subscribe((result) => {
        expect(result).toBe(3);
        done();
      });
    });

    it('should expose selectedAgentId$ observable', (done) => {
      const agentId = 'agent-123';
      const testFacade = createFacadeWithMock(agentId);

      testFacade.selectedAgentId$.subscribe((result) => {
        expect(result).toEqual(agentId);
        done();
      });
    });
  });

  describe('Action Methods', () => {
    it('should dispatch connectSocket action', () => {
      facade.connect();

      expect(store.dispatch).toHaveBeenCalledWith(connectSocket());
    });

    it('should dispatch disconnectSocket action', () => {
      facade.disconnect();

      expect(store.dispatch).toHaveBeenCalledWith(disconnectSocket());
    });

    it('should dispatch setClient action and emit to socket', () => {
      const clientId = 'client-1';

      // Mock state where client is not selected and not being set
      store.select = jest.fn().mockReturnValue(
        of({
          selectedClientId: null,
          settingClient: false,
          settingClientId: null,
        }),
      );
      facade.setClient(clientId);

      expect(store.dispatch).toHaveBeenCalledWith(setClient({ clientId }));
      expect(mockSocket.emit).toHaveBeenCalledWith('setClient', { clientId });
    });

    it('should not dispatch setClient if client is already selected', () => {
      const clientId = 'client-1';

      // Mock state where client is already selected
      store.select = jest.fn().mockReturnValue(
        of({
          selectedClientId: clientId,
          settingClient: false,
          settingClientId: null,
        }),
      );
      facade.setClient(clientId);

      expect(store.dispatch).not.toHaveBeenCalled();
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should not dispatch setClient if client is already being set', () => {
      const clientId = 'client-1';

      // Mock state where client is currently being set
      store.select = jest.fn().mockReturnValue(
        of({
          selectedClientId: null,
          settingClient: true,
          settingClientId: clientId,
        }),
      );
      facade.setClient(clientId);

      expect(store.dispatch).not.toHaveBeenCalled();
      expect(mockSocket.emit).not.toHaveBeenCalled();
    });

    it('should not emit to socket if not connected', () => {
      mockSocket.connected = false;
      const clientId = 'client-1';
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      facade.setClient(clientId);

      // When socket is not connected, facade returns early and doesn't dispatch
      expect(store.dispatch).not.toHaveBeenCalled();
      expect(mockSocket.emit).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Socket not connected. Cannot set client.');

      consoleSpy.mockRestore();
    });

    it('should dispatch forwardEvent action and emit to socket', () => {
      const payload = { message: 'test' };

      facade.forwardEvent(ForwardableEvent.CHAT, payload);

      expect(store.dispatch).toHaveBeenCalledWith(forwardEvent({ event: ForwardableEvent.CHAT, payload }));
      expect(mockSocket.emit).toHaveBeenCalledWith('forward', {
        event: ForwardableEvent.CHAT,
        payload,
      });
    });

    it('should not emit to socket if not connected when forwarding', () => {
      mockSocket.connected = false;
      const payload = { message: 'test' };
      const consoleSpy = jest.spyOn(console, 'warn').mockImplementation();

      facade.forwardEvent(ForwardableEvent.CHAT, payload);

      // When socket is not connected, facade returns early and doesn't dispatch
      expect(store.dispatch).not.toHaveBeenCalled();
      expect(mockSocket.emit).not.toHaveBeenCalled();
      expect(consoleSpy).toHaveBeenCalledWith('Socket not connected. Cannot forward event.');

      consoleSpy.mockRestore();
    });
  });

  describe('Helper Methods', () => {
    it('should forward chat event with typed payload and agentId', () => {
      const message = 'Hello world';
      const agentId = 'agent-1';

      facade.forwardChat(message, agentId);

      expect(store.dispatch).toHaveBeenCalledWith(
        forwardEvent({
          event: ForwardableEvent.CHAT,
          payload: { message, responseMode: 'stream' },
          agentId,
        }),
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('forward', {
        event: ForwardableEvent.CHAT,
        payload: { message, responseMode: 'stream' },
        agentId,
      });
    });

    it('should forward chat event with explicit model override', () => {
      const message = 'Hello world';
      const agentId = 'agent-1';
      const model = 'gpt-4o';

      facade.forwardChat(message, agentId, model);

      expect(store.dispatch).toHaveBeenCalledWith(
        forwardEvent({
          event: ForwardableEvent.CHAT,
          payload: { message, model, responseMode: 'stream' },
          agentId,
        }),
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('forward', {
        event: ForwardableEvent.CHAT,
        payload: { message, model, responseMode: 'stream' },
        agentId,
      });
    });

    it('should forward chat event using stored model when override not provided', () => {
      (facade as any).currentChatModel = 'stored-model';
      const message = 'Hello world';
      const agentId = 'agent-1';

      facade.forwardChat(message, agentId);

      expect(store.dispatch).toHaveBeenCalledWith(
        forwardEvent({
          event: ForwardableEvent.CHAT,
          payload: { message, model: 'stored-model', responseMode: 'stream' },
          agentId,
        }),
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('forward', {
        event: ForwardableEvent.CHAT,
        payload: { message, model: 'stored-model', responseMode: 'stream' },
        agentId,
      });
    });

    it('should forward chat with responseMode single when current mode is single', () => {
      (facade as any).currentChatResponseMode = 'single';
      const message = 'Hello world';
      const agentId = 'agent-1';

      facade.forwardChat(message, agentId);

      expect(store.dispatch).toHaveBeenCalledWith(
        forwardEvent({
          event: ForwardableEvent.CHAT,
          payload: { message, responseMode: 'single' },
          agentId,
        }),
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('forward', {
        event: ForwardableEvent.CHAT,
        payload: { message, responseMode: 'single' },
        agentId,
      });
    });

    it('should include contextInjection when forwarding chat', () => {
      const message = 'Hello world';
      const agentId = 'agent-1';
      const contextInjection = { includeWorkspace: true, environmentIds: ['agent-2'] };

      facade.forwardChat(message, agentId, null, contextInjection);

      expect(mockSocket.emit).toHaveBeenCalledWith('forward', {
        event: ForwardableEvent.CHAT,
        payload: { message, responseMode: 'stream', contextInjection },
        agentId,
      });
    });

    it('should dispatch setChatResponseMode', () => {
      facade.setChatResponseMode('single');
      expect(store.dispatch).toHaveBeenCalledWith(setChatResponseMode({ mode: 'single' }));
    });

    it('should forward enhance chat with correlation id and dispatch chatEnhancementStarted', () => {
      const message = 'draft';
      const agentId = 'agent-1';
      const correlationId = 'cid-1';

      facade.forwardEnhanceChat(message, agentId, correlationId);

      expect(store.dispatch).toHaveBeenCalledWith(chatEnhancementStarted({ correlationId }));
      expect(store.dispatch).toHaveBeenCalledWith(
        forwardEvent({
          event: ForwardableEvent.ENHANCE_CHAT,
          payload: { message, correlationId },
          agentId,
        }),
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('forward', {
        event: ForwardableEvent.ENHANCE_CHAT,
        payload: { message, correlationId },
        agentId,
      });
    });

    it('should forward generateTicketBody with correlation id and dispatch ticketBodyGenerationStarted', () => {
      const title = 'Ship feature';
      const agentId = 'agent-1';
      const correlationId = 'tb-cid';

      facade.forwardGenerateTicketBody(title, agentId, correlationId);

      expect(store.dispatch).toHaveBeenCalledWith(ticketBodyGenerationStarted({ correlationId }));
      expect(store.dispatch).toHaveBeenCalledWith(
        forwardEvent({
          event: ForwardableEvent.GENERATE_TICKET_BODY,
          payload: { title, correlationId },
          agentId,
        }),
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('forward', {
        event: ForwardableEvent.GENERATE_TICKET_BODY,
        payload: { title, correlationId },
        agentId,
      });
    });

    it('should forward generateTicketBody with optional hierarchyContext', () => {
      const title = 'Ship feature';
      const agentId = 'agent-1';
      const correlationId = 'tb-cid';
      const hierarchyContext = 'Subtasks under this ticket:\n- [a] Child (todo, low)';

      facade.forwardGenerateTicketBody(title, agentId, correlationId, undefined, hierarchyContext);

      expect(mockSocket.emit).toHaveBeenCalledWith('forward', {
        event: ForwardableEvent.GENERATE_TICKET_BODY,
        payload: { title, correlationId, hierarchyContext },
        agentId,
      });
    });

    it('should forward login event with agentId', () => {
      const agentId = 'agent-1';

      facade.forwardLogin(agentId);

      expect(store.dispatch).toHaveBeenCalledWith(
        forwardEvent({ event: ForwardableEvent.LOGIN, payload: undefined, agentId }),
      );
      expect(mockSocket.emit).toHaveBeenCalledWith('forward', {
        event: ForwardableEvent.LOGIN,
        payload: undefined,
        agentId,
      });
    });

    it('should forward logout event', () => {
      facade.forwardLogout();

      expect(store.dispatch).toHaveBeenCalledWith(forwardEvent({ event: ForwardableEvent.LOGOUT, payload: {} }));
      expect(mockSocket.emit).toHaveBeenCalledWith('forward', {
        event: ForwardableEvent.LOGOUT,
        payload: {},
      });
    });
  });

  describe('Chat Model', () => {
    it('should dispatch setChatModel action', () => {
      const model = 'gpt-4o';

      facade.setChatModel(model);

      expect(store.dispatch).toHaveBeenCalledWith(setChatModel({ model }));
    });
  });

  describe('Forwarded Events Observables', () => {
    it('should return forwarded events by event name', (done) => {
      const events = [
        { event: 'chatMessage', payload: mockForwardedPayload, timestamp: 1000 },
        { event: 'loginSuccess', payload: mockForwardedPayload, timestamp: 2000 },
      ];
      // Mock the filtered result (only chatMessage events)
      const filteredEvents = [events[0]];
      const testFacade = createFacadeWithMock(filteredEvents);

      testFacade.getForwardedEventsByEvent$('chatMessage').subscribe((result) => {
        expect(result).toEqual(filteredEvents);
        done();
      });
    });

    it('should return most recent forwarded event', (done) => {
      const event = { event: 'chatMessage', payload: mockForwardedPayload, timestamp: 1000 };
      const testFacade = createFacadeWithMock(event);

      testFacade.getMostRecentForwardedEvent$().subscribe((result) => {
        expect(result).toEqual(event);
        done();
      });
    });

    it('should return most recent forwarded event by event name', (done) => {
      const event = { event: 'chatMessage', payload: mockForwardedPayload, timestamp: 1000 };
      const testFacade = createFacadeWithMock(event);

      testFacade.getMostRecentForwardedEventByEvent$('chatMessage').subscribe((result) => {
        expect(result).toEqual(event);
        done();
      });
    });
  });

  describe('messageFilterResults$', () => {
    it('should emit messageFilterResults from state', (done) => {
      const filterResults = [
        {
          direction: 'incoming' as const,
          status: 'filtered' as const,
          message: 'Test message',
          appliedFilters: [
            {
              type: 'incoming-filter',
              displayName: 'Incoming Filter',
              matched: true,
              reason: 'Test filter matched',
            },
          ],
          matchedFilter: {
            type: 'incoming-filter',
            displayName: 'Incoming Filter',
            matched: true,
            reason: 'Test filter matched',
          },
          action: 'flag' as const,
          timestamp: 1000,
          receivedAt: 1000,
        },
      ];
      const testFacade = createFacadeWithMock(filterResults);

      testFacade.messageFilterResults$.subscribe((result) => {
        expect(result).toEqual(filterResults);
        done();
      });
    });

    it('should emit empty array when no filter results', (done) => {
      const testFacade = createFacadeWithMock([]);

      testFacade.messageFilterResults$.subscribe((result) => {
        expect(result).toEqual([]);
        done();
      });
    });
  });

  describe('Remote Connection State Methods', () => {
    it('should return remote connection state for a specific clientId', (done) => {
      const remoteConnection = {
        clientId: 'client-1',
        connected: true,
        reconnecting: false,
        reconnectAttempts: 0,
        lastError: null,
      };
      const testFacade = createFacadeWithMock(remoteConnection);

      testFacade.getRemoteConnectionState$('client-1').subscribe((result) => {
        expect(result).toEqual(remoteConnection);
        done();
      });
    });

    it('should return null when clientId does not exist', (done) => {
      const testFacade = createFacadeWithMock(null);

      testFacade.getRemoteConnectionState$('client-1').subscribe((result) => {
        expect(result).toBeNull();
        done();
      });
    });

    it('should return true when remote connection is reconnecting', (done) => {
      const testFacade = createFacadeWithMock(true);

      testFacade.isRemoteReconnecting$('client-1').subscribe((result) => {
        expect(result).toBe(true);
        done();
      });
    });

    it('should return false when remote connection is not reconnecting', (done) => {
      const testFacade = createFacadeWithMock(false);

      testFacade.isRemoteReconnecting$('client-1').subscribe((result) => {
        expect(result).toBe(false);
        done();
      });
    });

    it('should return error when remote connection has error', (done) => {
      const error = 'Reconnection failed';
      const testFacade = createFacadeWithMock(error);

      testFacade.getRemoteConnectionError$('client-1').subscribe((result) => {
        expect(result).toEqual(error);
        done();
      });
    });

    it('should return null when remote connection has no error', (done) => {
      const testFacade = createFacadeWithMock(null);

      testFacade.getRemoteConnectionError$('client-1').subscribe((result) => {
        expect(result).toBeNull();
        done();
      });
    });
  });
});
