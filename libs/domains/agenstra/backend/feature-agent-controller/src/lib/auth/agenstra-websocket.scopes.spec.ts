import { parsePatScope, type SocketEventScopes, websocketScope } from '@forepath/identity/backend';

import { AGENT_TASK_SOCKET_EVENTS } from '../constants/agent-tasks.constants';
import { CLIENT_CHAT_AUTOMATION_EVENTS } from '../services/client-chat-automation.constants';
import { CLIENT_CHAT_PLAN_EVENTS } from '../services/client-chat-plan.constants';
import { KNOWLEDGE_BOARD_EVENTS } from '../services/knowledge-board-realtime.constants';
import { TICKETS_BOARD_EVENTS } from '../services/ticket-board-realtime.constants';

import { AGENSTRA_PAT_SCOPES } from './agenstra-pat.scopes';
import {
  AGENSTRA_VNC_WEBSOCKET_SCOPE,
  AGENSTRA_WEBSOCKETS,
  CLIENTS_SOCKET_FORWARD_SCOPES,
  CLIENTS_SOCKET_INBOUND_SCOPES,
  CLIENTS_SOCKET_OUTBOUND_SCOPES,
  PAGES_SOCKET_INBOUND_SCOPES,
  PAGES_SOCKET_OUTBOUND_SCOPES,
  STATUS_SOCKET_INBOUND_SCOPES,
  STATUS_SOCKET_OUTBOUND_SCOPES,
  TICKETS_SOCKET_INBOUND_SCOPES,
  TICKETS_SOCKET_OUTBOUND_SCOPES,
} from './agenstra-websocket.scopes';

const ALL_MAPS: Record<string, SocketEventScopes> = {
  CLIENTS_SOCKET_INBOUND_SCOPES,
  CLIENTS_SOCKET_FORWARD_SCOPES,
  CLIENTS_SOCKET_OUTBOUND_SCOPES,
  STATUS_SOCKET_INBOUND_SCOPES,
  STATUS_SOCKET_OUTBOUND_SCOPES,
  TICKETS_SOCKET_INBOUND_SCOPES,
  TICKETS_SOCKET_OUTBOUND_SCOPES,
  PAGES_SOCKET_INBOUND_SCOPES,
  PAGES_SOCKET_OUTBOUND_SCOPES,
};
const INBOUND_MAPS: Record<string, { socket: string; map: SocketEventScopes }> = {
  CLIENTS_SOCKET_INBOUND_SCOPES: { socket: 'clients', map: CLIENTS_SOCKET_INBOUND_SCOPES },
  CLIENTS_SOCKET_FORWARD_SCOPES: { socket: 'clients', map: CLIENTS_SOCKET_FORWARD_SCOPES },
  STATUS_SOCKET_INBOUND_SCOPES: { socket: 'status', map: STATUS_SOCKET_INBOUND_SCOPES },
  TICKETS_SOCKET_INBOUND_SCOPES: { socket: 'tickets', map: TICKETS_SOCKET_INBOUND_SCOPES },
  PAGES_SOCKET_INBOUND_SCOPES: { socket: 'pages', map: PAGES_SOCKET_INBOUND_SCOPES },
};

