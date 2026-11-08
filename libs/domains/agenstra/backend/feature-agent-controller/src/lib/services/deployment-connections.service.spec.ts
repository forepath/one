import { generateKeyPairSync } from 'crypto';

import { BadRequestException, ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';

import type { DeploymentConnectionEntity } from '../entities/deployment-connection.entity';
import type { DeploymentPipelineProvider } from '../providers/deployment/deployment-provider.interface';
import type { DeploymentProviderRegistry } from '../providers/deployment/deployment-provider.registry';
import type { AgenstraSearchIndexService } from '../search/agenstra-search-index.service';

import { DeploymentConnectionsService } from './deployment-connections.service';

const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
  .privateKey.export({ type: 'pkcs1', format: 'pem' })
  .toString();
const CLIENT_A = '11111111-1111-4111-8111-111111111111';
const CLIENT_B = '22222222-2222-4222-8222-222222222222';

function entity(overrides: Partial<DeploymentConnectionEntity> = {}): DeploymentConnectionEntity {
  return {
    id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    label: 'GH',
    provider: 'github',
    baseUrl: null,
    authType: 'token',
    appId: null,
    installationId: null,
    username: null,
    credentials: JSON.stringify({ token: 'ghp_storedtokenvalue' }),
    workspaceAccess: 'all',
    allowedClientIds: [],
    lastTestStatus: 'untested',
    lastTestMessage: null,
    lastTestedAt: null,
    createdByUserId: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
    ...overrides,
  };
}

describe('DeploymentConnectionsService', () => {
  let repo: Record<string, jest.Mock>;
  let workflowsRepo: { count: jest.Mock };
  let clientsRepo: { count: jest.Mock };
  let searchIndex: { upsertSafe: jest.Mock; deleteSafe: jest.Mock; isEnabled: jest.Mock; searchIds: jest.Mock };
  let adapter: jest.Mocked<Pick<DeploymentPipelineProvider, 'testConnection'>> & { provider: 'github' };
  let registry: { get: jest.Mock };
  let qb: Record<string, jest.Mock>;
  let service: DeploymentConnectionsService;

  beforeEach(() => {
    qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getMany: jest.fn().mockResolvedValue([]),
    };
    repo = {
      create: jest.fn((v) => ({ ...v })),
      save: jest.fn(async (v) => ({ id: 'new-id', createdAt: new Date(), updatedAt: new Date(), ...v })),
      findOne: jest.fn(),
      find: jest.fn().mockResolvedValue([]),
      findBy: jest.fn().mockResolvedValue([]),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn(() => qb),
    };
    workflowsRepo = { count: jest.fn().mockResolvedValue(0) };
    clientsRepo = { count: jest.fn().mockResolvedValue(1) };
    searchIndex = {
      upsertSafe: jest.fn().mockResolvedValue(undefined),
      deleteSafe: jest.fn().mockResolvedValue(undefined),
      isEnabled: jest.fn().mockReturnValue(false),
      searchIds: jest.fn(),
    };
    adapter = { provider: 'github', testConnection: jest.fn() };
    registry = { get: jest.fn().mockReturnValue(adapter) };
    service = new DeploymentConnectionsService(
      repo as never,
      workflowsRepo as never,
      clientsRepo as never,
      registry as unknown as DeploymentProviderRegistry,
      searchIndex as unknown as AgenstraSearchIndexService,
    );
  });

  describe('create', () => {
    it('creates a GitHub App connection by default and never returns secrets', async () => {
      const summary = await service.create(
        { label: ' GH ', provider: 'github', appId: '1', installationId: '2', privateKey: pem },
        'user-1',
      );
      const saved = repo.save.mock.calls[0][0] as DeploymentConnectionEntity;

      expect(saved.authType).toBe('app');
      expect(JSON.parse(saved.credentials)).toEqual({ privateKey: pem.trim() });
      expect(saved.createdByUserId).toBe('user-1');
      expect(summary).toMatchObject({ label: 'GH', authType: 'app', appId: '1', installationId: '2' });
      expect(JSON.stringify(summary)).not.toContain('PRIVATE KEY');
      expect(searchIndex.upsertSafe).toHaveBeenCalledWith(
        'deployment-connections',
        expect.objectContaining({ instanceScoped: true }),
      );
      expect(JSON.stringify(searchIndex.upsertSafe.mock.calls[0][1])).not.toContain('PRIVATE KEY');
    });

    it('validates required fields per auth type and provider', async () => {
      await expect(
        service.create({ label: 'x', provider: 'github', appId: '1', installationId: '2' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(
        service.create({ label: 'x', provider: 'github', appId: '1', installationId: '2', privateKey: 'garbage' }),
      ).rejects.toBeInstanceOf(BadRequestException);
      await expect(service.create({ label: 'x', provider: 'gitlab', authType: 'app', token: 't' })).rejects.toThrow(
        /not supported/,
      );
      await expect(service.create({ label: 'x', provider: 'gitlab' })).rejects.toThrow(/token/);
      await expect(service.create({ label: 'x', provider: 'jenkins', username: 'u', token: 't' })).rejects.toThrow(
        /base URL/,
      );
      await expect(
        service.create({ label: 'x', provider: 'jenkins', baseUrl: 'https://ci', token: 't' }),
      ).rejects.toThrow(/username/);
      await expect(
        service.create({ label: 'x', provider: 'gitlab', token: 't', baseUrl: 'https://u:p@gitlab.local' }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });

    it('creates Jenkins token connections with a normalized base URL', async () => {
      const summary = await service.create({
        label: 'CI',
        provider: 'jenkins',
        baseUrl: 'https://ci.example.com/',
        username: 'bot',
        token: 'secret',
      });

      expect(summary).toMatchObject({ baseUrl: 'https://ci.example.com', authType: 'token', username: 'bot' });
    });

    it('validates allowed workspaces', async () => {
      clientsRepo.count.mockResolvedValueOnce(1);

      await expect(
        service.create({
          label: 'x',
          provider: 'gitlab',
          token: 't',
          workspaceAccess: 'selected',
          allowedClientIds: [CLIENT_A, CLIENT_B],
        }),
      ).rejects.toThrow(/unknown workspaces/);
      await expect(
        service.create({ label: 'x', provider: 'gitlab', token: 't', workspaceAccess: 'selected' }),
      ).rejects.toThrow(/at least one workspace/);
    });
  });

  describe('update', () => {
    it('keeps stored secrets when omitted and resets the test status on credential changes', async () => {
      repo.findOne.mockResolvedValue(entity({ lastTestStatus: 'ok' }));

      await service.update('id', { label: 'Renamed' });
      expect(repo.save.mock.calls[0][0]).toMatchObject({
        label: 'Renamed',
        credentials: JSON.stringify({ token: 'ghp_storedtokenvalue' }),
        lastTestStatus: 'ok',
      });

      repo.findOne.mockResolvedValue(entity({ lastTestStatus: 'ok' }));
      await service.update('id', { token: 'ghp_newtoken' });
      expect(repo.save.mock.calls[1][0]).toMatchObject({
        credentials: JSON.stringify({ token: 'ghp_newtoken' }),
        lastTestStatus: 'untested',
      });
    });

    it('requires the new secrets when switching auth type', async () => {
      repo.findOne.mockResolvedValue(entity());

      await expect(service.update('id', { authType: 'app', appId: '1', installationId: '2' })).rejects.toThrow(
        /privateKey/,
      );

      repo.findOne.mockResolvedValue(
        entity({ authType: 'app', appId: '1', installationId: '2', credentials: JSON.stringify({ privateKey: pem }) }),
      );
      await expect(service.update('id', { authType: 'token' })).rejects.toThrow(/token/);
    });

    it('rejects provider changes and clearing a Jenkins base URL', async () => {
      repo.findOne.mockResolvedValue(entity());
      await expect(service.update('id', { provider: 'gitlab' } as never)).rejects.toThrow(/Provider cannot be changed/);

      repo.findOne.mockResolvedValue(entity({ provider: 'jenkins', baseUrl: 'https://ci', username: 'u' }));
      await expect(service.update('id', { baseUrl: null })).rejects.toThrow(/base URL/);
    });

    it('404s for unknown connections', async () => {
      repo.findOne.mockResolvedValue(null);
      await expect(service.update('id', {})).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('delete', () => {
    it('409s when workflows reference the connection', async () => {
      repo.findOne.mockResolvedValue(entity());
      workflowsRepo.count.mockResolvedValue(3);

      await expect(service.delete('id')).rejects.toThrow(
        new ConflictException('Connection is used by 3 deployment workflows'),
      );
      expect(repo.delete).not.toHaveBeenCalled();
    });

    it('deletes and removes the search document', async () => {
      repo.findOne.mockResolvedValue(entity());

      await service.delete('id');
      expect(repo.delete).toHaveBeenCalledWith('id');
      expect(searchIndex.deleteSafe).toHaveBeenCalledWith('deployment-connections', 'id');
    });
  });

  describe('test', () => {
    it('persists the result with a sanitized message', async () => {
      repo.findOne.mockResolvedValue(entity());
      adapter.testConnection.mockResolvedValue({ ok: false, message: 'denied for ghp_storedtokenvalue' });

      const res = await service.test('id');

      expect(res.ok).toBe(false);
      expect(res.message).not.toContain('ghp_storedtokenvalue');
      expect(repo.update).toHaveBeenCalledWith(
        { id: entity().id },
        expect.objectContaining({ lastTestStatus: 'failed', lastTestedAt: expect.any(Date) }),
      );
    });

    it('treats thrown provider errors as failed tests', async () => {
      repo.findOne.mockResolvedValue(entity());
      adapter.testConnection.mockRejectedValue(new Error('boom'));

      await expect(service.test('id')).resolves.toMatchObject({ ok: false, message: 'Connection test failed' });
    });
  });

  describe('workspace access', () => {
    it('resolves provider connections with decrypted secrets', () => {
      const { provider, connection } = service.providerFor(entity({ baseUrl: 'https://ghe/api/v3' }));

      expect(provider).toBe(adapter);
      expect(connection).toEqual({
        id: entity().id,
        provider: 'github',
        baseUrl: 'https://ghe/api/v3',
        authType: 'token',
        appId: null,
        installationId: null,
        username: null,
        secrets: { token: 'ghp_storedtokenvalue' },
      });
    });

    it('enforces workspace access', async () => {
      const selected = entity({ workspaceAccess: 'selected', allowedClientIds: [CLIENT_A] });

      expect(() => service.assertUsableByClient(selected, CLIENT_A)).not.toThrow();
      expect(() => service.assertUsableByClient(selected, CLIENT_B)).toThrow(ForbiddenException);
      expect(() => service.assertUsableByClient(entity(), CLIENT_B)).not.toThrow();

      repo.findOne.mockResolvedValue(selected);
      await expect(service.findUsableOrThrow(CLIENT_B, 'id')).rejects.toBeInstanceOf(ForbiddenException);
      await expect(service.findUsableOrThrow(CLIENT_A, 'id')).resolves.toBe(selected);
      repo.findOne.mockResolvedValue(null);
      await expect(service.findUsableOrThrow(CLIENT_A, 'id')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('lists connection options for a workspace', async () => {
      qb.getMany.mockResolvedValue([
        entity(),
        entity({ id: 'x', workspaceAccess: 'selected', allowedClientIds: [CLIENT_B] }),
      ]);

      await expect(service.listOptionsForClient(CLIENT_A)).resolves.toEqual([
        { id: entity().id, label: 'GH', provider: 'github', lastTestStatus: 'untested' },
      ]);
      expect(qb.where).toHaveBeenCalledWith(expect.stringContaining('allowed_client_ids'), {
        clientIds: JSON.stringify([CLIENT_A]),
      });
    });
  });

  describe('findAll', () => {
    it('falls back to ILIKE search and filters by provider', async () => {
      await service.findAll(10, 0, 'prod', 'gitlab');

      expect(qb.andWhere).toHaveBeenCalledWith('c.provider = :provider', { provider: 'gitlab' });
      expect(qb.andWhere).toHaveBeenCalledWith(expect.stringContaining('ILIKE'), expect.anything());
    });

    it('lists without search and rejects unknown providers', async () => {
      repo.find.mockResolvedValue([entity()]);

      await expect(service.findAll()).resolves.toHaveLength(1);
      await expect(service.findAll(10, 0, undefined, 'svn')).rejects.toBeInstanceOf(BadRequestException);
    });

    it('uses OpenSearch when enabled', async () => {
      searchIndex.isEnabled.mockReturnValue(true);
      searchIndex.searchIds.mockResolvedValue({ ids: [entity().id], total: 1 });
      repo.findBy.mockResolvedValue([entity()]);

      await expect(service.findAll(10, 0, 'gh')).resolves.toHaveLength(1);
      expect(searchIndex.searchIds).toHaveBeenCalledWith(
        expect.objectContaining({ entityType: 'deployment-connections', instanceScoped: true }),
      );
    });
  });
});
