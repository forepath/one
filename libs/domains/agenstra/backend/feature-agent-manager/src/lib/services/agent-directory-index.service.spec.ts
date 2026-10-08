import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { AgentDirectoryIndexEntity } from '../entities/agent-directory-index.entity';
import { AgentDirectoryIndexService } from './agent-directory-index.service';
import { WorkspaceChangeNotifierService } from './workspace-change-notifier.service';

type Snapshot = Pick<
  AgentDirectoryIndexEntity,
  'id' | 'agentId' | 'containerId' | 'directoryPath' | 'nodes' | 'refreshedAt'
>;

describe('AgentDirectoryIndexService', () => {
  let service: AgentDirectoryIndexService;
  let notifier: WorkspaceChangeNotifierService;
  let snapshots: Map<string, Snapshot>;
  const load = jest.fn();
  const repository = {
    findOneBy: jest.fn(),
    upsert: jest.fn(),
    delete: jest.fn(),
  };
  const nodes = [{ name: 'main.ts', path: 'src/main.ts', type: 'file' as const }];

  beforeEach(async () => {
    jest.useFakeTimers();
    snapshots = new Map();
    load.mockReset().mockResolvedValue(nodes);
    repository.findOneBy.mockReset().mockImplementation(async ({ id }: { id: string }) => snapshots.get(id) ?? null);
    repository.upsert.mockReset().mockImplementation(async (entry: Snapshot) => {
      snapshots.set(entry.id, entry);
    });
    repository.delete.mockReset().mockImplementation(async ({ agentId }: { agentId?: string }) => {
      for (const [id, entry] of snapshots) {
        if (agentId ? entry.agentId === agentId : Date.now() - entry.refreshedAt.getTime() > 30_000) {
          snapshots.delete(id);
        }
      }
    });
    const module = await Test.createTestingModule({
      providers: [
        AgentDirectoryIndexService,
        WorkspaceChangeNotifierService,
        { provide: getRepositoryToken(AgentDirectoryIndexEntity), useValue: repository },
      ],
    }).compile();
    service = module.get(AgentDirectoryIndexService);
    notifier = module.get(WorkspaceChangeNotifierService);
    service.onModuleInit();
  });

  afterEach(() => {
    service.onModuleDestroy();
    jest.useRealTimers();
  });

  it('populates missing directories, including empty ones, and reuses persisted listings', async () => {
    expect(await service.getOrLoad('a', 'container', 'src', load)).toEqual(nodes);
    expect(await service.getOrLoad('a', 'container', 'src', load)).toEqual(nodes);
    load.mockResolvedValue([]);
    expect(await service.getOrLoad('a', 'container', 'empty', load)).toEqual([]);
    expect(await service.getOrLoad('a', 'container', 'empty', load)).toEqual([]);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('isolates agents, containers and directories', async () => {
    await service.getOrLoad('a', 'container', 'src', load);
    await service.getOrLoad('b', 'container', 'src', load);
    await service.getOrLoad('a', 'replacement', 'src', load);
    await service.getOrLoad('a', 'container', 'other', load);
    expect(load).toHaveBeenCalledTimes(4);
  });

  it('reloads at the freshness boundary even without a watcher event', async () => {
    await service.getOrLoad('a', 'container', 'src', load);
    jest.setSystemTime(Date.now() + 30_000);
    await service.getOrLoad('a', 'container', 'src', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('bypasses a fresh listing for explicit refresh', async () => {
    await service.getOrLoad('a', 'container', 'src', load);
    await service.getOrLoad('a', 'container', 'src', load, true);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('invalidates all directories for an agent, including search-excluded changes', async () => {
    await service.getOrLoad('a', 'container', '.', load);
    await service.getOrLoad('a', 'container', 'src', load);
    await service.getOrLoad('b', 'container', 'src', load);
    notifier.notifyPathChanges('a', [{ path: '.env', op: 'delete' }], 'delete');
    await service.getOrLoad('a', 'container', '.', load);
    await service.getOrLoad('a', 'container', 'src', load);
    await service.getOrLoad('b', 'container', 'src', load);
    expect(load).toHaveBeenCalledTimes(5);
  });

  it('invalidates on bulk changes and workspace rebuilds', async () => {
    await service.getOrLoad('a', 'container', 'src', load);
    notifier.notifyRebuildRequired('a', 'vcs');
    await service.getOrLoad('a', 'container', 'src', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('does not let an in-flight listing undo a later invalidation', async () => {
    let resolveLoad!: (value: typeof nodes) => void;
    const slowLoad = jest.fn(
      () =>
        new Promise<typeof nodes>((resolve) => {
          resolveLoad = resolve;
        }),
    );
    const first = service.getOrLoad('a', 'container', 'src', slowLoad);
    await Promise.resolve();
    await Promise.resolve();
    const invalidation = service.invalidate('a');
    const next = service.getOrLoad('a', 'container', 'src', load);
    resolveLoad(nodes);
    await first;
    await invalidation;
    await next;
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('propagates listing failures without caching an empty successful result', async () => {
    load.mockRejectedValueOnce(new Error('Directory not found'));
    await expect(service.getOrLoad('a', 'container', 'src', load)).rejects.toThrow('Directory not found');
    expect(repository.upsert).not.toHaveBeenCalled();
    await expect(service.getOrLoad('a', 'container', 'src', load)).resolves.toEqual(nodes);
  });

  it('periodically removes expired snapshots and stops cleanup on shutdown', async () => {
    await service.getOrLoad('a', 'container', 'src', load);
    await jest.advanceTimersByTimeAsync(60_000);
    expect(snapshots.size).toBe(0);
    service.onModuleDestroy();
    const count = repository.delete.mock.calls.length;
    await jest.advanceTimersByTimeAsync(60_000);
    expect(repository.delete).toHaveBeenCalledTimes(count);
  });
});