describe('Agenstra websocket scopes', () => {
  it('only uses cataloged, pattern-conformant scopes', () => {
    const catalog = new Set<string>(AGENSTRA_PAT_SCOPES);

    for (const [name, map] of Object.entries(ALL_MAPS)) {
      for (const [event, scopes] of Object.entries(map)) {
        for (const scope of scopes) {
          expect({ name, event, scope, parsed: !!parsePatScope(scope), cataloged: catalog.has(scope) }).toEqual({
            name,
            event,
            scope,
            parsed: true,
            cataloged: true,
          });
        }
      }
    }

    expect(catalog.has(AGENSTRA_VNC_WEBSOCKET_SCOPE)).toBe(true);
  });

  it('catalogs exactly the websocket scopes the sockets use', () => {
    // Connecting to a Socket.IO namespace needs `websocket:<name>:read` (enforced by SocketAuthService).
    const used = new Set<string>([
      AGENSTRA_VNC_WEBSOCKET_SCOPE,
      ...Object.values(AGENSTRA_WEBSOCKETS)
        .filter((name) => name !== AGENSTRA_WEBSOCKETS.vnc)
        .map((name) => websocketScope(name, 'read')),
    ]);

    Object.values(ALL_MAPS).forEach((map) =>
      Object.values(map).forEach((scopes) =>
        scopes.filter((s) => s.startsWith('websocket:')).forEach((s) => used.add(s)),
      ),
    );

    expect([...used].sort()).toEqual(AGENSTRA_PAT_SCOPES.filter((scope) => scope.startsWith('websocket:')).sort());
    expect(Object.values(AGENSTRA_WEBSOCKETS).sort()).toEqual(['clients', 'pages', 'status', 'tickets', 'vnc']);
  });

  it('requires the socket scope on every inbound event (never admin scopes)', () => {
    for (const [name, { socket, map }] of Object.entries(INBOUND_MAPS)) {
      for (const [event, scopes] of Object.entries(map)) {
        const socketScopes = scopes.filter((scope) => scope.startsWith(`websocket:${socket}:`));

        expect({ name, event, hasSocketScope: socketScopes.length > 0 }).toEqual({
          name,
          event,
          hasSocketScope: true,
        });
      }
    }
  });

  it('requires the websocket write scope for state-changing inbound events', () => {
    const writes: Array<[SocketEventScopes, string, string]> = [
      [CLIENTS_SOCKET_FORWARD_SCOPES, 'chat', 'websocket:clients:write'],
      [CLIENTS_SOCKET_FORWARD_SCOPES, 'enhanceChat', 'websocket:clients:write'],
      [CLIENTS_SOCKET_FORWARD_SCOPES, 'generateTicketBody', 'websocket:clients:write'],
      [CLIENTS_SOCKET_FORWARD_SCOPES, 'fileUpdate', 'websocket:clients:write'],
      ...Object.values(CLIENT_CHAT_PLAN_EVENTS)
        .filter((event) => event !== CLIENT_CHAT_PLAN_EVENTS.chatPlanUpsert)
        .map(
          (event) =>
            [CLIENTS_SOCKET_INBOUND_SCOPES, event, 'websocket:clients:write'] as [SocketEventScopes, string, string],
        ),
      [STATUS_SOCKET_INBOUND_SCOPES, 'markEnvironmentRead', 'websocket:status:write'],
      [STATUS_SOCKET_INBOUND_SCOPES, 'markChatSessionRead', 'websocket:status:write'],
      [STATUS_SOCKET_INBOUND_SCOPES, 'setActiveEnvironment', 'websocket:status:write'],
    ];

    for (const [map, event, scope] of writes) {
      expect(map[event]).toContain(scope);
    }
  });

  it('never allows terminal access for machine tokens', () => {
    for (const event of ['createTerminal', 'terminalInput', 'terminalResize', 'closeTerminal']) {
      expect(Object.prototype.hasOwnProperty.call(CLIENTS_SOCKET_FORWARD_SCOPES, event)).toBe(false);
    }

    for (const event of ['terminalOutput', 'terminalCreated', 'terminalClosed']) {
      expect(Object.prototype.hasOwnProperty.call(CLIENTS_SOCKET_OUTBOUND_SCOPES, event)).toBe(false);
    }
  });

  it('classifies every realtime event of the controller (new events must be mapped)', () => {
    const expectMapped = (map: SocketEventScopes, events: readonly string[]) =>
      expect(events.filter((event) => !Object.prototype.hasOwnProperty.call(map, event))).toEqual([]);

    expectMapped(TICKETS_SOCKET_OUTBOUND_SCOPES, Object.values(TICKETS_BOARD_EVENTS));
    expectMapped(PAGES_SOCKET_OUTBOUND_SCOPES, Object.values(KNOWLEDGE_BOARD_EVENTS));
    expectMapped(CLIENTS_SOCKET_OUTBOUND_SCOPES, [
      CLIENT_CHAT_PLAN_EVENTS.chatPlanUpsert,
      ...Object.values(CLIENT_CHAT_AUTOMATION_EVENTS),
      ...Object.values(AGENT_TASK_SOCKET_EVENTS),
    ]);
    expectMapped(
      CLIENTS_SOCKET_INBOUND_SCOPES,
      Object.values(CLIENT_CHAT_PLAN_EVENTS).filter((event) => event !== CLIENT_CHAT_PLAN_EVENTS.chatPlanUpsert),
    );
  });
});
