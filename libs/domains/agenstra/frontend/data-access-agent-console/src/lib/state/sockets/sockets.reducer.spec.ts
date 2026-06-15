import {
  chatEnhancementStarted,
  clearChatHistory,
  connectSocket,
  connectSocketFailure,
  connectSocketSuccess,
  disconnectSocket,
  disconnectSocketSuccess,
  forwardedEventReceived,
  forwardEvent,
  forwardEventFailure,
  forwardEventSuccess,
  remoteDisconnected,
  remoteReconnected,
  remoteReconnectError,
  remoteReconnectFailed,
  remoteReconnecting,
  setAgent,
  setChatModel,
  setChatResponseMode,
  setClient,
  setClientFailure,
  setClientSuccess,
  socketError,
  socketReconnected,
  socketReconnectError,
  socketReconnectFailed,
  socketReconnecting,
  ticketBodyGenerationStarted,
} from './sockets.actions';
import { initialSocketsState, socketsReducer, type SocketsState } from './sockets.reducer';
import { ChatActor, ForwardableEvent, type ForwardedEventPayload } from './sockets.types';

describe('socketsReducer', () => {
  const mockForwardedPayload: ForwardedEventPayload = {
    success: true,
    data: {
      from: ChatActor.USER,
      text: 'Test message',
      timestamp: '2024-01-01T00:00:00Z',
    },
    timestamp: '2024-01-01T00:00:00Z',
  };

  describe('initial state', () => {
    it('should return the initial state', () => {
      const action = { type: 'UNKNOWN' };
      const state = socketsReducer(undefined, action as any);

      expect(state).toEqual(initialSocketsState);
    });
  });

  describe('connectSocket', () => {
    it('should set connecting to true and clear error', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        error: 'Previous error',
      };
      const newState = socketsReducer(state, connectSocket());

      expect(newState.connecting).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('connectSocketSuccess', () => {
    it('should set connected to true and connecting to false', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        connecting: true,
      };
      const newState = socketsReducer(state, connectSocketSuccess());

      expect(newState.connected).toBe(true);
      expect(newState.connecting).toBe(false);
      expect(newState.error).toBeNull();
    });
  });

  describe('connectSocketFailure', () => {
    it('should set error and set connecting to false', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        connecting: true,
      };
      const newState = socketsReducer(state, connectSocketFailure({ error: 'Connection failed' }));

      expect(newState.error).toBe('Connection failed');
      expect(newState.connected).toBe(false);
      expect(newState.connecting).toBe(false);
    });
  });

  describe('disconnectSocket', () => {
    it('should set disconnecting to true and clear error', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        error: 'Previous error',
      };
      const newState = socketsReducer(state, disconnectSocket());

      expect(newState.disconnecting).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('disconnectSocketSuccess', () => {
    it('should reset connection state and clear forwarded events', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        connected: true,
        selectedClientId: 'client-1',
        selectedAgentId: 'agent-1',
        forwardedEvents: [{ event: 'chatMessage', payload: mockForwardedPayload, timestamp: Date.now() }],
        disconnecting: true,
      };
      const newState = socketsReducer(state, disconnectSocketSuccess());

      expect(newState.connected).toBe(false);
      expect(newState.disconnecting).toBe(false);
      expect(newState.selectedClientId).toBeNull();
      expect(newState.selectedAgentId).toBeNull();
      expect(newState.forwardedEvents).toEqual([]);
      expect(newState.error).toBeNull();
    });
  });

  describe('setClient', () => {
    it('should clear error and set settingClient flag', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        error: 'Previous error',
      };
      const newState = socketsReducer(state, setClient({ clientId: 'client-1' }));

      expect(newState.error).toBeNull();
      expect(newState.settingClient).toBe(true);
      expect(newState.settingClientId).toBe('client-1');
    });
  });

  describe('setClientSuccess', () => {
    it('should set selectedClientId and clear settingClient flag', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        settingClient: true,
        settingClientId: 'client-1',
      };
      const newState = socketsReducer(state, setClientSuccess({ message: 'Client set', clientId: 'client-1' }));

      expect(newState.selectedClientId).toBe('client-1');
      expect(newState.error).toBeNull();
      expect(newState.settingClient).toBe(false);
      expect(newState.settingClientId).toBeNull();
    });

    it('should clear forwardedEvents on reconnection (same clientId with existing events)', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        selectedClientId: 'client-1',
        forwardedEvents: [
          { event: 'chatMessage', payload: mockForwardedPayload, timestamp: 1000 },
          { event: 'loginSuccess', payload: mockForwardedPayload, timestamp: 2000 },
        ],
        messageFilterResults: [
          {
            direction: 'incoming',
            status: 'filtered',
            message: 'Test',
            appliedFilters: [],
            timestamp: 1000,
            receivedAt: 1000,
          },
        ],
      };
      const newState = socketsReducer(state, setClientSuccess({ message: 'Client set', clientId: 'client-1' }));

      expect(newState.forwardedEvents).toEqual([]);
      expect(newState.messageFilterResults).toEqual([]);
    });

    it('should not clear forwardedEvents on initial connection (different clientId)', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        selectedClientId: 'client-1',
        forwardedEvents: [{ event: 'chatMessage', payload: mockForwardedPayload, timestamp: 1000 }],
      };
      const newState = socketsReducer(state, setClientSuccess({ message: 'Client set', clientId: 'client-2' }));

      expect(newState.forwardedEvents).toEqual([
        { event: 'chatMessage', payload: mockForwardedPayload, timestamp: 1000 },
      ]);
    });

    it('should not clear forwardedEvents on initial connection (no existing events)', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        selectedClientId: 'client-1',
        forwardedEvents: [],
      };
      const newState = socketsReducer(state, setClientSuccess({ message: 'Client set', clientId: 'client-1' }));

      expect(newState.forwardedEvents).toEqual([]);
    });
  });

  describe('setClientFailure', () => {
    it('should set error and clear settingClient flag', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        settingClient: true,
        settingClientId: 'client-1',
      };
      const newState = socketsReducer(state, setClientFailure({ error: 'Set client failed' }));

      expect(newState.error).toBe('Set client failed');
      expect(newState.settingClient).toBe(false);
      expect(newState.settingClientId).toBeNull();
    });
  });

  describe('setChatModel', () => {
    it('should update chatModel value', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        chatModel: null,
      };
      const newState = socketsReducer(state, setChatModel({ model: 'gpt-4o' }));

      expect(newState.chatModel).toBe('gpt-4o');
    });
  });

  describe('setChatResponseMode', () => {
    it('should update chatResponseMode', () => {
      const state = { ...initialSocketsState, chatResponseMode: 'stream' as const };
      const newState = socketsReducer(state, setChatResponseMode({ mode: 'single' }));

      expect(newState.chatResponseMode).toBe('single');
    });
  });

  describe('forwardEvent', () => {
    it('should set forwarding to true and clear error', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        error: 'Previous error',
      };
      const newState = socketsReducer(
        state,
        forwardEvent({ event: ForwardableEvent.CHAT, payload: { message: 'test' } }),
      );

      expect(newState.forwarding).toBe(true);
      expect(newState.error).toBeNull();
    });
  });

  describe('forwardEventSuccess', () => {
    it('should set forwarding to false', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        forwarding: true,
        forwardingEvent: ForwardableEvent.CHAT,
      };
      const newState = socketsReducer(state, forwardEventSuccess({ received: true, event: ForwardableEvent.CHAT }));

      expect(newState.forwarding).toBe(false);
      expect(newState.error).toBeNull();
    });
  });

  describe('forwardEventFailure', () => {
    it('should set error and set forwarding to false', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        forwarding: true,
      };
      const newState = socketsReducer(state, forwardEventFailure({ error: 'Forward failed' }));

      expect(newState.error).toBe('Forward failed');
      expect(newState.forwarding).toBe(false);
    });

    it('should clear chat enhancement pending when enhance forward fails', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        forwarding: true,
        forwardingEvent: ForwardableEvent.ENHANCE_CHAT,
        chatEnhancementPendingCorrelationId: 'corr-1',
      };
      const newState = socketsReducer(state, forwardEventFailure({ error: 'Network error' }));

      expect(newState.chatEnhancementPendingCorrelationId).toBeNull();
      expect(newState.chatEnhancementLastResult).toEqual({
        correlationId: 'corr-1',
        success: false,
        errorMessage: 'Network error',
      });
    });

    it('should clear ticket body pending when generateTicketBody forward fails', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        forwarding: true,
        forwardingEvent: ForwardableEvent.GENERATE_TICKET_BODY,
        ticketBodyPendingCorrelationId: 'tb-1',
      };
      const newState = socketsReducer(state, forwardEventFailure({ error: 'Network error' }));

      expect(newState.ticketBodyPendingCorrelationId).toBeNull();
      expect(newState.ticketBodyLastResult).toEqual({
        correlationId: 'tb-1',
        success: false,
        errorMessage: 'Network error',
      });
    });
  });

  describe('ticketBodyGenerationStarted', () => {
    it('should set pending correlation and clear last result', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        ticketBodyLastResult: {
          correlationId: 'old',
          success: true,
          enhancedText: 'x',
        },
      };
      const newState = socketsReducer(state, ticketBodyGenerationStarted({ correlationId: 'tb-2' }));

      expect(newState.ticketBodyPendingCorrelationId).toBe('tb-2');
      expect(newState.ticketBodyLastResult).toBeNull();
    });
  });

  describe('chatEnhancementStarted', () => {
    it('should set pending correlation and clear last result', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        chatEnhancementLastResult: {
          correlationId: 'old',
          success: true,
          enhancedText: 'x',
        },
      };
      const newState = socketsReducer(state, chatEnhancementStarted({ correlationId: 'corr-2' }));

      expect(newState.chatEnhancementPendingCorrelationId).toBe('corr-2');
      expect(newState.chatEnhancementLastResult).toBeNull();
    });
  });

  describe('socketError', () => {
    it('should set error message', () => {
      const state: SocketsState = {
        ...initialSocketsState,
      };
      const newState = socketsReducer(state, socketError({ message: 'Socket error' }));

      expect(newState.error).toBe('Socket error');
    });

    it('should fail pending enhancement when socket errors', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        chatEnhancementPendingCorrelationId: 'corr-9',
      };
      const newState = socketsReducer(state, socketError({ message: 'boom' }));

      expect(newState.chatEnhancementPendingCorrelationId).toBeNull();
      expect(newState.chatEnhancementLastResult?.success).toBe(false);
      expect(newState.chatEnhancementLastResult?.errorMessage).toBe('boom');
    });

    it('should fail pending ticket body generation when socket errors', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        ticketBodyPendingCorrelationId: 'tb-9',
      };
      const newState = socketsReducer(state, socketError({ message: 'boom' }));

      expect(newState.ticketBodyPendingCorrelationId).toBeNull();
      expect(newState.ticketBodyLastResult?.success).toBe(false);
      expect(newState.ticketBodyLastResult?.errorMessage).toBe('boom');
    });
  });

  describe('forwardedEventReceived', () => {
    it('should add event to forwardedEvents array', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        forwardedEvents: [],
      };
      const timestamp = Date.now();

      jest.spyOn(Date, 'now').mockReturnValue(timestamp);

      const newState = socketsReducer(
        state,
        forwardedEventReceived({ event: 'chatMessage', payload: mockForwardedPayload }),
      );

      expect(newState.forwardedEvents).toEqual([{ event: 'chatMessage', payload: mockForwardedPayload, timestamp }]);

      jest.spyOn(Date, 'now').mockRestore();
    });

    it('stores ticketAutomationRunChatUpsert with timestamp from timelineAt', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        forwardedEvents: [],
      };
      const timelineMs = Date.parse('2022-06-15T12:00:00.000Z');
      const payload = {
        timelineAt: '2022-06-15T12:00:00.000Z',
        hydrate: false,
        ticket: {
          id: 't1',
          clientId: 'c1',
          title: 'x',
          priority: 'low',
          status: 'todo',
          automationEligible: false,
          preferredChatAgentId: null,
          createdAt: '',
          updatedAt: '',
        },
        run: {
          id: 'r1',
          ticketId: 't1',
          clientId: 'c1',
          agentId: 'a1',
          status: 'running',
          phase: 'iterate',
          startedAt: '2022-06-15T11:00:00.000Z',
          updatedAt: '2022-06-15T12:00:00.000Z',
          finishedAt: null,
        },
        actions: [],
      };
      const newState = socketsReducer(
        state,
        forwardedEventReceived({ event: 'ticketAutomationRunChatUpsert', payload: payload as never }),
      );

      expect(newState.forwardedEvents[0]?.timestamp).toBe(timelineMs);
    });

    it('should handle chatEnhanceResult without appending to forwardedEvents', () => {
      const timestamp = Date.now();

      jest.spyOn(Date, 'now').mockReturnValue(timestamp);

      const enhancePayload: ForwardedEventPayload = {
        success: true,
        data: {
          correlationId: 'c1',
          success: true,
          enhancedText: 'Improved prompt',
        },
        timestamp: '2024-01-01T00:00:00Z',
      };
      const state: SocketsState = {
        ...initialSocketsState,
        forwardedEvents: [{ event: 'chatMessage', payload: mockForwardedPayload, timestamp: 1 }],
        chatEnhancementPendingCorrelationId: 'c1',
      };
      const newState = socketsReducer(
        state,
        forwardedEventReceived({ event: 'chatEnhanceResult', payload: enhancePayload }),
      );

      expect(newState.forwardedEvents.length).toBe(1);
      expect(newState.chatEnhancementPendingCorrelationId).toBeNull();
      expect(newState.chatEnhancementLastResult).toEqual({
        correlationId: 'c1',
        success: true,
        enhancedText: 'Improved prompt',
      });

      jest.spyOn(Date, 'now').mockRestore();
    });

    it('should handle ticketBodyResult without appending to forwardedEvents', () => {
      const timestamp = Date.now();

      jest.spyOn(Date, 'now').mockReturnValue(timestamp);

      const bodyPayload: ForwardedEventPayload = {
        success: true,
        data: {
          correlationId: 't1',
          success: true,
          enhancedText: '## Acceptance\n- Done',
        },
        timestamp: '2024-01-01T00:00:00Z',
      };
      const state: SocketsState = {
        ...initialSocketsState,
        forwardedEvents: [{ event: 'chatMessage', payload: mockForwardedPayload, timestamp: 1 }],
        ticketBodyPendingCorrelationId: 't1',
      };
      const newState = socketsReducer(
        state,
        forwardedEventReceived({ event: 'ticketBodyResult', payload: bodyPayload }),
      );

      expect(newState.forwardedEvents.length).toBe(1);
      expect(newState.ticketBodyPendingCorrelationId).toBeNull();
      expect(newState.ticketBodyLastResult).toEqual({
        correlationId: 't1',
        success: true,
        enhancedText: '## Acceptance\n- Done',
      });

      jest.spyOn(Date, 'now').mockRestore();
    });

    it('should set selectedAgentId from loginSuccess payload', () => {
      const loginSuccessPayload: ForwardedEventPayload = {
        success: true,
        data: {
          message: 'Welcome',
          agentId: 'agent-123',
          agentName: 'Test Agent',
        },
        timestamp: '2024-01-01T00:00:00.000Z',
      };
      const state: SocketsState = {
        ...initialSocketsState,
        selectedAgentId: null,
      };
      const newState = socketsReducer(
        state,
        forwardedEventReceived({ event: 'loginSuccess', payload: loginSuccessPayload }),
      );

      expect(newState.selectedAgentId).toBe('agent-123');
    });

    it('should clear selectedAgentId on logoutSuccess', () => {
      const logoutSuccessPayload: ForwardedEventPayload = {
        success: true,
        data: {
          message: 'Logged out',
          agentId: null,
          agentName: null,
        },
        timestamp: '2024-01-01T00:00:00.000Z',
      };
      const state: SocketsState = {
        ...initialSocketsState,
        selectedAgentId: 'agent-123',
      };
      const newState = socketsReducer(
        state,
        forwardedEventReceived({ event: 'logoutSuccess', payload: logoutSuccessPayload }),
      );

      expect(newState.selectedAgentId).toBeNull();
    });

    it('should not change selectedAgentId for other events', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        selectedAgentId: 'agent-123',
      };
      const newState = socketsReducer(
        state,
        forwardedEventReceived({ event: 'chatMessage', payload: mockForwardedPayload }),
      );

      expect(newState.selectedAgentId).toBe('agent-123');
    });

    it('should store messageFilterResult events in messageFilterResults array', () => {
      const filterResultPayload: ForwardedEventPayload = {
        success: true,
        data: {
          direction: 'incoming',
          status: 'filtered',
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
          action: 'flag',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        timestamp: '2024-01-01T00:00:00.000Z',
      };
      const state: SocketsState = {
        ...initialSocketsState,
        messageFilterResults: [],
      };
      const receivedAt = Date.now();

      jest.spyOn(Date, 'now').mockReturnValue(receivedAt);

      const newState = socketsReducer(
        state,
        forwardedEventReceived({ event: 'messageFilterResult', payload: filterResultPayload }),
      );

      expect(newState.messageFilterResults).toHaveLength(1);
      expect(newState.messageFilterResults[0]).toEqual({
        direction: 'incoming',
        status: 'filtered',
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
        action: 'flag',
        timestamp: new Date('2024-01-01T00:00:00.000Z').getTime(),
        receivedAt,
      });

      jest.spyOn(Date, 'now').mockRestore();
    });

    it('should handle messageFilterResult with dropped status', () => {
      const filterResultPayload: ForwardedEventPayload = {
        success: true,
        data: {
          direction: 'outgoing',
          status: 'dropped',
          message: 'Test response',
          appliedFilters: [
            {
              type: 'outgoing-filter',
              displayName: 'Outgoing Filter',
              matched: true,
              reason: 'Outgoing filter matched',
            },
          ],
          matchedFilter: {
            type: 'outgoing-filter',
            displayName: 'Outgoing Filter',
            matched: true,
            reason: 'Outgoing filter matched',
          },
          action: 'drop',
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        timestamp: '2024-01-01T00:00:00.000Z',
      };
      const state: SocketsState = {
        ...initialSocketsState,
        messageFilterResults: [],
      };
      const receivedAt = Date.now();

      jest.spyOn(Date, 'now').mockReturnValue(receivedAt);

      const newState = socketsReducer(
        state,
        forwardedEventReceived({ event: 'messageFilterResult', payload: filterResultPayload }),
      );

      expect(newState.messageFilterResults).toHaveLength(1);
      expect(newState.messageFilterResults[0].status).toBe('dropped');
      expect(newState.messageFilterResults[0].action).toBe('drop');
      expect(newState.messageFilterResults[0].direction).toBe('outgoing');

      jest.spyOn(Date, 'now').mockRestore();
    });

    it('should handle messageFilterResult with allowed status', () => {
      const filterResultPayload: ForwardedEventPayload = {
        success: true,
        data: {
          direction: 'incoming',
          status: 'allowed',
          message: 'Test message',
          appliedFilters: [
            {
              type: 'incoming-filter',
              displayName: 'Incoming Filter',
              matched: false,
            },
          ],
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        timestamp: '2024-01-01T00:00:00.000Z',
      };
      const state: SocketsState = {
        ...initialSocketsState,
        messageFilterResults: [],
      };
      const receivedAt = Date.now();

      jest.spyOn(Date, 'now').mockReturnValue(receivedAt);

      const newState = socketsReducer(
        state,
        forwardedEventReceived({ event: 'messageFilterResult', payload: filterResultPayload }),
      );

      expect(newState.messageFilterResults).toHaveLength(1);
      expect(newState.messageFilterResults[0].status).toBe('allowed');
      expect(newState.messageFilterResults[0].action).toBeUndefined();

      jest.spyOn(Date, 'now').mockRestore();
    });

    it('should still add messageFilterResult to forwardedEvents array', () => {
      const filterResultPayload: ForwardedEventPayload = {
        success: true,
        data: {
          direction: 'incoming',
          status: 'filtered',
          message: 'Test message',
          appliedFilters: [],
          timestamp: '2024-01-01T00:00:00.000Z',
        },
        timestamp: '2024-01-01T00:00:00.000Z',
      };
      const state: SocketsState = {
        ...initialSocketsState,
        forwardedEvents: [],
        messageFilterResults: [],
      };
      const timestamp = Date.now();

      jest.spyOn(Date, 'now').mockReturnValue(timestamp);

      const newState = socketsReducer(
        state,
        forwardedEventReceived({ event: 'messageFilterResult', payload: filterResultPayload }),
      );

      expect(newState.forwardedEvents).toHaveLength(1);
      expect(newState.forwardedEvents[0].event).toBe('messageFilterResult');
      expect(newState.messageFilterResults).toHaveLength(1);

      jest.spyOn(Date, 'now').mockRestore();
    });
  });

  describe('setAgent', () => {
    it('should set the selected agent ID', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        selectedAgentId: null,
      };
      const newState = socketsReducer(state, setAgent({ agentId: 'agent-123' }));

      expect(newState.selectedAgentId).toBe('agent-123');
    });

    it('should clear the selected agent ID when set to null', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        selectedAgentId: 'agent-123',
      };
      const newState = socketsReducer(state, setAgent({ agentId: null }));

      expect(newState.selectedAgentId).toBeNull();
    });
  });

  describe('clearChatHistory', () => {
    it('should clear forwardedEvents and messageFilterResults', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        forwardedEvents: [
          {
            event: 'chatMessage',
            payload: mockForwardedPayload,
            timestamp: Date.now(),
          },
        ],
        messageFilterResults: [
          {
            direction: 'incoming',
            status: 'allowed',
            message: 'Test message',
            appliedFilters: [],
            timestamp: Date.now(),
            receivedAt: Date.now(),
          },
        ],
      };
      const newState = socketsReducer(state, clearChatHistory());

      expect(newState.forwardedEvents).toEqual([]);
      expect(newState.messageFilterResults).toEqual([]);
    });

    it('should preserve other state properties', () => {
      const state: SocketsState = {
        ...initialSocketsState,
        connected: true,
        selectedClientId: 'client-1',
        selectedAgentId: 'agent-1',
        forwardedEvents: [
          {
            event: 'chatMessage',
            payload: mockForwardedPayload,
            timestamp: Date.now(),
          },
        ],
        messageFilterResults: [
          {
            direction: 'incoming',
            status: 'allowed',
            message: 'Test message',
            appliedFilters: [],
            timestamp: Date.now(),
            receivedAt: Date.now(),
          },
        ],
      };
      const newState = socketsReducer(state, clearChatHistory());

      expect(newState.connected).toBe(true);
      expect(newState.selectedClientId).toBe('client-1');
      expect(newState.selectedAgentId).toBe('agent-1');
      expect(newState.forwardedEvents).toEqual([]);
      expect(newState.messageFilterResults).toEqual([]);
    });
  });

  describe('Main Socket Reconnection', () => {
    describe('socketReconnecting', () => {
      it('should set reconnecting to true and update reconnectAttempts', () => {
        const state: SocketsState = {
          ...initialSocketsState,
          connected: true,
        };
        const newState = socketsReducer(state, socketReconnecting({ attempt: 2 }));

        expect(newState.reconnecting).toBe(true);
        expect(newState.reconnectAttempts).toBe(2);
        expect(newState.error).toBeNull(); // Should clear error while reconnecting
      });
    });

    describe('socketReconnected', () => {
      it('should set connected to true and clear reconnecting state', () => {
        const state: SocketsState = {
          ...initialSocketsState,
          reconnecting: true,
          reconnectAttempts: 3,
        };
        const newState = socketsReducer(state, socketReconnected());

        expect(newState.connected).toBe(true);
        expect(newState.reconnecting).toBe(false);
        expect(newState.reconnectAttempts).toBe(0);
        expect(newState.error).toBeNull();
      });

      it('should clear forwardedEvents on reconnection to prevent duplicates', () => {
        const state: SocketsState = {
          ...initialSocketsState,
          reconnecting: true,
          reconnectAttempts: 2,
          forwardedEvents: [
            { event: 'chatMessage', payload: mockForwardedPayload, timestamp: 1000 },
            { event: 'loginSuccess', payload: mockForwardedPayload, timestamp: 2000 },
          ],
        };
        const newState = socketsReducer(state, socketReconnected());

        expect(newState.forwardedEvents).toEqual([]);
      });
    });

    describe('socketReconnectError', () => {
      it('should keep reconnecting state true', () => {
        const state: SocketsState = {
          ...initialSocketsState,
          reconnecting: true,
          reconnectAttempts: 2,
        };
        const newState = socketsReducer(state, socketReconnectError({ error: 'Reconnection error' }));

        expect(newState.reconnecting).toBe(true);
        // Error should not be set while still reconnecting
      });
    });

    describe('socketReconnectFailed', () => {
      it('should set error and clear reconnecting state', () => {
        const state: SocketsState = {
          ...initialSocketsState,
          reconnecting: true,
          reconnectAttempts: 5,
        };
        const newState = socketsReducer(state, socketReconnectFailed({ error: 'Reconnection failed' }));

        expect(newState.connected).toBe(false);
        expect(newState.reconnecting).toBe(false);
        expect(newState.reconnectAttempts).toBe(0);
        expect(newState.error).toBe('Reconnection failed');
      });
    });
  });

  describe('Remote Connection Reconnection (per clientId)', () => {
    describe('remoteDisconnected', () => {
      it('should initialize remote connection state if not exists and set connected to false', () => {
        const state: SocketsState = {
          ...initialSocketsState,
        };
        const newState = socketsReducer(state, remoteDisconnected({ clientId: 'client-1' }));

        expect(newState.remoteConnections['client-1']).toEqual({
          clientId: 'client-1',
          connected: false,
          reconnecting: false,
          reconnectAttempts: 0,
          lastError: null,
        });
      });

      it('should update existing remote connection state to disconnected', () => {
        const state: SocketsState = {
          ...initialSocketsState,
          remoteConnections: {
            'client-1': {
              clientId: 'client-1',
              connected: true,
              reconnecting: false,
              reconnectAttempts: 0,
              lastError: null,
            },
          },
        };
        const newState = socketsReducer(state, remoteDisconnected({ clientId: 'client-1' }));

        expect(newState.remoteConnections['client-1']).toEqual({
          clientId: 'client-1',
          connected: false,
          reconnecting: false,
          reconnectAttempts: 0,
          lastError: null,
        });
      });
    });

    describe('remoteReconnecting', () => {
      it('should initialize remote connection state if not exists', () => {
        const state: SocketsState = {
          ...initialSocketsState,
        };
        const newState = socketsReducer(state, remoteReconnecting({ clientId: 'client-1', attempt: 1 }));

        expect(newState.remoteConnections['client-1']).toEqual({
          clientId: 'client-1',
          connected: false,
          reconnecting: true,
          reconnectAttempts: 1,
          lastError: null,
        });
      });

      it('should update existing remote connection state', () => {
        const state: SocketsState = {
          ...initialSocketsState,
          remoteConnections: {
            'client-1': {
              clientId: 'client-1',
              connected: true,
              reconnecting: false,
              reconnectAttempts: 0,
              lastError: null,
            },
          },
        };
        const newState = socketsReducer(state, remoteReconnecting({ clientId: 'client-1', attempt: 2 }));

        expect(newState.remoteConnections['client-1']).toEqual({
          clientId: 'client-1',
          connected: true,
          reconnecting: true,
          reconnectAttempts: 2,
          lastError: null,
        });
      });
    });

    describe('remoteReconnected', () => {
      it('should update remote connection state to connected', () => {
        const state: SocketsState = {
          ...initialSocketsState,
          remoteConnections: {
            'client-1': {
              clientId: 'client-1',
              connected: false,
              reconnecting: true,
              reconnectAttempts: 2,
              lastError: 'Previous error',
            },
          },
        };
        const newState = socketsReducer(state, remoteReconnected({ clientId: 'client-1' }));

        expect(newState.remoteConnections['client-1']).toEqual({
          clientId: 'client-1',
          connected: true,
          reconnecting: false,
          reconnectAttempts: 0,
          lastError: null,
        });
      });

      it('should clear forwardedEvents when reconnecting for the selected client', () => {
        const state: SocketsState = {
          ...initialSocketsState,
          selectedClientId: 'client-1',
          forwardedEvents: [
            { event: 'chatMessage', payload: mockForwardedPayload, timestamp: 1000 },
            { event: 'chatMessage', payload: mockForwardedPayload, timestamp: 2000 },
          ],
          messageFilterResults: [
            {
              direction: 'incoming',
              status: 'filtered',
              message: 'Test',
              appliedFilters: [],
              timestamp: 1000,
              receivedAt: 1000,
            },
          ],
          remoteConnections: {
            'client-1': {
              clientId: 'client-1',
              connected: false,
              reconnecting: true,
              reconnectAttempts: 1,
              lastError: null,
            },
          },
        };
        const newState = socketsReducer(state, remoteReconnected({ clientId: 'client-1' }));

        expect(newState.forwardedEvents).toEqual([]);
        expect(newState.messageFilterResults).toEqual([]);
        expect(newState.remoteConnections['client-1']).toEqual({
          clientId: 'client-1',
          connected: true,
          reconnecting: false,
          reconnectAttempts: 0,
          lastError: null,
        });
      });

      it('should not clear forwardedEvents when reconnecting for a different client', () => {
        const state: SocketsState = {
          ...initialSocketsState,
          selectedClientId: 'client-1',
          forwardedEvents: [
            { event: 'chatMessage', payload: mockForwardedPayload, timestamp: 1000 },
            { event: 'chatMessage', payload: mockForwardedPayload, timestamp: 2000 },
          ],
          remoteConnections: {
            'client-2': {
              clientId: 'client-2',
              connected: false,
              reconnecting: true,
              reconnectAttempts: 1,
              lastError: null,
            },
          },
        };
        const newState = socketsReducer(state, remoteReconnected({ clientId: 'client-2' }));

        expect(newState.forwardedEvents).toEqual([
          { event: 'chatMessage', payload: mockForwardedPayload, timestamp: 1000 },
          { event: 'chatMessage', payload: mockForwardedPayload, timestamp: 2000 },
        ]);
        expect(newState.remoteConnections['client-2']).toEqual({
          clientId: 'client-2',
          connected: true,
          reconnecting: false,
          reconnectAttempts: 0,
          lastError: null,
        });
      });

      it('should not clear forwardedEvents when there are no existing forwardedEvents', () => {
        const state: SocketsState = {
          ...initialSocketsState,
          selectedClientId: 'client-1',
          forwardedEvents: [],
          remoteConnections: {
            'client-1': {
              clientId: 'client-1',
              connected: false,
              reconnecting: true,
              reconnectAttempts: 1,
              lastError: null,
            },
          },
        };
        const newState = socketsReducer(state, remoteReconnected({ clientId: 'client-1' }));

        expect(newState.forwardedEvents).toEqual([]);
        expect(newState.remoteConnections['client-1']).toEqual({
          clientId: 'client-1',
          connected: true,
          reconnecting: false,
          reconnectAttempts: 0,
          lastError: null,
        });
      });
    });

    describe('remoteReconnectError', () => {
      it('should update lastError while keeping reconnecting true', () => {
        const state: SocketsState = {
          ...initialSocketsState,
          remoteConnections: {
            'client-1': {
              clientId: 'client-1',
              connected: false,
              reconnecting: true,
              reconnectAttempts: 2,
              lastError: null,
            },
          },
        };
        const newState = socketsReducer(state, remoteReconnectError({ clientId: 'client-1', error: 'Timeout' }));

        expect(newState.remoteConnections['client-1']).toEqual({
          clientId: 'client-1',
          connected: false,
          reconnecting: true,
          reconnectAttempts: 2,
          lastError: 'Timeout',
        });
      });
    });

    describe('remoteReconnectFailed', () => {
      it('should set connected to false and clear reconnecting state', () => {
        const state: SocketsState = {
          ...initialSocketsState,
          remoteConnections: {
            'client-1': {
              clientId: 'client-1',
              connected: false,
              reconnecting: true,
              reconnectAttempts: 5,
              lastError: null,
            },
          },
        };
        const newState = socketsReducer(state, remoteReconnectFailed({ clientId: 'client-1', error: 'Failed' }));

        expect(newState.remoteConnections['client-1']).toEqual({
          clientId: 'client-1',
          connected: false,
          reconnecting: false,
          reconnectAttempts: 5,
          lastError: 'Failed',
        });
      });
    });

    describe('setClientSuccess', () => {
      it('should initialize remote connection state for new clientId', () => {
        const state: SocketsState = {
          ...initialSocketsState,
        };
        const newState = socketsReducer(state, setClientSuccess({ message: 'Success', clientId: 'client-1' }));

        expect(newState.remoteConnections['client-1']).toEqual({
          clientId: 'client-1',
          connected: true,
          reconnecting: false,
          reconnectAttempts: 0,
          lastError: null,
        });
      });
    });

    it('should track multiple clientIds independently', () => {
      let state: SocketsState = {
        ...initialSocketsState,
      };

      // Set client 1
      state = socketsReducer(state, setClientSuccess({ message: 'Success', clientId: 'client-1' }));
      // Set client 2
      state = socketsReducer(state, setClientSuccess({ message: 'Success', clientId: 'client-2' }));
      // Reconnecting for client 1
      state = socketsReducer(state, remoteReconnecting({ clientId: 'client-1', attempt: 1 }));

      expect(state.remoteConnections['client-1']?.reconnecting).toBe(true);
      expect(state.remoteConnections['client-2']?.reconnecting).toBe(false);
    });
  });
});
