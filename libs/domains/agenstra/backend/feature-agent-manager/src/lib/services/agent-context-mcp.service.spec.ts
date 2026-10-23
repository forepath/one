import { OpenCodeClientFactory } from '../providers/opencode/opencode-client.factory';
import { AgentsRepository } from '../repositories/agents.repository';
import { deriveAgentContextToken } from '../utils/agent-context-token.utils';

import { AGENT_CONTEXT_MCP_IMAGE_LABEL, AgentContextMcpService } from './agent-context-mcp.service';
import type { AgentRuntime } from '../runtime/agent-runtime';

describe('AgentContextMcpService', () => {
  const originalEnv = process.env;
  const agent = { id: '11111111-1111-4111-8111-111111111111', hashedPassword: 'hash' };
  let agentsRepository: { findById: jest.Mock };
  let dockerService: { inspectContainerSummary: jest.Mock };
  let clientFactory: { resolveConnection: jest.Mock };
  let fetchMock: jest.Mock;
  let service: AgentContextMcpService;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      AGENT_CONTEXT_MCP_MANAGER_URL: 'http://agent-manager-api:3000/api/',
      AGENT_CONTEXT_TOKEN_SECRET: 'secret',
    };
    delete process.env['AGENT_CONTEXT_MCP_ENABLED'];
    agentsRepository = { findById: jest.fn().mockResolvedValue(agent) };
    dockerService = {
      inspectContainerSummary: jest.fn().mockResolvedValue({ labels: { [AGENT_CONTEXT_MCP_IMAGE_LABEL]: '1' } }),
    };
    clientFactory = {
      resolveConnection: jest.fn().mockResolvedValue({ baseUrl: 'http://worker:4096/', authorization: 'Basic x' }),
    };
    fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    service = new AgentContextMcpService(
      agentsRepository as unknown as AgentsRepository,
      dockerService as unknown as AgentRuntime,
      clientFactory as unknown as OpenCodeClientFactory,
    );
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('configuration', () => {
    it('normalizes the manager URL and requires a token secret', () => {
      expect(service.managerApiUrl()).toBe('http://agent-manager-api:3000/api');
      expect(service.isConfigured()).toBe(true);

      delete process.env['AGENT_CONTEXT_TOKEN_SECRET'];
      delete process.env['ENCRYPTION_KEY'];
      expect(service.isConfigured()).toBe(false);
    });

    it('can be disabled explicitly or by an invalid URL', () => {
      process.env['AGENT_CONTEXT_MCP_ENABLED'] = 'false';
      expect(service.managerApiUrl()).toBeNull();

      delete process.env['AGENT_CONTEXT_MCP_ENABLED'];
      process.env['AGENT_CONTEXT_MCP_MANAGER_URL'] = 'not a url';
      expect(service.managerApiUrl()).toBeNull();

      process.env['AGENT_CONTEXT_MCP_MANAGER_URL'] = 'file:///etc/passwd';
      expect(service.managerApiUrl()).toBeNull();
    });
  });

  describe('tokens', () => {
    it('verifies the derived per-agent token', async () => {
      const token = deriveAgentContextToken('secret', agent.id, 'hash');

      await expect(service.verifyAgentToken(agent.id, token)).resolves.toBe(true);
      await expect(service.verifyAgentToken(agent.id, `${token}x`)).resolves.toBe(false);
      await expect(service.verifyAgentToken(agent.id, '')).resolves.toBe(false);
    });

    it('rejects unknown agents and disabled configurations', async () => {
      agentsRepository.findById.mockResolvedValueOnce(null);
      await expect(service.verifyAgentToken(agent.id, 'anything')).resolves.toBe(false);

      process.env['AGENT_CONTEXT_MCP_ENABLED'] = 'false';
      await expect(
        service.verifyAgentToken(agent.id, deriveAgentContextToken('secret', agent.id, 'hash')),
      ).resolves.toBe(false);
    });
  });

  describe('buildWireOptions', () => {
    it('returns MCP environment for workers carrying the context MCP label', async () => {
      await expect(service.buildWireOptions(agent.id, 'container-1')).resolves.toEqual({
        apiUrl: 'http://agent-manager-api:3000/api',
        agentId: agent.id,
        agentToken: deriveAgentContextToken('secret', agent.id, 'hash'),
      });
    });

    it('skips older worker images and disabled configurations', async () => {
      dockerService.inspectContainerSummary.mockResolvedValueOnce({ labels: {} });
      await expect(service.buildWireOptions(agent.id, 'container-1')).resolves.toBeNull();

      dockerService.inspectContainerSummary.mockRejectedValueOnce(new Error('gone'));
      await expect(service.buildWireOptions(agent.id, 'container-1')).resolves.toBeNull();

      delete process.env['AGENT_CONTEXT_MCP_MANAGER_URL'];
      await expect(service.buildWireOptions(agent.id, 'container-1')).resolves.toBeNull();
    });
  });

  describe('isAvailable', () => {
    const statusResponse = (status: string) => ({
      ok: true,
      json: jest.fn().mockResolvedValue({ agenstra: { status } }),
    });

    it('is true only when OpenCode reports the platform server connected, and caches the probe', async () => {
      fetchMock.mockResolvedValue(statusResponse('connected'));

      await expect(service.isAvailable(agent.id, 'container-1')).resolves.toBe(true);
      await expect(service.isAvailable(agent.id, 'container-1')).resolves.toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith(
        'http://worker:4096/mcp',
        expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Basic x' }) }),
      );
    });

    it('falls back when the server failed, the probe errors, or after invalidation', async () => {
      fetchMock.mockResolvedValueOnce(statusResponse('failed'));
      await expect(service.isAvailable(agent.id, 'container-1')).resolves.toBe(false);

      service.invalidate(agent.id);
      fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
      await expect(service.isAvailable(agent.id, 'container-1')).resolves.toBe(false);

      service.invalidate(agent.id);
      fetchMock.mockResolvedValueOnce({ ok: false, json: jest.fn() });
      await expect(service.isAvailable(agent.id, 'container-1')).resolves.toBe(false);
    });

    it('never probes when not configured', async () => {
      delete process.env['AGENT_CONTEXT_MCP_MANAGER_URL'];

      await expect(service.isAvailable(agent.id, 'container-1')).resolves.toBe(false);
      expect(fetchMock).not.toHaveBeenCalled();
    });
  });
});
