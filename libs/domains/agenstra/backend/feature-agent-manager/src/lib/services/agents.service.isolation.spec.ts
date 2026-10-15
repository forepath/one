import { BadRequestException, ConflictException, ServiceUnavailableException } from '@nestjs/common';

import { GitRepositorySetupMode } from '../constants/git-repository-setup-mode';
import type { HostIsolationCapabilitiesDto } from '../dto/container-isolation.dto';
import { ContainerType } from '../entities/agent.entity';

import { AgentsService } from './agents.service';

function capabilities(
  standard = 'ready',
  sandboxed = 'ready',
  revision = 'sha256:current',
): HostIsolationCapabilitiesDto {
  return {
    revision,
    probedAt: '2026-10-15T20:00:00.000Z',
    probing: false,
    levels: {
      standard: { rank: 1, runtime: 'runc', state: standard as 'ready' },
      sandboxed: { rank: 2, runtime: 'runsc-systrap', state: sandboxed as 'ready' },
    },
    recommendedLevel: null,
    availableLevels: [],
  };
}

describe('AgentsService container isolation', () => {
  const primarySession = {
    id: 'chat-1',
    agentId: 'agent-1',
    kind: 'primary',
    title: null,
    lastMessageAt: null,
    createdAt: new Date(),
  };
  let repository: { findByName: jest.Mock; create: jest.Mock; delete: jest.Mock };
  let docker: Record<string, jest.Mock>;
  let isolation: {
    getCapabilitiesForCreation: jest.Mock;
    getCapabilities: jest.Mock;
    recordRuntimeFailure: jest.Mock;
    recordRuntimeSuccess: jest.Mock;
  };
  let service: AgentsService;

  beforeEach(() => {
    repository = {
      findByName: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async (dto) => ({
        id: 'agent-1',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...dto,
      })),
      delete: jest.fn().mockResolvedValue(undefined),
    };
    docker = {
      ensureImageExists: jest.fn().mockResolvedValue(undefined),
      ensureNetworkExists: jest.fn().mockResolvedValue(undefined),
      createContainer: jest.fn().mockResolvedValue('container-1'),
      deleteContainer: jest.fn().mockResolvedValue(undefined),
      sendCommandToContainer: jest.fn().mockResolvedValue(''),
      getContainerHomeDirectory: jest.fn().mockResolvedValue('/home/agenstra'),
    };
    isolation = {
      getCapabilitiesForCreation: jest.fn().mockResolvedValue(capabilities()),
      getCapabilities: jest.fn().mockReturnValue(capabilities()),
      recordRuntimeFailure: jest.fn(),
      recordRuntimeSuccess: jest.fn(),
    };

    const provider = {
      getDockerImage: jest.fn().mockReturnValue('worker:latest'),
      getBasePath: jest.fn().mockReturnValue('/app'),
      getCapabilities: jest.fn().mockReturnValue({ supportsChat: true }),
    };
    const chatSessions = {
      ensurePrimarySession: jest.fn().mockResolvedValue(primarySession),
      getSummariesByAgentIds: jest
        .fn()
        .mockImplementation(
          async (ids: string[]) => new Map(ids.map((id) => [id, [{ ...primarySession, agentId: id }]])),
        ),
      mapToSummaryDto: jest.fn().mockImplementation((s) => ({ id: s.id, kind: s.kind })),
    };

    service = new AgentsService(
      repository as never,
      docker as never,
      { hashPassword: jest.fn().mockResolvedValue('hash') } as never,
      { getProvider: jest.fn().mockReturnValue(provider) } as never,
      chatSessions as never,
      { waitForHealthy: jest.fn().mockResolvedValue(undefined) } as never,
      { configureForContainer: jest.fn() } as never,
      undefined,
      undefined,
      undefined,
      undefined,
      isolation as never,
    );
  });

  const dto = (extra: Record<string, unknown> = {}) => ({
    name: 'env',
    containerType: ContainerType.GENERIC,
    gitRepositorySetupMode: GitRepositorySetupMode.EMPTY,
    ...extra,
  });

  it('defaults to the recommended (sandboxed) level and runs the container on gVisor', async () => {
    const created = await service.create(dto({ isolationSelection: { selectedBy: 'user-1' } }));

    expect(docker.createContainer).toHaveBeenCalledWith(expect.objectContaining({ runtime: 'runsc-systrap' }));
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        isolationLevel: 'sandboxed',
        isolationSelection: expect.objectContaining({
          automaticSelection: 'sandboxed',
          effectiveSelection: 'sandboxed',
          selectionSource: 'automatic',
          selectedBy: 'user-1',
          capabilityRevision: 'sha256:current',
        }),
      }),
    );
    expect(created.isolation).toEqual(
      expect.objectContaining({
        level: 'sandboxed',
        runtime: process.env.AGENT_DOCKER_NETWORK?.trim() ? 'runsc-systrap-hostnet' : 'runsc-systrap',
      }),
    );
    expect(isolation.recordRuntimeSuccess).toHaveBeenCalledWith('sandboxed');
  });

  it('defaults to standard on runc-only hosts (unchanged behaviour)', async () => {
    isolation.getCapabilitiesForCreation.mockResolvedValue(capabilities('ready', 'unsupported'));

    await service.create(dto());

    expect(docker.createContainer.mock.calls[0][0].runtime).toBeUndefined();
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ isolationLevel: 'standard' }));
  });

  it('records an explicit standard selection as a user override', async () => {
    await service.create(dto({ isolationLevel: 'standard' }));

    expect(docker.createContainer.mock.calls[0][0].runtime).toBeUndefined();
    expect(repository.create).toHaveBeenCalledWith(
      expect.objectContaining({
        isolationLevel: 'standard',
        isolationSelection: expect.objectContaining({
          selectionSource: 'user-override',
          automaticSelection: 'sandboxed',
        }),
      }),
    );
  });

  it('rejects stale capability revisions before provisioning anything', async () => {
    await expect(service.create(dto({ capabilityRevision: 'sha256:old' }))).rejects.toBeInstanceOf(ConflictException);
    expect(docker.createContainer).not.toHaveBeenCalled();
  });

  it('rejects an unavailable sandboxed level instead of downgrading', async () => {
    isolation.getCapabilitiesForCreation.mockResolvedValue(capabilities('ready', 'probe-failed'));

    await expect(service.create(dto({ isolationLevel: 'sandboxed' }))).rejects.toBeInstanceOf(ConflictException);
    expect(docker.createContainer).not.toHaveBeenCalled();
  });

  it('refuses hosts whose runc baseline is not ready', async () => {
    isolation.getCapabilitiesForCreation.mockResolvedValue(capabilities('probe-failed', 'ready'));

    await expect(service.create(dto())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects unknown isolation levels', async () => {
    await expect(service.create(dto({ isolationLevel: 'vm' }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('never retries a failed sandboxed container on runc', async () => {
    docker.createContainer.mockRejectedValue(new Error('runsc: unsupported syscall'));

    await expect(service.create(dto())).rejects.toThrow(/sandboxed \(gVisor\) container could not be started/);
    expect(docker.createContainer).toHaveBeenCalledTimes(1);
    expect(isolation.recordRuntimeFailure).toHaveBeenCalledWith('sandboxed');
    expect(repository.create).not.toHaveBeenCalled();
  });

  it('names the worker after the pre-assigned agent id', async () => {
    const created = await service.create(dto());
    const options = docker.createContainer.mock.calls[0][0];

    expect(options.name).toBe(`agenstra-worker-${created.id}`);
    expect(options.labels).toEqual({ 'io.agenstra.agent-id': created.id, 'io.agenstra.worker': '1' });
    expect(repository.create).toHaveBeenCalledWith(expect.objectContaining({ id: created.id }));
  });

  it('renames containers of existing environments to the naming pattern on startup', async () => {
    const findAllWithContainers = jest.fn().mockResolvedValue([
      { id: 'agent-a', containerId: 'worker-a', egressGuardContainerId: 'guard-a' },
      { id: 'agent-b', containerId: 'worker-b', egressGuardContainerId: null },
    ]);

    (repository as unknown as Record<string, jest.Mock>)['findAllWithContainers'] = findAllWithContainers;
    docker['renameContainerIfNeeded'] = jest
      .fn()
      .mockResolvedValueOnce('renamed')
      .mockResolvedValueOnce('conflict')
      .mockResolvedValueOnce('unchanged');

    await service.normalizeContainerNames();

    expect(docker['renameContainerIfNeeded'].mock.calls).toEqual([
      ['worker-a', 'agenstra-worker-agent-a'],
      ['guard-a', 'agenstra-egress-agent-a'],
      ['worker-b', 'agenstra-worker-agent-b'],
    ]);
  });
});
