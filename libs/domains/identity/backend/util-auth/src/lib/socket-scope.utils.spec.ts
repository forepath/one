import { buildRequestFromSocketUser, type SocketUserInfo } from './client-access.utils';
import { UserRole } from './entities/user.entity';
import {
  emitToSocketIfPermitted,
  getPermittedSocketEvents,
  isMachineSocketUser,
  isSocketEventPermitted,
  socketBroadcastRooms,
  socketEventRoom,
  socketRoomsForUser,
  type SocketEventScopes,
  websocketScope,
} from './socket-scope.utils';

const machine = (scopes: string[], amr = ['pat']): SocketUserInfo => ({
  userId: 'u1',
  userRole: UserRole.ADMIN,
  isApiKeyAuth: false,
  amr,
  scopes,
  user: { id: 'u1', roles: ['admin'], amr, scopes },
});
const interactive: SocketUserInfo = {
  userId: 'u1',
  userRole: UserRole.USER,
  isApiKeyAuth: false,
  amr: ['pwd'],
  user: { id: 'u1', roles: ['user'], amr: ['pwd'] },
};
const apiKey: SocketUserInfo = { isApiKeyAuth: true, user: { id: 'api-key-user', roles: ['admin', 'user'] } };
const EVENTS: SocketEventScopes = {
  open: [],
  ticketUpsert: ['tickets:read'],
  ticketWrite: ['websocket:tickets:write', 'tickets:write'],
  relationChanged: ['tickets:read', 'knowledge:read'],
};

