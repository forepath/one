import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { IsNull } from 'typeorm';

import { OpencodeLayerFileSyncTargetEntity } from '../entities/opencode-layer-file-sync-target.entity';
import { OpencodeLayerFileEntity } from '../entities/opencode-layer-file.entity';
import { ClientsRepository } from '../repositories/clients.repository';
import { sha256Hex } from '../utils/opencode-layer-file-path.utils';
import { ClientAgentFileSystemProxyService } from './client-agent-file-system-proxy.service';
import { ClientAgentProxyService } from './client-agent-proxy.service';
import { OpencodeLayerFilesService } from './opencode-layer-files.service';

describe('OpencodeLayerFilesService', () => {
  const clientId = '11111111-1111-4111-8111-111111111111';
  const agentId = '22222222-2222-4222-8222-222222222222';
  const fileId = '33333333-3333-4333-8333-333333333333';

  const createService = async (
    deps: {
      fileRepo?: Record<string, unknown>;
      syncRepo?: Record<string, unknown>;
      clientsRepository?: Record<string, unknown>;
      agentProxy?: Record<string, unknown>;
      fileSystemProxy?: Record<string, unknown>;
    } = {},
  ) => {
    const fileRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((row) => row),
      save: jest.fn().mockImplementation(async (row) => ({
        id: fileId,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        entryKind: 'file',
        ...row,
      })),
      remove: jest.fn().mockResolvedValue(undefined),
      ...deps.fileRepo,
    };
    const syncRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      find: jest.fn().mockResolvedValue([]),
      create: jest.fn().mockImplementation((row) => row),
      save: jest.fn().mockImplementation(async (row) => row),
      ...deps.syncRepo,
    };
    const clientsRepository = {
      findAllIds: jest.fn().mockResolvedValue([clientId]),
      ...deps.clientsRepository,
    };
    const agentProxy = {
      getClientAgents: jest.fn().mockResolvedValue([{ id: agentId }]),
      ...deps.agentProxy,
    };
    const fileSystemProxy = {
      writeFile: jest.fn().mockResolvedValue(undefined),
      ...deps.fileSystemProxy,
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        OpencodeLayerFilesService,
        { provide: getRepositoryToken(OpencodeLayerFileEntity), useValue: fileRepo },
        { provide: getRepositoryToken(OpencodeLayerFileSyncTargetEntity), useValue: syncRepo },
        { provide: ClientsRepository, useValue: clientsRepository },
        { provide: ClientAgentProxyService, useValue: agentProxy },
        { provide: ClientAgentFileSystemProxyService, useValue: fileSystemProxy },
      ],
    }).compile();

    return {
      svc: moduleRef.get(OpencodeLayerFilesService),
      fileRepo,
      syncRepo,
      clientsRepository,
      agentProxy,
      fileSystemProxy,
    };
  };

  it('putWorkspace persists path as-is and fans out writeFile', async () => {
    const { svc, fileRepo, fileSystemProxy, agentProxy } = await createService();

    const dto = await svc.putWorkspace(clientId, 'skills/a.md', '# skill');

    expect(fileRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: 'workspace',
        clientId,
        path: 'skills/a.md',
        entryKind: 'file',
        content: '# skill',
        contentSha: sha256Hex('# skill'),
      }),
    );
    expect(agentProxy.getClientAgents).toHaveBeenCalledWith(clientId, 100, 0);
    expect(fileSystemProxy.writeFile).toHaveBeenCalledWith(
      clientId,
      agentId,
      'skills/a.md',
      Buffer.from('# skill', 'utf8'),
      'app',
      expect.objectContaining({ contentType: 'text/plain; charset=utf-8' }),
    );
    expect(dto.emittedPath).toBe('skills/a.md');
    expect(dto.path).toBe('skills/a.md');
  });

  it('putGlobal fans out to all clients with as-is path', async () => {
    const otherClient = '44444444-4444-4444-8444-444444444444';
    const { svc, clientsRepository, agentProxy, fileSystemProxy } = await createService({
      clientsRepository: { findAllIds: jest.fn().mockResolvedValue([clientId, otherClient]) },
      agentProxy: {
        getClientAgents: jest
          .fn()
          .mockResolvedValueOnce([{ id: agentId }])
          .mockResolvedValueOnce([{ id: '55555555-5555-4555-8555-555555555555' }]),
      },
    });

    await svc.putGlobal('/tmp/docs/readme.md', 'hello');

    expect(clientsRepository.findAllIds).toHaveBeenCalled();
    expect(agentProxy.getClientAgents).toHaveBeenCalledTimes(2);
    expect(fileSystemProxy.writeFile).toHaveBeenCalledWith(
      clientId,
      agentId,
      '/tmp/docs/readme.md',
      Buffer.from('hello', 'utf8'),
      'app',
      expect.any(Object),
    );
  });

  it('listWorkspace returns immediate children', async () => {
    const { svc, fileRepo } = await createService({
      fileRepo: {
        find: jest.fn().mockResolvedValue([
          { path: 'skills/a.md', entryKind: 'file' },
          { path: 'skills/nested/b.md', entryKind: 'file' },
          { path: 'skills/dir', entryKind: 'directory' },
        ]),
        findOne: jest.fn().mockResolvedValue({ path: 'skills', entryKind: 'directory' }),
      },
    });

    const listed = await svc.listWorkspace(clientId, 'skills');

    expect(listed.path).toBe('skills');
    expect(listed.entries.map((e) => e.name).sort()).toEqual(['a.md', 'dir', 'nested']);
  });

  it('listGlobal at . preserves absolute top-level paths', async () => {
    const { svc } = await createService({
      fileRepo: {
        find: jest.fn().mockResolvedValue([
          { path: '/opt/skills/test', entryKind: 'directory' },
          { path: '/tmp', entryKind: 'directory' },
          { path: 'relative/a.md', entryKind: 'file' },
        ]),
      },
    });

    const listed = await svc.listGlobal('.');

    expect(listed.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ name: 'opt', path: '/opt', entryKind: 'directory' }),
        expect.objectContaining({ name: 'tmp', path: '/tmp', entryKind: 'directory' }),
        expect.objectContaining({ name: 'relative', path: 'relative', entryKind: 'directory' }),
      ]),
    );
  });

  it('deleteWorkspace prunes empty ancestor directory markers', async () => {
    const leaf = {
      id: 'leaf',
      scope: 'workspace' as const,
      clientId,
      path: '/opt/skills/test/a.md',
      entryKind: 'file' as const,
      content: 'x',
      contentSha: sha256Hex('x'),
    };
    const testDir = { id: 'd1', path: '/opt/skills/test', entryKind: 'directory' as const };
    const skillsDir = { id: 'd2', path: '/opt/skills', entryKind: 'directory' as const };
    const optDir = { id: 'd3', path: '/opt', entryKind: 'directory' as const };

    const findOne = jest
      .fn()
      .mockResolvedValueOnce(leaf) // remove: find leaf
      .mockResolvedValueOnce(testDir) // prune /opt/skills/test
      .mockResolvedValueOnce(skillsDir) // prune /opt/skills
      .mockResolvedValueOnce(optDir); // prune /opt

    const find = jest
      .fn()
      .mockResolvedValueOnce([]) // descendants of leaf
      .mockResolvedValueOnce([]) // children of /opt/skills/test
      .mockResolvedValueOnce([]) // children of /opt/skills
      .mockResolvedValueOnce([]); // children of /opt

    const remove = jest.fn().mockResolvedValue(undefined);
    const { svc } = await createService({ fileRepo: { findOne, find, remove } });

    await svc.deleteWorkspace(clientId, '/opt/skills/test/a.md');

    expect(remove).toHaveBeenCalledWith(leaf);
    expect(remove).toHaveBeenCalledWith(testDir);
    expect(remove).toHaveBeenCalledWith(skillsDir);
    expect(remove).toHaveBeenCalledWith(optDir);
  });

  it('deleteWorkspace stops pruning when an ancestor still has children', async () => {
    const leaf = {
      id: 'leaf',
      scope: 'workspace' as const,
      clientId,
      path: '/opt/skills/test/a.md',
      entryKind: 'file' as const,
      content: 'x',
      contentSha: sha256Hex('x'),
    };
    const testDir = { id: 'd1', path: '/opt/skills/test', entryKind: 'directory' as const };
    const sibling = { id: 'sib', path: '/opt/skills/other.md', entryKind: 'file' as const };

    const findOne = jest.fn().mockResolvedValueOnce(leaf).mockResolvedValueOnce(testDir);

    const find = jest
      .fn()
      .mockResolvedValueOnce([]) // descendants of leaf
      .mockResolvedValueOnce([]) // children of /opt/skills/test → empty, prune
      .mockResolvedValueOnce([sibling]); // children of /opt/skills → keep

    const remove = jest.fn().mockResolvedValue(undefined);
    const { svc } = await createService({ fileRepo: { findOne, find, remove } });

    await svc.deleteWorkspace(clientId, '/opt/skills/test/a.md');

    expect(remove).toHaveBeenCalledWith(leaf);
    expect(remove).toHaveBeenCalledWith(testDir);
    expect(remove).toHaveBeenCalledTimes(2);
  });

  it('getWorkspace throws NotFound when missing', async () => {
    const { svc } = await createService();

    await expect(svc.getWorkspace(clientId, 'missing.md')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('ensureGlobal treats . as a virtual directory root', async () => {
    const { svc, fileRepo } = await createService();

    const dto = await svc.ensureGlobal('.');

    expect(dto.path).toBe('.');
    expect(dto.entryKind).toBe('directory');
    expect(fileRepo.save).not.toHaveBeenCalled();
  });

  it('ensureWorkspace nukes the container path when no other VFS occupies it', async () => {
    const deleteFileOrDirectory = jest.fn().mockResolvedValue(undefined);
    const createFileOrDirectory = jest.fn().mockResolvedValue(undefined);
    const writeFile = jest.fn().mockResolvedValue(undefined);

    const store = new Map<string, Record<string, unknown>>();
    const findOne = jest.fn().mockImplementation(async ({ where }: { where: { path?: string; scope?: string } }) => {
      if (!where.path) {
        return null;
      }

      return store.get(`${where.scope ?? 'workspace'}:${where.path}`) ?? null;
    });
    const find = jest.fn().mockImplementation(async ({ where }: { where: { path?: unknown } }) => {
      const rows = [...store.values()] as Array<{ path: string }>;

      if (typeof where.path === 'string') {
        return rows.filter((row) => row.path === where.path);
      }

      return rows.filter((row) => row.path.startsWith('/opt/skills/'));
    });
    const create = jest.fn().mockImplementation((row: Record<string, unknown>) => row);
    const save = jest.fn().mockImplementation(async (row: Record<string, unknown>) => {
      const saved = {
        id: fileId,
        updatedAt: new Date('2026-01-01T00:00:00.000Z'),
        ...row,
      };

      store.set(`${saved['scope']}:${saved['path']}`, saved);

      return saved;
    });

    const { svc } = await createService({
      fileRepo: { findOne, find, create, save },
      fileSystemProxy: { deleteFileOrDirectory, createFileOrDirectory, writeFile, listDirectory: jest.fn() },
    });

    await svc.ensureWorkspace(clientId, '/opt/skills', 'directory');

    expect(deleteFileOrDirectory).toHaveBeenCalledWith(clientId, agentId, '/opt/skills', 'app');
    expect(createFileOrDirectory).toHaveBeenCalledWith(clientId, agentId, '/opt/skills', { type: 'directory' }, 'app');
  });

  it('ensureWorkspace preserves other-VFS paths and deletes orphans', async () => {
    const globalFile = {
      id: 'g1',
      scope: 'global' as const,
      clientId: null,
      path: '/opt/skills/keep.md',
      entryKind: 'file' as const,
      content: 'keep',
      contentSha: sha256Hex('keep'),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };
    const workspaceDir = {
      id: 'w1',
      scope: 'workspace' as const,
      clientId,
      path: '/opt/skills',
      entryKind: 'directory' as const,
      content: null,
      contentSha: sha256Hex(''),
      updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    };

    const deleteFileOrDirectory = jest.fn().mockResolvedValue(undefined);
    const createFileOrDirectory = jest.fn().mockResolvedValue(undefined);
    const writeFile = jest.fn().mockResolvedValue(undefined);
    const listDirectory = jest.fn().mockResolvedValueOnce([
      { name: 'keep.md', type: 'file', path: '/opt/skills/keep.md' },
      { name: 'orphan.md', type: 'file', path: '/opt/skills/orphan.md' },
    ]);

    const findOne = jest.fn().mockResolvedValue(workspaceDir);
    const find = jest.fn().mockImplementation(async ({ where }: { where: { path?: unknown } }) => {
      if (where.path === '/opt/skills') {
        return [workspaceDir, globalFile].filter((row) => row.path === '/opt/skills');
      }

      return [globalFile];
    });

    const { svc } = await createService({
      fileRepo: { findOne, find },
      fileSystemProxy: { deleteFileOrDirectory, createFileOrDirectory, writeFile, listDirectory },
    });

    await svc.ensureWorkspace(clientId, '/opt/skills', 'directory');

    expect(deleteFileOrDirectory).toHaveBeenCalledWith(clientId, agentId, '/opt/skills/orphan.md', 'app');
    expect(deleteFileOrDirectory).not.toHaveBeenCalledWith(clientId, agentId, '/opt/skills/keep.md', 'app');
    expect(writeFile).toHaveBeenCalledWith(
      clientId,
      agentId,
      '/opt/skills/keep.md',
      Buffer.from('keep', 'utf8'),
      'app',
      expect.any(Object),
    );
  });

  it('marks sync target failed when writeFile throws', async () => {
    const existingTarget = {
      id: 'target-1',
      fileId,
      clientId,
      agentId,
      syncStatus: 'pending' as const,
      lastError: null,
      syncedSha: null,
    };
    const syncRepo = {
      findOne: jest.fn().mockResolvedValue(existingTarget),
      create: jest.fn(),
      save: jest.fn().mockImplementation(async (row) => row),
      find: jest.fn().mockResolvedValue([]),
    };
    const { svc } = await createService({
      syncRepo,
      fileSystemProxy: {
        writeFile: jest.fn().mockRejectedValue(new Error('container down')),
      },
    });

    await svc.putWorkspace(clientId, 'x.md', 'body');

    expect(syncRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        syncStatus: 'failed',
        lastError: 'container down',
      }),
    );
  });

  it('emitAllForAgent pulls global and workspace files for one agent', async () => {
    const globalFile = {
      id: 'g1',
      scope: 'global' as const,
      clientId: null,
      path: 'g.md',
      entryKind: 'file' as const,
      content: 'g',
      contentSha: sha256Hex('g'),
      updatedAt: new Date(),
    };
    const workspaceFile = {
      id: 'w1',
      scope: 'workspace' as const,
      clientId,
      path: 'w.md',
      entryKind: 'file' as const,
      content: 'w',
      contentSha: sha256Hex('w'),
      updatedAt: new Date(),
    };
    const fileRepo = {
      find: jest.fn().mockResolvedValue([globalFile, workspaceFile]),
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn(),
      save: jest.fn(),
      remove: jest.fn(),
    };
    const syncRepo = {
      findOne: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation((row) => row),
      save: jest.fn().mockImplementation(async (row) => row),
      find: jest.fn().mockResolvedValue([]),
    };
    const { svc, fileSystemProxy } = await createService({ fileRepo, syncRepo });

    await svc.emitAllForAgent(clientId, agentId);

    expect(fileRepo.find).toHaveBeenCalledWith({
      where: [
        { scope: 'global', clientId: IsNull() },
        { scope: 'workspace', clientId },
      ],
    });
    expect(fileSystemProxy.writeFile).toHaveBeenCalledTimes(2);
    expect(fileSystemProxy.writeFile).toHaveBeenCalledWith(
      clientId,
      agentId,
      'g.md',
      Buffer.from('g', 'utf8'),
      'app',
      expect.any(Object),
    );
  });

  it('skips clients that fail agent listing during global fan-out', async () => {
    const { svc, fileSystemProxy } = await createService({
      agentProxy: {
        getClientAgents: jest.fn().mockRejectedValue(new Error('manager unreachable')),
      },
    });

    await expect(svc.putGlobal('a.md', 'x')).resolves.toMatchObject({
      emittedPath: 'a.md',
    });
    expect(fileSystemProxy.writeFile).not.toHaveBeenCalled();
  });
});
