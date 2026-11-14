import { NotFoundException, ServiceUnavailableException } from '@nestjs/common';

import type { AgentEntity } from '../entities/agent.entity';
import type { AgentProviderFactory } from '../providers/agent-provider.factory';
import type { AgentsRepository } from '../repositories/agents.repository';
import type { AgentContextTicketRecord } from '../types/agent-context.types';

import type { AgentHandoffsApiService } from './agent-handoffs-api.service';
import { AgentWorkspaceMountsService, workspaceMountIdOf } from './agent-workspace-mounts.service';

const SELF_ID = '11111111-1111-4111-8111-111111111111';
const PEER_ID = '22222222-2222-4222-8222-222222222222';
const FOREIGN_ID = '33333333-3333-4333-8333-333333333333';
const SELF_MOUNT = 'aaaaaaaa-0000-4000-8000-000000000001';
const PEER_MOUNT = 'bbbbbbbb-0000-4000-8000-000000000002';
const FOREIGN_MOUNT = 'cccccccc-0000-4000-8000-000000000003';

function entity(id: string, overrides: Partial<AgentEntity> = {}): AgentEntity {
  return { id, name: `agent ${id.slice(0, 4)}`, agentType: 'opencode', ...overrides } as AgentEntity;
}

describe('AgentWorkspaceMountsService', () => {
  let entities: Map<string, AgentEntity>;
  let repository: { findById: jest.Mock; findByIds: jest.Mock };
  let handoffs: { peers: jest.Mock };
  let providerFactory: { getProvider: jest.Mock };
  let service: AgentWorkspaceMountsService;
  const record = (environmentIds: string[] = []): AgentContextTicketRecord =>
    ({
      agentId: SELF_ID,
      ticket: 'ctx-1',
      environments: environmentIds.map((id) => ({ id })),
    }) as AgentContextTicketRecord;

  beforeEach(() => {
    entities = new Map([
      [
        SELF_ID,
        entity(SELF_ID, {
          name: 'Backend',
          description: 'API service',
          gitRepositoryUrl: 'https://git.example/backend.git',
          volumePath: `/opt/agents/${SELF_MOUNT}`,
        }),
      ],
      [PEER_ID, entity(PEER_ID, { name: 'Frontend', volumePath: `/opt/agents/${PEER_MOUNT}` })],
      [FOREIGN_ID, entity(FOREIGN_ID, { name: 'Other workspace', volumePath: `/opt/agents/${FOREIGN_MOUNT}` })],
    ]);
    repository = {
      findById: jest.fn(async (id: string) => entities.get(id) ?? null),
      findByIds: jest.fn(async (ids: string[]) => ids.map((id) => entities.get(id)).filter(Boolean)),
    };
    // The controller's workspace list: the foreign agent on the same host is not part of it.
    handoffs = {
      peers: jest
        .fn()
        .mockResolvedValue([
          { id: PEER_ID, name: 'Frontend', description: 'Angular app', repositoryUrl: 'https://git.example/fe.git' },
        ]),
    };
    providerFactory = { getProvider: jest.fn().mockReturnValue({ getBasePath: () => '/app' }) };
    service = new AgentWorkspaceMountsService(
      repository as unknown as AgentsRepository,
      handoffs as unknown as AgentHandoffsApiService,
      providerFactory as unknown as AgentProviderFactory,
    );
  });

  it('extracts plain mount ids from host volume paths only', () => {
    expect(workspaceMountIdOf(`/opt/agents/${SELF_MOUNT}`)).toBe(SELF_MOUNT);
    expect(workspaceMountIdOf('/opt/agents/../etc')).toBeUndefined();
    expect(workspaceMountIdOf('/opt/agents/a/b')).toBeUndefined();
    expect(workspaceMountIdOf('/srv/agents/x')).toBeUndefined();
    expect(workspaceMountIdOf('/opt/agents/')).toBeUndefined();
    expect(workspaceMountIdOf(null)).toBeUndefined();
  });

  it('lists the own environment first, then the workspace peers, never other agents of the host', async () => {
    const result = await service.mounts(record([PEER_ID, FOREIGN_ID]));

    expect(result).toEqual({
      root: '/opt/workspace',
      readOnly: true,
      mounts: [
        {
          environmentId: SELF_ID,
          name: 'Backend',
          description: 'API service',
          repositoryUrl: 'https://git.example/backend.git',
          mountId: SELF_MOUNT,
          mountPath: `/opt/workspace/${SELF_MOUNT}`,
          self: true,
          workingDirectory: '/app',
        },
        {
          environmentId: PEER_ID,
          name: 'Frontend',
          description: 'Angular app',
          repositoryUrl: 'https://git.example/fe.git',
          mountId: PEER_MOUNT,
          mountPath: `/opt/workspace/${PEER_MOUNT}`,
          selected: true,
        },
      ],
      note: expect.stringContaining('do not belong to environments of your workspace'),
    });
    expect(JSON.stringify(result)).not.toContain(FOREIGN_MOUNT);
    expect(JSON.stringify(result)).not.toContain('Other workspace');
    expect(repository.findByIds).toHaveBeenCalledWith([PEER_ID]);
  });

  it('lists only the own environment without a controller connection', async () => {
    handoffs.peers.mockRejectedValue(new ServiceUnavailableException('Handoffs are unavailable'));

    const result = await service.mounts(record());

    expect(result.mounts.map((mount) => mount.environmentId)).toEqual([SELF_ID]);
    expect(result.note).toContain('only your own environment is listed');
  });

  it('omits the mount of environments without a plain host directory', async () => {
    entities.set(PEER_ID, entity(PEER_ID, { name: 'Frontend', volumePath: undefined }));

    const { mounts } = await service.mounts(record());

    expect(mounts[1]).toEqual({
      environmentId: PEER_ID,
      name: 'Frontend',
      description: 'Angular app',
      repositoryUrl: 'https://git.example/fe.git',
    });
  });

  it('fails for unknown agents', async () => {
    await expect(service.mounts({ ...record(), agentId: FOREIGN_ID.replace('3', '4') })).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  describe('resolve', () => {
    it('resolves environment ids and mount ids (case-insensitive) to the environment', async () => {
      const byId = await service.mounts(record(), PEER_ID.toUpperCase());
      const byMount = await service.mounts(record(), PEER_MOUNT);

      for (const result of [byId, byMount]) {
        expect(result.mounts).toHaveLength(1);
        expect(result.mounts[0]).toMatchObject({ environmentId: PEER_ID, mountPath: `/opt/workspace/${PEER_MOUNT}` });
        expect(result.resolved).toEqual({ input: expect.any(String), environmentId: PEER_ID });
      }
    });

    it('resolves paths below a mount or the own working directory to a relative path', async () => {
      const mounted = await service.mounts(record(), `/opt/workspace/${PEER_MOUNT}/src/../src/app.ts`);
      const own = await service.mounts(record(), '/app/README.md');
      const root = await service.mounts(record(), `/opt/workspace/${PEER_MOUNT}/`);

      expect(mounted.resolved).toEqual({
        input: `/opt/workspace/${PEER_MOUNT}/src/../src/app.ts`,
        environmentId: PEER_ID,
        relativePath: 'src/app.ts',
        mountedPath: `/opt/workspace/${PEER_MOUNT}/src/app.ts`,
      });
      expect(own.resolved).toMatchObject({
        environmentId: SELF_ID,
        relativePath: 'README.md',
        mountedPath: `/opt/workspace/${SELF_MOUNT}/README.md`,
      });
      expect(root.resolved).toMatchObject({ environmentId: PEER_ID, relativePath: '' });
    });

    it('does not resolve directories or paths outside the workspace', async () => {
      for (const input of [
        FOREIGN_ID,
        FOREIGN_MOUNT,
        `/opt/workspace/${FOREIGN_MOUNT}/secrets.env`,
        `/opt/workspace/${PEER_MOUNT}/../${FOREIGN_MOUNT}`,
        '/opt/workspace',
        '/etc/passwd',
        'Other workspace',
      ]) {
        const result = await service.mounts(record(), input);

        expect(result.mounts).toEqual([]);
        expect(result.resolved).toBeUndefined();
        expect(result.note).toContain('matches no environment of your workspace');
      }
    });

    it('resolves names only when they are unique', async () => {
      await expect(service.mounts(record(), 'frontend')).resolves.toMatchObject({
        resolved: { environmentId: PEER_ID },
      });

      handoffs.peers.mockResolvedValue([
        { id: PEER_ID, name: 'Backend' },
        { id: FOREIGN_ID, name: 'Other' },
      ]);

      await expect(service.mounts(record(), 'backend')).resolves.toMatchObject({ mounts: [] });
    });
  });

  describe('withEnvironmentMounts', () => {
    const list = (environments: Array<{ id: string }>) => ({
      ticket: 'ctx-1',
      items: [],
      attachments: [],
      environments,
      canRequestAccess: true,
    });

    it('adds name and mount path of selected workspace environments only', async () => {
      const result = await service.withEnvironmentMounts(
        record([PEER_ID, FOREIGN_ID]),
        list([{ id: PEER_ID }, { id: FOREIGN_ID }]),
      );

      expect(result.environments).toEqual([
        { id: PEER_ID, name: 'Frontend', mountPath: `/opt/workspace/${PEER_MOUNT}` },
        { id: FOREIGN_ID },
      ]);
    });

    it('does not look anything up without selected environments', async () => {
      const response = list([]);

      await expect(service.withEnvironmentMounts(record(), response)).resolves.toBe(response);
      expect(repository.findById).not.toHaveBeenCalled();
      expect(handoffs.peers).not.toHaveBeenCalled();
    });

    it('keeps plain ids when the lookup fails', async () => {
      repository.findById.mockRejectedValue(new Error('db down'));

      const response = list([{ id: PEER_ID }]);

      await expect(service.withEnvironmentMounts(record([PEER_ID]), response)).resolves.toBe(response);
    });
  });
});
