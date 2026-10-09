import { SocketAuthService, UserRole } from '@forepath/identity/backend';
import { ForbiddenException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'socket.io';

import { AgentConsoleStatusRealtimeService } from '../services/agent-console-status-realtime.service';
import { AgentConsoleStatusService } from '../services/agent-console-status.service';

import { StatusGateway } from './status.gateway';

describe('StatusGateway', () => {
  let gateway: StatusGateway;
  const mockStatusService = {
    emitSnapshotToSocket: jest.fn().mockResolvedValue({
      generatedAt: new Date().toISOString(),
      environments: [],
      clients: [],
      spacesHasAttention: false,
    }),
    runPollForSocket: jest.fn().mockResolvedValue(undefined),
    runProgressPollForSocket: jest.fn().mockResolvedValue(undefined),
    hasActiveEnvironmentProgress: jest.fn().mockReturnValue(false),
    markEnvironmentRead: jest.fn().mockResolvedValue(undefined),
    setActiveEnvironment: jest.fn(),
    clearSocket: jest.fn(),
  };
  const mockRealtime = {
    attachServer: jest.fn(),
    registerSocket: jest.fn(),
    unregisterSocket: jest.fn(),
  };
  const mockSocketAuthService = {
    validateAndGetUser: jest
      .fn()
      .mockResolvedValue({ isApiKeyAuth: true, user: { id: 'api-key-user', roles: ['admin'] } }),
  };
  let authMiddleware: (socket: { id: string; handshake: object; data: object }, next: (err?: Error) => void) => void;
  const createMockSocket = (withUser = true) => {
    const socket = {
      id: 'socket-1',
      emit: jest.fn(),
      disconnect: jest.fn(),
      data: withUser ? { userInfo: { isApiKeyAuth: true, user: { id: 'api-key-user', roles: ['admin'] } } } : {},
    };

    return socket as any;
  };

  beforeEach(async () => {
    jest.useFakeTimers();
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        StatusGateway,
        { provide: AgentConsoleStatusService, useValue: mockStatusService },
        { provide: AgentConsoleStatusRealtimeService, useValue: mockRealtime },
        { provide: SocketAuthService, useValue: mockSocketAuthService },
      ],
    }).compile();

    gateway = module.get(StatusGateway);
    const server = {
      use: jest.fn((middleware) => {
        authMiddleware = middleware;
      }),
    } as unknown as Server;

    gateway.afterInit(server);
  });

  afterEach(() => {
    jest.useRealTimers();
    jest.clearAllMocks();
  });

  it('attaches auth middleware and rejects invalid tokens', async () => {
    mockSocketAuthService.validateAndGetUser.mockResolvedValueOnce(null);
    const next = jest.fn();
    const socket = {
      id: 'socket-auth',
      handshake: { headers: { authorization: 'Bearer bad' }, auth: {} },
      data: {},
    };

    await authMiddleware(socket, next);

    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('attaches auth middleware and accepts valid tokens', async () => {
    const next = jest.fn();
    const socket = {
      id: 'socket-auth',
      handshake: { headers: {}, auth: { Authorization: 'Bearer good' } },
      data: {},
    };

    await authMiddleware(socket, next);

    expect(socket.data).toEqual({
      userInfo: { isApiKeyAuth: true, user: { id: 'api-key-user', roles: ['admin'] } },
    });
    expect(next).toHaveBeenCalledWith();
  });

  it('emits snapshot on connection and starts polling', async () => {
    const socket = createMockSocket();

    await gateway.handleConnection(socket);
    expect(mockRealtime.registerSocket).toHaveBeenCalledWith('api-key-user', 'socket-1', UserRole.USER);
    expect(mockStatusService.emitSnapshotToSocket).toHaveBeenCalled();

    await jest.advanceTimersByTimeAsync(30_000);
    expect(mockStatusService.runPollForSocket).toHaveBeenCalledWith('socket-1', socket.data.userInfo);
  });

  it('runs the fast progress poll only while provisioning is active', async () => {
    const socket = createMockSocket();

    mockStatusService.hasActiveEnvironmentProgress.mockReturnValue(true);
    await gateway.handleConnection(socket);

    await jest.advanceTimersByTimeAsync(3_000);
    expect(mockStatusService.runProgressPollForSocket).toHaveBeenCalledWith('socket-1', socket.data.userInfo);

    mockStatusService.hasActiveEnvironmentProgress.mockReturnValue(false);
    await jest.advanceTimersByTimeAsync(3_000);
    mockStatusService.runProgressPollForSocket.mockClear();

    await jest.advanceTimersByTimeAsync(9_000);
    expect(mockStatusService.runProgressPollForSocket).not.toHaveBeenCalled();

    gateway.handleDisconnect(socket);
  });

  it('does not start the fast progress poll when nothing is provisioning', async () => {
    const socket = createMockSocket();

    mockStatusService.hasActiveEnvironmentProgress.mockReturnValue(false);
    await gateway.handleConnection(socket);
    await jest.advanceTimersByTimeAsync(9_000);

    expect(mockStatusService.runProgressPollForSocket).not.toHaveBeenCalled();
    gateway.handleDisconnect(socket);
  });

  it('stops the fast progress poll on disconnect', async () => {
    const socket = createMockSocket();

    mockStatusService.hasActiveEnvironmentProgress.mockReturnValue(true);
    await gateway.handleConnection(socket);
    gateway.handleDisconnect(socket);
    await jest.advanceTimersByTimeAsync(9_000);

    expect(mockStatusService.runProgressPollForSocket).not.toHaveBeenCalled();
    mockStatusService.hasActiveEnvironmentProgress.mockReturnValue(false);
  });

  it('does not overlap the full poll with an in-flight progress poll', async () => {
    const socket = createMockSocket();
    let finishProgress!: () => void;
    const pendingProgress = new Promise<void>((resolve) => {
      finishProgress = resolve;
    });

    mockStatusService.hasActiveEnvironmentProgress.mockReturnValue(true);
    mockStatusService.runProgressPollForSocket.mockReturnValueOnce(pendingProgress);
    await gateway.handleConnection(socket);

    try {
      await jest.advanceTimersByTimeAsync(30_000);

      expect(mockStatusService.runProgressPollForSocket).toHaveBeenCalledTimes(1);
      expect(mockStatusService.runPollForSocket).not.toHaveBeenCalled();

      finishProgress();
      await jest.advanceTimersByTimeAsync(30_000);

      expect(mockStatusService.runPollForSocket).toHaveBeenCalledTimes(1);
    } finally {
      finishProgress();
      gateway.handleDisconnect(socket);
      mockStatusService.hasActiveEnvironmentProgress.mockReturnValue(false);
    }
  });

  it('rejects connection without user id', async () => {
    const socket = createMockSocket(false);

    await gateway.handleConnection(socket);
    expect(socket.emit).toHaveBeenCalledWith('error', expect.objectContaining({ message: 'User not authenticated' }));
    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('cleans up on disconnect', () => {
    const socket = createMockSocket();

    gateway.handleDisconnect(socket);

    expect(mockStatusService.clearSocket).toHaveBeenCalledWith('socket-1');
    expect(mockRealtime.unregisterSocket).toHaveBeenCalledWith('socket-1');
  });

  it('marks environment read when payload is valid', async () => {
    const socket = createMockSocket();

    await gateway.handleMarkEnvironmentRead({ clientId: 'c1', agentId: 'a1' }, socket);

    expect(mockStatusService.markEnvironmentRead).toHaveBeenCalledWith(socket.data.userInfo, 'c1', 'a1', undefined);
  });

  it('emits errors for unauthorized or invalid markEnvironmentRead payloads', async () => {
    const socketWithoutUser = createMockSocket(false);

    await gateway.handleMarkEnvironmentRead({ clientId: 'c1', agentId: 'a1' }, socketWithoutUser);
    expect(socketWithoutUser.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized' });

    const socket = createMockSocket();

    await gateway.handleMarkEnvironmentRead({ clientId: '', agentId: 'a1' }, socket);
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'clientId and agentId are required' });

    mockStatusService.markEnvironmentRead.mockRejectedValueOnce(new ForbiddenException('denied'));
    await gateway.handleMarkEnvironmentRead({ clientId: 'c1', agentId: 'a1' }, socket);
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'denied' });
  });

  it('sets active environment for authenticated sockets', () => {
    const socket = createMockSocket();

    gateway.handleSetActiveEnvironment({ clientId: 'c1', agentId: 'a1' }, socket);
    expect(mockStatusService.setActiveEnvironment).toHaveBeenCalledWith('socket-1', 'c1', 'a1', undefined);

    gateway.handleSetActiveEnvironment({ clientId: null, agentId: null }, socket);
    expect(mockStatusService.setActiveEnvironment).toHaveBeenCalledWith('socket-1', null, null, undefined);
  });

  it('rejects setActiveEnvironment without user info', () => {
    const socket = createMockSocket(false);

    gateway.handleSetActiveEnvironment({ clientId: 'c1', agentId: 'a1' }, socket);
    expect(socket.emit).toHaveBeenCalledWith('error', { message: 'Unauthorized' });
  });
});
