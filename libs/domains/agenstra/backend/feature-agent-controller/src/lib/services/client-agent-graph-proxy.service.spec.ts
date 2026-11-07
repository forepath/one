import { AGENT_GRAPH_LIMITS } from '@forepath/agenstra/shared/util-opencode-config';
import { AuthenticationType, ClientEntity } from '@forepath/identity/backend';
import { BadRequestException, NotFoundException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import axios from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';

import { ClientAgentGraphProxyService } from './client-agent-graph-proxy.service';
import { ClientsService } from './clients.service';

jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

describe('ClientAgentGraphProxyService', () => {
  let service: ClientAgentGraphProxyService;
  const clientId = '11111111-1111-4111-8111-111111111111';
  const agentId = '22222222-2222-4222-8222-222222222222';
  const clientEntity: ClientEntity = {
    id: clientId,
    name: 'Workspace',
    description: 'Test',
    endpoint: 'https://example.com/',
    authenticationType: AuthenticationType.API_KEY,
    apiKey: 'test-api-key',
    createdAt: new Date('2024-01-01'),
    updatedAt: new Date('2024-01-01'),
  };
  const mockClientsService = { getAccessToken: jest.fn() };
  const mockClientsRepository = { findByIdOrThrow: jest.fn() };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        ClientAgentGraphProxyService,
        { provide: ClientsService, useValue: mockClientsService },
        { provide: ClientsRepository, useValue: mockClientsRepository },
      ],
    }).compile();

    service = module.get(ClientAgentGraphProxyService);
    jest.clearAllMocks();
    mockClientsRepository.findByIdOrThrow.mockResolvedValue(clientEntity);
    mockedAxios.request.mockResolvedValue({ status: 200, data: { ok: true } } as never);
  });

  const lastRequest = () => mockedAxios.request.mock.calls[mockedAxios.request.mock.calls.length - 1][0];

  describe('URL building and authentication', () => {
    it('builds the agent graph status URL and sends the API key', async () => {
      await service.getStatus(clientId, agentId);

      expect(lastRequest()).toEqual(
        expect.objectContaining({
          method: 'GET',
          url: `https://example.com/api/agents/${agentId}/graph/status`,
        }),
      );
      expect((lastRequest().headers as Record<string, string>)['Authorization']).toBe('Bearer test-api-key');
    });

    it('URL-encodes the agent id path segment', async () => {
      await service.getOverview(clientId, 'a/b');

      expect(lastRequest().url).toBe('https://example.com/api/agents/a%2Fb/graph/overview');
    });

    it('targets the document route without suffix', async () => {
      await service.getDocument(clientId, agentId, {});

      expect(lastRequest().url).toBe(`https://example.com/api/agents/${agentId}/graph`);
      expect(lastRequest().params).toEqual({});
    });

    it('uses the OIDC access token for OIDC clients', async () => {
      mockClientsRepository.findByIdOrThrow.mockResolvedValue({
        ...clientEntity,
        authenticationType: AuthenticationType.OIDC,
        apiKey: undefined,
      });
      mockClientsService.getAccessToken.mockResolvedValue('oidc-token');

      await service.getDigest(clientId, agentId);

      expect(lastRequest().url).toBe(`https://example.com/api/agents/${agentId}/graph/digest`);
      expect((lastRequest().headers as Record<string, string>)['Authorization']).toBe('Bearer oidc-token');
    });

    it('rejects API key clients without a key', async () => {
      mockClientsRepository.findByIdOrThrow.mockResolvedValue({ ...clientEntity, apiKey: undefined });

      await expect(service.getStatus(clientId, agentId)).rejects.toThrow(BadRequestException);
      expect(mockedAxios.request).not.toHaveBeenCalled();
    });

    it('posts refresh and compose requests', async () => {
      await service.refresh(clientId, agentId);
      expect(lastRequest()).toEqual(
        expect.objectContaining({ method: 'POST', url: `https://example.com/api/agents/${agentId}/graph/refresh` }),
      );

      await service.compose(clientId, {
        environmentIds: [agentId, agentId],
        layer: 'paths',
        limit: 999_999,
        names: { [agentId]: 'Env' },
      });
      expect(lastRequest()).toEqual(
        expect.objectContaining({
          method: 'POST',
          url: 'https://example.com/api/graphs/compose',
          data: {
            environmentIds: [agentId],
            layer: 'paths',
            limit: AGENT_GRAPH_LIMITS.maxDocumentNodes,
            names: { [agentId]: 'Env' },
          },
        }),
      );
    });
  });

  describe('error mapping', () => {
    it('maps 404 to NotFoundException', async () => {
      mockedAxios.request.mockResolvedValue({ status: 404, data: { message: 'Agent not found' } } as never);

      await expect(service.getStatus(clientId, agentId)).rejects.toThrow(NotFoundException);
    });

    it('maps 400 to BadRequestException', async () => {
      mockedAxios.request.mockResolvedValue({ status: 400, data: { message: 'Invalid' } } as never);

      await expect(service.getStatus(clientId, agentId)).rejects.toThrow(BadRequestException);
    });

    it('maps other 4xx to BadRequestException', async () => {
      mockedAxios.request.mockResolvedValue({ status: 403, data: { message: 'Forbidden' } } as never);

      await expect(service.getStatus(clientId, agentId)).rejects.toThrow('Request failed: Forbidden');
    });

    it('maps connection failures to BadRequestException', async () => {
      mockedAxios.request.mockRejectedValue({ request: {}, message: 'ECONNREFUSED' });

      await expect(service.getStatus(clientId, agentId)).rejects.toThrow(
        'Failed to connect to client endpoint: ECONNREFUSED',
      );
    });
  });

  describe('parameter whitelisting', () => {
    it('clamps document limits and filters node types', async () => {
      await service.getDocument(clientId, agentId, {
        layer: 'paths',
        limit: '999999',
        types: 'file,bogus,module,file',
        extra: 'dropped',
      });

      expect(lastRequest().params).toEqual({
        layer: 'paths',
        limit: AGENT_GRAPH_LIMITS.maxDocumentNodes,
        types: 'file,module',
      });
    });

    it('rejects unknown layers before calling the manager', async () => {
      await expect(service.getDocument(clientId, agentId, { layer: 'secrets' })).rejects.toThrow(BadRequestException);
      expect(mockedAxios.request).not.toHaveBeenCalled();
    });

    it('caps the search query length and the result limit', async () => {
      await service.search(clientId, agentId, { query: `  ${'x'.repeat(1000)}  `, limit: '0' });

      expect(lastRequest().url).toBe(`https://example.com/api/agents/${agentId}/graph/search`);
      expect(lastRequest().params).toEqual({ query: 'x'.repeat(AGENT_GRAPH_LIMITS.queryMaxLength), limit: 1 });
    });

    it('requires a search query', async () => {
      await expect(service.search(clientId, agentId, { query: '   ' })).rejects.toThrow(BadRequestException);
    });

    it('validates node ids', async () => {
      await expect(service.getNode(clientId, agentId, {})).rejects.toThrow(BadRequestException);
      await expect(
        service.getNode(clientId, agentId, { id: 'x'.repeat(AGENT_GRAPH_LIMITS.idMaxLength + 1) }),
      ).rejects.toThrow(BadRequestException);
      await expect(service.getNode(clientId, agentId, { id: 'file:a\u0000b' })).rejects.toThrow(BadRequestException);

      await service.getNode(clientId, agentId, { id: 'symbol:src/a.ts#Foo', layer: 'code' });
      expect(lastRequest().url).toBe(`https://example.com/api/agents/${agentId}/graph/nodes`);
      expect(lastRequest().params).toEqual({ id: 'symbol:src/a.ts#Foo', layer: 'code' });
    });

    it('clamps neighbor depth and limit', async () => {
      await service.getNeighbors(clientId, agentId, { id: 'file:a', depth: '99', limit: '100000' });

      expect(lastRequest().params).toEqual({
        id: 'file:a',
        depth: AGENT_GRAPH_LIMITS.maxNeighborDepth,
        limit: AGENT_GRAPH_LIMITS.maxNeighborNodes,
      });
    });

    it('passes path endpoints as query params', async () => {
      await service.getPath(clientId, agentId, { from: 'file:a', to: 'file:b' });

      expect(lastRequest().url).toBe(`https://example.com/api/agents/${agentId}/graph/path`);
      expect(lastRequest().params).toEqual({ from: 'file:a', to: 'file:b' });
      await expect(service.getPath(clientId, agentId, { from: 'file:a' })).rejects.toThrow(BadRequestException);
    });

    it('requires a file path', async () => {
      await service.getFile(clientId, agentId, { path: 'src/a.ts' });
      expect(lastRequest().params).toEqual({ path: 'src/a.ts' });
      await expect(service.getFile(clientId, agentId, {})).rejects.toThrow(BadRequestException);
    });

    it('defaults the reference prompt limit', async () => {
      await service.getReferences(clientId, agentId, {});
      expect(lastRequest().params).toEqual({ limit: 50 });

      await service.getReferences(clientId, agentId, { promptId: 'p-1', limit: '100000' });
      expect(lastRequest().params).toEqual({ promptId: 'p-1', limit: AGENT_GRAPH_LIMITS.maxPromptRecords });
    });
  });
});
