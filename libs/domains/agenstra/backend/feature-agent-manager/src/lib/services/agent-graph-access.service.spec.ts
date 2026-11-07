import { ForbiddenException, NotFoundException } from '@nestjs/common';

import type { AgentEntity } from '../entities/agent.entity';

import { AgentGraphAccessService } from './agent-graph-access.service';

const SELF = '11111111-1111-4111-8111-111111111111';
const PEER = '22222222-2222-4222-8222-222222222222';
const FOREIGN = '33333333-3333-4333-8333-333333333333';
const UNMOUNTED = '44444444-4444-4444-8444-444444444444';

function agent(id: string, name: string, volumePath: string | null, containerId = `c-${id}`): AgentEntity {
  return { id, name, volumePath, containerId, agentType: 'opencode' } as unknown as AgentEntity;
}

describe('AgentGraphAccessService', () => {
  const self = agent(SELF, 'Self', '/opt/agents/m-self');
  const peer = agent(PEER, 'Peer', '/opt/agents/m-peer');
  const foreign = agent(FOREIGN, 'Foreign secret name', '/opt/agents/m-foreign');
  const unmounted = agent(UNMOUNTED, 'Elsewhere', '/srv/other');
  let agentsRepository: { findById: jest.Mock; findAllWithContainers: jest.Mock };
  let dockerService: { hasWorkspaceContextMount: jest.Mock };
  let handoffs: { peers: jest.Mock };
  let graphs: { statuses: jest.Mock };
  let service: AgentGraphAccessService;

  beforeEach(() => {
    agentsRepository = {
      findById: jest.fn(
        async (id: string) => [self, peer, foreign, unmounted].find((entry) => entry.id === id) ?? null,
      ),
      findAllWithContainers: jest.fn(async () => [self, peer, foreign, unmounted]),
    };
    dockerService = { hasWorkspaceContextMount: jest.fn(async () => true) };
    handoffs = { peers: jest.fn(async () => [{ id: PEER, name: 'Peer (controller)' }]) };
    graphs = {
      statuses: jest.fn(
        async (ids: string[]) => new Map(ids.map((id) => [id, { status: 'ready', builtAt: null, fileCount: 1 }])),
      ),
    };
    service = new AgentGraphAccessService(
      agentsRepository as never,
      dockerService as never,
      handoffs as never,
      graphs as never,
      { workingDirectoryOf: () => '/app' } as never,
    );
  });

  it('lists the own environment and every mounted one; names only for workspace peers', async () => {
    const { environments } = await service.environments(SELF);

    expect(environments.map((entry) => entry.environmentId)).toEqual([SELF, PEER, FOREIGN]);
    expect(environments[0]).toMatchObject({
      self: true,
      name: 'Self',
      workingDirectory: '/app',
      referencesReadable: true,
    });
    expect(environments[1]).toMatchObject({
      workspacePeer: true,
      name: 'Peer (controller)',
      mountPath: '/opt/workspace/m-peer',
      referencesReadable: true,
    });
    expect(environments[2]).toMatchObject({ mountId: 'm-foreign', referencesReadable: false });
    expect(environments[2].name).toBeUndefined();
    expect(JSON.stringify(environments)).not.toContain('Foreign secret name');
  });

  it('only exposes the own environment when the caller has no /opt/workspace mount', async () => {
    dockerService.hasWorkspaceContextMount.mockResolvedValue(false);

    const response = await service.environments(SELF);

    expect(response.environments.map((entry) => entry.environmentId)).toEqual([SELF]);
    await expect(service.resolve(SELF, PEER)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('resolves ids, mount ids, peer names and paths', async () => {
    await expect(service.resolve(SELF, undefined)).resolves.toMatchObject({
      environmentId: SELF,
      self: true,
      base: { root: '/app' },
    });
    await expect(service.resolve(SELF, 'm-peer')).resolves.toMatchObject({ environmentId: PEER, workspacePeer: true });
    await expect(service.resolve(SELF, 'peer (controller)')).resolves.toMatchObject({ environmentId: PEER });
    await expect(service.resolve(SELF, '/opt/workspace/m-foreign/src/a.ts')).resolves.toMatchObject({
      environmentId: FOREIGN,
      relativePath: 'src/a.ts',
      referencesReadable: false,
      base: { root: '/opt/workspace/m-foreign' },
    });
    await expect(service.resolve(SELF, '/app/src/b.ts')).resolves.toMatchObject({
      environmentId: SELF,
      relativePath: 'src/b.ts',
    });
  });

  it('never resolves names of non-peers or environments outside the mount', async () => {
    await expect(service.resolve(SELF, 'Foreign secret name')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.resolve(SELF, UNMOUNTED)).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.resolve(SELF, '/opt/workspace/../agents/x')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('denies reference graphs of non-peers', async () => {
    const target = await service.resolve(SELF, FOREIGN);

    expect(() => service.assertReferencesReadable(target)).toThrow(ForbiddenException);
    expect(() => service.assertReferencesReadable({ ...target, referencesReadable: true })).not.toThrow();
  });

  it('treats everyone as anonymous when the controller is unreachable', async () => {
    handoffs.peers.mockRejectedValue(new Error('no controller'));

    const response = await service.environments(SELF);

    expect(response.environments.find((entry) => entry.environmentId === PEER)).toMatchObject({
      referencesReadable: false,
    });
    expect(response.note).toContain('membership');
  });
});
