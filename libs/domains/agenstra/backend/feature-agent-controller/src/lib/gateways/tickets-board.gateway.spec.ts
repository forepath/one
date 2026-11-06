jest.mock('@forepath/identity/backend', () => {
  const actual = jest.requireActual('@forepath/identity/backend');

  return { ...actual, ensureClientAccess: jest.fn().mockResolvedValue(undefined) };
});

import * as identityBackend from '@forepath/identity/backend';
import { ClientUsersRepository, SocketAuthService } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ClientsRepository } from '../repositories/clients.repository';
import { TicketBoardRealtimeService } from '../services/ticket-board-realtime.service';

import { TicketsBoardGateway } from './tickets-board.gateway';

describe('TicketsBoardGateway', () => {
  let gateway: TicketsBoardGateway;
  const mockClientsRepository = {
    findById: jest.fn(),
  };
  const mockClientUsersRepository = {
    findUserClientAccess: jest.fn(),
  };
  const mockSocketAuthService = {
    validateAndGetUser: jest
      .fn()
      .mockResolvedValue({ isApiKeyAuth: true, user: { id: 'api-key-user', roles: ['admin'] } }),
  };
  const createMockSocket = (id = 'socket-1', withUserInfo = true) => {
    const emitted: { event: string; payload: unknown }[] = [];
    const socket = {
      id,
      emit: jest.fn((event: string, payload: unknown) => emitted.push({ event, payload })),
      getEmitted: () => emitted,
      data: withUserInfo ? { userInfo: { isApiKeyAuth: true, user: { id: 'api-key-user', roles: ['admin'] } } } : {},
      join: jest.fn().mockResolvedValue(undefined),
      leave: jest.fn().mockResolvedValue(undefined),
    };

    return socket as any;
  };

  beforeEach(async () => {
    (identityBackend.ensureClientAccess as jest.Mock).mockResolvedValue(undefined);

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TicketsBoardGateway,
        TicketBoardRealtimeService,
        { provide: ClientsRepository, useValue: mockClientsRepository },
        { provide: ClientUsersRepository, useValue: mockClientUsersRepository },
        { provide: SocketAuthService, useValue: mockSocketAuthService },
      ],
    }).compile();

    gateway = module.get(TicketsBoardGateway);
    const mockServer = {
      use: jest.fn(),
    };

    gateway.afterInit(mockServer as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeInstanceOf(TicketsBoardGateway);
  });

  it('should emit error when clientId is missing', async () => {
    const socket = createMockSocket();

    await gateway.handleSetClient({}, socket);
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'clientId is required' }));
  });

  it('should emit Unauthorized when socket has no userInfo', async () => {
    const socket = createMockSocket('socket-1', false);

    await gateway.handleSetClient({ clientId: 'c1' }, socket);
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'Unauthorized' }));
  });

  it('should join room and emit setClientSuccess on valid setClient', async () => {
    const socket = createMockSocket();

    await gateway.handleSetClient({ clientId: 'client-uuid' }, socket);
    expect(socket.join).toHaveBeenCalledWith(TicketBoardRealtimeService.clientRoom('client-uuid'));
    expect(socket.emit).toHaveBeenCalledWith('setClientSuccess', expect.objectContaining({ clientId: 'client-uuid' }));
  });

  it('should leave previous room when switching client', async () => {
    const socket = createMockSocket();

    await gateway.handleSetClient({ clientId: 'client-a' }, socket);
    await gateway.handleSetClient({ clientId: 'client-b' }, socket);
    expect(socket.leave).toHaveBeenCalledWith(TicketBoardRealtimeService.clientRoom('client-a'));
    expect(socket.join).toHaveBeenCalledWith(TicketBoardRealtimeService.clientRoom('client-b'));
  });

  it('should emit forbidden message when ensureClientAccess throws ForbiddenException', async () => {
    (identityBackend.ensureClientAccess as jest.Mock).mockRejectedValueOnce(new ForbiddenException());
    const socket = createMockSocket();

    await gateway.handleSetClient({ clientId: 'no-access' }, socket);
    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: 'You do not have access to this client' }),
    );
  });

  it('should emit generic error when ensureClientAccess throws non-forbidden error', async () => {
    (identityBackend.ensureClientAccess as jest.Mock).mockRejectedValueOnce(new Error('database unavailable'));
    const socket = createMockSocket();

    await gateway.handleSetClient({ clientId: 'any' }, socket);
    expect(socket.emit).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: 'Unable to set client context' }),
    );
  });

  it('should emit setClientSuccess without re-joining when same client is already selected', async () => {
    const socket = createMockSocket();

    await gateway.handleSetClient({ clientId: 'same' }, socket);
    (socket.join as jest.Mock).mockClear();
    await gateway.handleSetClient({ clientId: 'same' }, socket);
    expect(socket.join).not.toHaveBeenCalled();
    expect(socket.emit).toHaveBeenLastCalledWith(
      'setClientSuccess',
      expect.objectContaining({ clientId: 'same', message: expect.stringContaining('already') }),
    );
  });

  it('should leave joined room on disconnect', async () => {
    const socket = createMockSocket();

    await gateway.handleSetClient({ clientId: 'to-leave' }, socket);
    (socket.leave as jest.Mock).mockClear();
    gateway.handleDisconnect(socket as any);
    expect(socket.leave).toHaveBeenCalledWith(TicketBoardRealtimeService.clientRoom('to-leave'));
  });
  describe('machine tokens (PAT / app access tokens)', () => {
    const machineSocket = (scopes: string[]) => {
      const socket = createMockSocket('machine-socket');

      socket.data = {
        userInfo: { userId: 'u1', isApiKeyAuth: false, amr: ['pat'], scopes, user: { id: 'u1', amr: ['pat'], scopes } },
      };

      return socket;
    };

    it('authenticates with the tickets websocket scope', async () => {
      const use = jest.fn();

      gateway.afterInit({ use } as any);
      await use.mock.calls[0][0]({ id: 's', handshake: { headers: { authorization: 'Bearer t' } } }, jest.fn());

      expect(mockSocketAuthService.validateAndGetUser).toHaveBeenCalledWith('Bearer t', undefined, {
        websocket: 'tickets',
      });
    });

    it('joins only the per-event rooms its scopes permit', async () => {
      const socket = machineSocket(['websocket:tickets:read', 'tickets:read']);

      await gateway.handleSetClient({ clientId: 'c1' }, socket);

      const joined = (socket.join as jest.Mock).mock.calls.map((call) => call[0]);

      expect(joined).not.toContain('client:c1');
      expect(joined).toContain('client:c1#event:ticketUpsert');
      expect(joined).toContain('client:c1#event:ticketAutomationRunStepAppended');
      // Relation changes reveal knowledge pages too.
      expect(joined).not.toContain('client:c1#event:knowledgeRelationChanged');
      expect(socket.emit).toHaveBeenCalledWith('setClientSuccess', expect.objectContaining({ clientId: 'c1' }));
    });

    it('passes amr and scopes to the workspace access check', async () => {
      const socket = machineSocket(['websocket:tickets:read', 'tickets:read']);

      await gateway.handleSetClient({ clientId: 'c1' }, socket);

      expect(identityBackend.ensureClientAccess).toHaveBeenCalledWith(
        expect.anything(),
        expect.anything(),
        'c1',
        expect.objectContaining({ user: expect.objectContaining({ amr: ['pat'] }) }),
      );
    });

    it('leaves the per-event rooms on disconnect', async () => {
      const socket = machineSocket(['websocket:tickets:read', 'tickets:read', 'knowledge:read']);

      await gateway.handleSetClient({ clientId: 'c1' }, socket);
      const joined = (socket.join as jest.Mock).mock.calls.map((call) => call[0]);

      gateway.handleDisconnect(socket as any);

      expect((socket.leave as jest.Mock).mock.calls.map((call) => call[0])).toEqual(joined);
    });
  });
});
