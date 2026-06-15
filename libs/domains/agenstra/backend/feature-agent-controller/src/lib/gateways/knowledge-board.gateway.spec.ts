jest.mock('@forepath/identity/backend', () => {
  const actual = jest.requireActual('@forepath/identity/backend');

  return { ...actual, ensureClientAccess: jest.fn().mockResolvedValue(undefined) };
});

import * as identityBackend from '@forepath/identity/backend';
import { ClientUsersRepository, SocketAuthService } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';

import { ClientsRepository } from '../repositories/clients.repository';
import { KnowledgeBoardRealtimeService } from '../services/knowledge-board-realtime.service';

import { KnowledgeBoardGateway } from './knowledge-board.gateway';

describe('KnowledgeBoardGateway', () => {
  let gateway: KnowledgeBoardGateway;
  const mockClientsRepository = { findById: jest.fn() };
  const mockClientUsersRepository = { findUserClientAccess: jest.fn() };
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
        KnowledgeBoardGateway,
        KnowledgeBoardRealtimeService,
        { provide: ClientsRepository, useValue: mockClientsRepository },
        { provide: ClientUsersRepository, useValue: mockClientUsersRepository },
        { provide: SocketAuthService, useValue: mockSocketAuthService },
      ],
    }).compile();

    gateway = module.get(KnowledgeBoardGateway);
    gateway.afterInit({ use: jest.fn() } as any);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should be defined', () => {
    expect(gateway).toBeInstanceOf(KnowledgeBoardGateway);
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
    expect(socket.join).toHaveBeenCalledWith(KnowledgeBoardRealtimeService.clientRoom('client-uuid'));
    expect(socket.emit).toHaveBeenCalledWith('setClientSuccess', expect.objectContaining({ clientId: 'client-uuid' }));
  });

  it('should leave previous room when switching client', async () => {
    const socket = createMockSocket();

    await gateway.handleSetClient({ clientId: 'client-a' }, socket);
    await gateway.handleSetClient({ clientId: 'client-b' }, socket);
    expect(socket.leave).toHaveBeenCalledWith(KnowledgeBoardRealtimeService.clientRoom('client-a'));
    expect(socket.join).toHaveBeenCalledWith(KnowledgeBoardRealtimeService.clientRoom('client-b'));
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
});
