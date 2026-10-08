import { Test } from '@nestjs/testing';

import { AgentsRepository } from '../repositories/agents.repository';
import { DockerService } from './docker.service';
import { WorkspaceChangeNotifierService } from './workspace-change-notifier.service';
import { WorkspaceInotifySupervisor } from './workspace-inotify-supervisor.service';

describe('WorkspaceInotifySupervisor.parseInotifyLine', () => {
  const supervisor = Object.create(WorkspaceInotifySupervisor.prototype) as WorkspaceInotifySupervisor;

  it('maps close_write to upsert', () => {
    expect(supervisor.parseInotifyLine('/app/src/a.ts|CLOSE_WRITE,CLOSE', '/app')).toEqual({
      path: 'src/a.ts',
      op: 'upsert',
    });
  });

  describe('WorkspaceInotifySupervisor tree invalidation', () => {
    it('debounces ignored search paths but still invalidates their directory index', async () => {
      jest.useFakeTimers();
      let onLine!: (line: string) => void;
      const stop = jest.fn().mockResolvedValue(undefined);
      const module = await Test.createTestingModule({
        providers: [
          WorkspaceInotifySupervisor,
          WorkspaceChangeNotifierService,
          {
            provide: AgentsRepository,
            useValue: { findById: jest.fn().mockResolvedValue({ containerId: 'container' }) },
          },
          {
            provide: DockerService,
            useValue: {
              startStreamingExec: jest.fn(async (_containerId, _args, callback: (line: string) => void) => {
                onLine = callback;
                return { stop };
              }),
            },
          },
        ],
      }).compile();
      const supervisor = module.get(WorkspaceInotifySupervisor);
      const notifier = module.get(WorkspaceChangeNotifierService);
      const invalidate = jest.fn().mockResolvedValue(undefined);
      const broadcast = jest.fn();
      notifier.registerTreeInvalidator(invalidate);
      notifier.registerIndexBroadcaster(broadcast);

      try {
        await supervisor.startWatcher('agent');
        onLine('/app/.env|CREATE');
        onLine('/app/.env|CLOSE_WRITE');
        expect(invalidate).not.toHaveBeenCalled();
        await jest.advanceTimersByTimeAsync(250);
        expect(invalidate).toHaveBeenCalledTimes(1);
        expect(invalidate).toHaveBeenCalledWith('agent');
        expect(broadcast).not.toHaveBeenCalled();
      } finally {
        await supervisor.onModuleDestroy();
        jest.useRealTimers();
      }
    });
  });

  it('maps delete to delete', () => {
    expect(supervisor.parseInotifyLine('/app/gone.ts|DELETE', '/app')).toEqual({
      path: 'gone.ts',
      op: 'delete',
    });
  });

  it('returns null for malformed lines', () => {
    expect(supervisor.parseInotifyLine('no-separator', '/app')).toBeNull();
  });
});
