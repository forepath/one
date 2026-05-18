import { UserRole } from '@forepath/identity/backend';
import { Test, TestingModule } from '@nestjs/testing';
import type { Server } from 'socket.io';

import { AgentConsoleStatusRealtimeService } from './agent-console-status-realtime.service';

describe('AgentConsoleStatusRealtimeService', () => {
  let service: AgentConsoleStatusRealtimeService;
  const mockEmit = jest.fn();
  const mockTo = jest.fn().mockReturnValue({ emit: mockEmit });
  const mockServer = { to: mockTo } as unknown as Server;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [AgentConsoleStatusRealtimeService],
    }).compile();

    service = module.get(AgentConsoleStatusRealtimeService);
    service.attachServer(mockServer);
    jest.clearAllMocks();
  });

  it('registers and unregisters sockets per user', () => {
    service.registerSocket('user-1', 'socket-a');
    service.registerSocket('user-1', 'socket-b');

    expect(service.getUserIdForSocket('socket-a')).toBe('user-1');

    service.unregisterSocket('socket-a');
    expect(service.getUserIdForSocket('socket-a')).toBeUndefined();
    expect(service.getUserIdForSocket('socket-b')).toBe('user-1');

    service.unregisterSocket('socket-b');
    expect(service.getUserIdForSocket('socket-b')).toBeUndefined();
  });

  it('emitToUser sends event to all sockets for user', () => {
    service.registerSocket('user-1', 'socket-a');
    service.registerSocket('user-1', 'socket-b');

    service.emitToUser('user-1', 'statusPatch', { ok: true });

    expect(mockTo).toHaveBeenCalledWith('socket-a');
    expect(mockTo).toHaveBeenCalledWith('socket-b');
    expect(mockEmit).toHaveBeenCalledWith('statusPatch', { ok: true });
    expect(mockEmit).toHaveBeenCalledTimes(2);
  });

  it('emitToUser is no-op when server not attached', () => {
    const detached = new AgentConsoleStatusRealtimeService();

    detached.registerSocket('user-1', 'socket-a');
    detached.emitToUser('user-1', 'statusPatch', {});

    expect(mockEmit).not.toHaveBeenCalled();
  });

  it('emitToUsers fans out to each user', () => {
    service.registerSocket('user-1', 's1');
    service.registerSocket('user-2', 's2');

    service.emitToUsers(['user-1', 'user-2'], 'statusPatch', { x: 1 });

    expect(mockTo).toHaveBeenCalledWith('s1');
    expect(mockTo).toHaveBeenCalledWith('s2');
  });

  it('tracks connected user ids and roles until last socket disconnects', () => {
    service.registerSocket('admin-1', 's1', UserRole.ADMIN);
    service.registerSocket('admin-1', 's2', UserRole.ADMIN);

    expect(service.getConnectedUserIds()).toEqual(['admin-1']);
    expect(service.getUserRole('admin-1')).toBe(UserRole.ADMIN);

    service.unregisterSocket('s1');
    expect(service.getConnectedUserIds()).toEqual(['admin-1']);

    service.unregisterSocket('s2');
    expect(service.getConnectedUserIds()).toEqual([]);
    expect(service.getUserRole('admin-1')).toBeUndefined();
  });
});