describe('socket-scope.utils', () => {
  describe('websocketScope', () => {
    it('builds `<resource>:<level>` scopes in the shared grammar', () => {
      expect(websocketScope('clients')).toBe('websocket:clients:read');
      expect(websocketScope('status', 'write')).toBe('websocket:status:write');
    });

    it('rejects names that would break the scope grammar', () => {
      expect(() => websocketScope('Clients')).toThrow();
      expect(() => websocketScope('a:b')).toThrow();
      expect(() => websocketScope('')).toThrow();
    });
  });

  describe('isMachineSocketUser', () => {
    it('detects PAT and app access token sockets', () => {
      expect(isMachineSocketUser(machine([]))).toBe(true);
      expect(isMachineSocketUser(machine([], ['pat', 'app']))).toBe(true);
      const nestedOnly: SocketUserInfo = { isApiKeyAuth: false, user: { id: 'u1', amr: ['pat'] } };

      expect(isMachineSocketUser(nestedOnly)).toBe(true);
    });

    it('treats interactive, API-key and missing identities as non-machine', () => {
      expect(isMachineSocketUser(interactive)).toBe(false);
      expect(isMachineSocketUser(apiKey)).toBe(false);
      expect(isMachineSocketUser({ ...apiKey, amr: ['pat'] })).toBe(false);
      expect(isMachineSocketUser(undefined)).toBe(false);
    });
  });

  describe('isSocketEventPermitted', () => {
    it('always permits interactive and API-key sockets (unchanged behaviour)', () => {
      expect(isSocketEventPermitted(interactive, 'unlisted', EVENTS)).toBe(true);
      expect(isSocketEventPermitted(apiKey, 'ticketWrite', EVENTS)).toBe(true);
    });

    it('rejects sockets without identity', () => {
      expect(isSocketEventPermitted(undefined, 'open', EVENTS)).toBe(false);
    });

    it('is fail-closed for machine sockets on unlisted events', () => {
      expect(isSocketEventPermitted(machine(['tickets:admin']), 'unlisted', EVENTS)).toBe(false);
      expect(isSocketEventPermitted(machine(['tickets:admin']), 'constructor', EVENTS)).toBe(false);
      expect(isSocketEventPermitted(machine(['tickets:admin']), '__proto__', EVENTS)).toBe(false);
    });

    it('requires all scopes of the event, honouring the level hierarchy', () => {
      expect(isSocketEventPermitted(machine([]), 'open', EVENTS)).toBe(true);
      expect(isSocketEventPermitted(machine(['tickets:read']), 'ticketUpsert', EVENTS)).toBe(true);
      expect(isSocketEventPermitted(machine(['tickets:write']), 'ticketUpsert', EVENTS)).toBe(true);
      expect(isSocketEventPermitted(machine(['tickets:write']), 'ticketWrite', EVENTS)).toBe(false);
      expect(isSocketEventPermitted(machine(['websocket:tickets:write', 'tickets:write']), 'ticketWrite', EVENTS)).toBe(
        true,
      );
      expect(isSocketEventPermitted(machine(['tickets:read']), 'relationChanged', EVENTS)).toBe(false);
      expect(isSocketEventPermitted(machine(['tickets:read', 'knowledge:read']), 'relationChanged', EVENTS)).toBe(true);
    });

    it('reads scopes from the nested user when the top-level copy is absent', () => {
      expect(
        isSocketEventPermitted(
          { isApiKeyAuth: false, user: { id: 'u1', amr: ['pat'], scopes: ['tickets:read'] } } as SocketUserInfo,
          'ticketUpsert',
          EVENTS,
        ),
      ).toBe(true);
    });
  });

  describe('rooms', () => {
    it('lists permitted events', () => {
      expect(getPermittedSocketEvents(machine(['tickets:read']), EVENTS)).toEqual(['open', 'ticketUpsert']);
    });

    it('keeps interactive and API-key sockets in the shared room', () => {
      expect(socketRoomsForUser(interactive, 'client:1', EVENTS)).toEqual(['client:1']);
      expect(socketRoomsForUser(apiKey, 'client:1', EVENTS)).toEqual(['client:1']);
    });

    it('puts machine sockets only into per-event rooms they may receive', () => {
      const rooms = socketRoomsForUser(machine(['tickets:read']), 'client:1', EVENTS);

      expect(rooms).toEqual([socketEventRoom('client:1', 'open'), socketEventRoom('client:1', 'ticketUpsert')]);
      expect(rooms).not.toContain('client:1');
    });

    it('broadcasts to the shared room and the per-event room', () => {
      expect(socketBroadcastRooms('client:1', 'ticketUpsert')).toEqual(['client:1', 'client:1#event:ticketUpsert']);
    });
  });

  describe('emitToSocketIfPermitted', () => {
    const socketFor = (userInfo?: SocketUserInfo) => ({ data: userInfo ? { userInfo } : {}, emit: jest.fn() });

    it('emits to machine sockets only when permitted', () => {
      const denied = socketFor(machine([]));
      const allowed = socketFor(machine(['tickets:read']));

      expect(emitToSocketIfPermitted(denied, 'ticketUpsert', EVENTS, { id: 't' })).toBe(false);
      expect(denied.emit).not.toHaveBeenCalled();
      expect(emitToSocketIfPermitted(allowed, 'ticketUpsert', EVENTS, { id: 't' })).toBe(true);
      expect(allowed.emit).toHaveBeenCalledWith('ticketUpsert', { id: 't' });
    });

    it('keeps emitting to non-machine sockets as before', () => {
      const plain = socketFor(interactive);
      const anonymous = socketFor();

      expect(emitToSocketIfPermitted(plain, 'unlisted', EVENTS, 1)).toBe(true);
      expect(emitToSocketIfPermitted(anonymous, 'unlisted', EVENTS, 1)).toBe(true);
      expect(plain.emit).toHaveBeenCalledWith('unlisted', 1);
      expect(anonymous.emit).toHaveBeenCalledWith('unlisted', 1);
    });
  });

  describe('buildRequestFromSocketUser', () => {
    it('carries amr and scopes so REST access helpers apply PAT rules', () => {
      const req = buildRequestFromSocketUser(machine(['clients:read']));

      expect(req.user).toEqual(expect.objectContaining({ id: 'u1', amr: ['pat'], scopes: ['clients:read'] }));
    });

    it('falls back to top-level scopes', () => {
      const req = buildRequestFromSocketUser({
        userId: 'u1',
        isApiKeyAuth: false,
        amr: ['pat'],
        scopes: ['tickets:read'],
        user: { id: 'u1', roles: [] },
      });

      expect(req.user?.scopes).toEqual(['tickets:read']);
      expect(req.user?.amr).toEqual(['pat']);
    });
  });
});
