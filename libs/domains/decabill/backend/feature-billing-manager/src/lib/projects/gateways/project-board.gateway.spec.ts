import { SocketAuthService, UserRole } from '@forepath/identity/backend';
import { Test, TestingModule } from '@nestjs/testing';
import type { Socket } from 'socket.io';

import { ProjectsRepository } from '../repositories/projects.repository';
import { ProjectBoardRealtimeService } from '../services/project-board-realtime.service';

import { ProjectBoardGateway } from './project-board.gateway';

describe('ProjectBoardGateway', () => {
  let gateway: ProjectBoardGateway;
  let socketAuth: jest.Mocked<Pick<SocketAuthService, 'validateAndGetUser'>>;
  let projectsRepository: jest.Mocked<Pick<ProjectsRepository, 'findByIdOrThrow'>>;

  const userSocketInfo = {
    isApiKeyAuth: false,
    userId: 'user-1',
    userRole: UserRole.USER,
    user: { id: 'user-1', roles: ['user'] },
  };

  beforeEach(async () => {
    socketAuth = { validateAndGetUser: jest.fn() };
    projectsRepository = { findByIdOrThrow: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ProjectBoardGateway,
        { provide: SocketAuthService, useValue: socketAuth },
        { provide: ProjectsRepository, useValue: projectsRepository },
        { provide: ProjectBoardRealtimeService, useValue: { attachServer: jest.fn() } },
      ],
    }).compile();

    gateway = module.get(ProjectBoardGateway);
  });

  it('afterInit rejects invalid tenant', async () => {
    const next = jest.fn();
    const mockSocket = {
      id: 's1',
      handshake: { headers: {}, auth: {} },
      data: {},
    };
    const useCallbacks: Array<(s: typeof mockSocket, n: (e?: Error) => void) => Promise<void>> = [];
    const server = {
      use: jest.fn((cb: (s: typeof mockSocket, n: (e?: Error) => void) => Promise<void>) => {
        useCallbacks.push(cb);
      }),
    };

    gateway.afterInit(server as never);
    await useCallbacks[0](mockSocket, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('afterInit accepts valid auth and tenant', async () => {
    socketAuth.validateAndGetUser.mockResolvedValue(userSocketInfo);
    const next = jest.fn();
    const mockSocket = {
      id: 's1',
      handshake: { headers: { 'x-tenant-id': 'decabill' }, auth: { Authorization: 'Bearer token' } },
      data: {} as { userInfo?: typeof userSocketInfo; tenantId?: string },
    };
    const useCallbacks: Array<(s: typeof mockSocket, n: (e?: Error) => void) => Promise<void>> = [];
    const server = {
      use: jest.fn((cb: (s: typeof mockSocket, n: (e?: Error) => void) => Promise<void>) => {
        useCallbacks.push(cb);
      }),
    };

    gateway.afterInit(server as never);
    await useCallbacks[0](mockSocket, next);
    expect(next).toHaveBeenCalledWith();
    expect(mockSocket.data.userInfo).toEqual(userSocketInfo);
  });

  it('afterInit rejects invalid auth', async () => {
    socketAuth.validateAndGetUser.mockResolvedValue(null);
    const next = jest.fn();
    const mockSocket = {
      id: 's1',
      handshake: { headers: {}, auth: { tenantId: 'default' } },
      data: {},
    };
    const useCallbacks: Array<(s: typeof mockSocket, n: (e?: Error) => void) => Promise<void>> = [];
    const server = {
      use: jest.fn((cb: (s: typeof mockSocket, n: (e?: Error) => void) => Promise<void>) => {
        useCallbacks.push(cb);
      }),
    };

    gateway.afterInit(server as never);
    await useCallbacks[0](mockSocket, next);
    expect(next).toHaveBeenCalledWith(expect.any(Error));
  });

  it('setProject joins room when project readable for tenant owner', async () => {
    const join = jest.fn();
    const leave = jest.fn();
    const emit = jest.fn();
    const socket = {
      id: 'socket-1',
      join,
      leave,
      emit,
      data: { userInfo: userSocketInfo, tenantId: 'decabill' },
    } as unknown as Socket;

    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'user-1' } as never);

    await gateway.handleSetProject({ projectId: 'p1' }, socket);

    expect(join).toHaveBeenCalledWith('project:p1');
    expect(emit).toHaveBeenCalledWith('setProjectSuccess', expect.objectContaining({ projectId: 'p1' }));
  });

  it('setProject allows admin to join project outside tenant default context', async () => {
    const join = jest.fn();
    const emit = jest.fn();
    const socket = {
      id: 'socket-1',
      join,
      leave: jest.fn(),
      emit,
      data: {
        userInfo: {
          isApiKeyAuth: false,
          userId: 'admin-1',
          userRole: UserRole.ADMIN,
          user: { id: 'admin-1', roles: ['admin'] },
        },
        tenantId: 'decabill',
      },
    } as unknown as Socket;

    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'other-user' } as never);

    await gateway.handleSetProject({ projectId: 'p1' }, socket);

    expect(join).toHaveBeenCalledWith('project:p1');
    expect(emit).toHaveBeenCalledWith('setProjectSuccess', expect.objectContaining({ projectId: 'p1' }));
  });

  it('setProject emits access denied when customer cannot read project', async () => {
    const emit = jest.fn();
    const socket = {
      id: 'socket-1',
      join: jest.fn(),
      leave: jest.fn(),
      emit,
      data: { userInfo: userSocketInfo, tenantId: 'decabill' },
    } as unknown as Socket;

    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'other-user' } as never);

    await gateway.handleSetProject({ projectId: 'p1' }, socket);

    expect(emit).toHaveBeenCalledWith('error', { message: 'Access denied' });
  });

  it('setProject emits error for API key auth', async () => {
    const emit = jest.fn();
    const socket = {
      id: 'socket-1',
      join: jest.fn(),
      leave: jest.fn(),
      emit,
      data: { userInfo: { isApiKeyAuth: true }, tenantId: 'decabill' },
    } as unknown as Socket;

    await gateway.handleSetProject({ projectId: 'p1' }, socket);

    expect(emit).toHaveBeenCalledWith('error', { message: 'User not authenticated' });
  });

  it('setProject requires projectId', async () => {
    const emit = jest.fn();
    const socket = {
      id: 'socket-1',
      emit,
      data: { userInfo: userSocketInfo, tenantId: 'decabill' },
    } as unknown as Socket;

    await gateway.handleSetProject({}, socket);

    expect(emit).toHaveBeenCalledWith('error', { message: 'projectId is required' });
  });

  it('setProject is idempotent when already selected', async () => {
    const emit = jest.fn();
    const socket = {
      id: 'socket-1',
      join: jest.fn(),
      leave: jest.fn(),
      emit,
      data: { userInfo: userSocketInfo, tenantId: 'decabill' },
    } as unknown as Socket;

    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'user-1' } as never);
    await gateway.handleSetProject({ projectId: 'p1' }, socket);
    emit.mockClear();
    await gateway.handleSetProject({ projectId: 'p1' }, socket);

    expect(emit).toHaveBeenCalledWith('setProjectSuccess', expect.objectContaining({ projectId: 'p1' }));
    expect(socket.join).toHaveBeenCalledTimes(1);
  });

  it('setProject switches rooms when changing project', async () => {
    const join = jest.fn();
    const leave = jest.fn();
    const emit = jest.fn();
    const socket = {
      id: 'socket-1',
      join,
      leave,
      emit,
      data: { userInfo: userSocketInfo, tenantId: 'decabill' },
    } as unknown as Socket;

    projectsRepository.findByIdOrThrow
      .mockResolvedValueOnce({ id: 'p1', userId: 'user-1' } as never)
      .mockResolvedValueOnce({ id: 'p2', userId: 'user-1' } as never);

    await gateway.handleSetProject({ projectId: 'p1' }, socket);
    await gateway.handleSetProject({ projectId: 'p2' }, socket);

    expect(leave).toHaveBeenCalled();
    expect(join).toHaveBeenCalledTimes(2);
  });

  it('handleDisconnect leaves selected project room', async () => {
    const leave = jest.fn();
    const socket = {
      id: 'socket-1',
      join: jest.fn(),
      leave,
      emit: jest.fn(),
      data: { userInfo: userSocketInfo, tenantId: 'decabill' },
    } as unknown as Socket;

    projectsRepository.findByIdOrThrow.mockResolvedValue({ id: 'p1', userId: 'user-1' } as never);
    await gateway.handleSetProject({ projectId: 'p1' }, socket);
    gateway.handleDisconnect(socket);

    expect(leave).toHaveBeenCalled();
  });
});
