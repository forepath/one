import { Test, TestingModule } from '@nestjs/testing';

import { OpenClawAgentProvider } from './openclaw-agent.provider';

describe('OpenClawAgentProvider', () => {
  let provider: OpenClawAgentProvider;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [OpenClawAgentProvider],
    }).compile();

    provider = module.get<OpenClawAgentProvider>(OpenClawAgentProvider);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.OPENCLAW_AGENT_DOCKER_IMAGE;
    delete process.env.OPENCODE_AGENT_VIRTUAL_WORKSPACE_DOCKER_IMAGE;
    delete process.env.OPENCODE_AGENT_SSH_CONNECTION_DOCKER_IMAGE;
  });

  describe('getType', () => {
    it('should return "openclaw"', () => {
      expect(provider.getType()).toBe('openclaw');
    });
  });

  describe('getDisplayName', () => {
    it('should return "OpenClaw"', () => {
      expect(provider.getDisplayName()).toBe('OpenClaw');
    });
  });

  describe('getCapabilities', () => {
    it('should report no chat capabilities', () => {
      expect(provider.getCapabilities()).toEqual({
        supportsChat: false,
        supportsStreaming: false,
        supportsToolEvents: false,
        supportsQuestions: false,
      });
    });
  });

  describe('getBasePath', () => {
    it('should return "/openclaw"', () => {
      expect(provider.getBasePath()).toBe('/openclaw');
    });
  });

  describe('getRepositoryPath', () => {
    it('should return "/workspace"', () => {
      expect(provider.getRepositoryPath()).toBe('/workspace');
    });
  });

  describe('getEnvironmentVariables', () => {
    it('should return object with OPENCLAW_GATEWAY_TOKEN', () => {
      const envVars = provider.getEnvironmentVariables();

      expect(envVars).toHaveProperty('OPENCLAW_GATEWAY_TOKEN');
      expect(typeof envVars.OPENCLAW_GATEWAY_TOKEN).toBe('string');
      expect(envVars.OPENCLAW_GATEWAY_TOKEN.length).toBe(32);
    });

    it('should generate different tokens on subsequent calls', () => {
      const first = provider.getEnvironmentVariables().OPENCLAW_GATEWAY_TOKEN;
      const second = provider.getEnvironmentVariables().OPENCLAW_GATEWAY_TOKEN;

      expect(first).not.toBe(second);
    });
  });

  describe('getDockerImage', () => {
    it('should return default image when OPENCLAW_AGENT_DOCKER_IMAGE is not set', () => {
      delete process.env.OPENCLAW_AGENT_DOCKER_IMAGE;

      const image = provider.getDockerImage();

      expect(image).toBe('ghcr.io/forepath/agenstra-manager-agi:latest');
    });

    it('should return custom image from OPENCLAW_AGENT_DOCKER_IMAGE environment variable', () => {
      process.env.OPENCLAW_AGENT_DOCKER_IMAGE = 'custom-registry/openclaw-agent:v1.0.0';

      const image = provider.getDockerImage();

      expect(image).toBe('custom-registry/openclaw-agent:v1.0.0');
    });
  });

  describe('getVirtualWorkspaceDockerImage', () => {
    it('should return default image when OPENCODE_AGENT_VIRTUAL_WORKSPACE_DOCKER_IMAGE is not set', () => {
      delete process.env.OPENCODE_AGENT_VIRTUAL_WORKSPACE_DOCKER_IMAGE;

      const image = provider.getVirtualWorkspaceDockerImage();

      expect(image).toBe('ghcr.io/forepath/agenstra-manager-vnc:latest');
    });

    it('should return custom image from OPENCODE_AGENT_VIRTUAL_WORKSPACE_DOCKER_IMAGE environment variable', () => {
      process.env.OPENCODE_AGENT_VIRTUAL_WORKSPACE_DOCKER_IMAGE = 'custom-registry/custom-vnc:v1.0.0';

      const image = provider.getVirtualWorkspaceDockerImage();

      expect(image).toBe('custom-registry/custom-vnc:v1.0.0');
    });
  });

  describe('getSshConnectionDockerImage', () => {
    it('should return default image when OPENCODE_AGENT_SSH_CONNECTION_DOCKER_IMAGE is not set', () => {
      delete process.env.OPENCODE_AGENT_SSH_CONNECTION_DOCKER_IMAGE;

      const image = provider.getSshConnectionDockerImage();

      expect(image).toBe('ghcr.io/forepath/agenstra-manager-ssh:latest');
    });

    it('should return custom image from OPENCODE_AGENT_SSH_CONNECTION_DOCKER_IMAGE environment variable', () => {
      process.env.OPENCODE_AGENT_SSH_CONNECTION_DOCKER_IMAGE = 'custom-registry/custom-ssh:v1.0.0';

      const image = provider.getSshConnectionDockerImage();

      expect(image).toBe('custom-registry/custom-ssh:v1.0.0');
    });
  });

  describe('getModelsListCommand', () => {
    it('should throw not implemented error', () => {
      expect(() => provider.getModelsListCommand()).toThrow('Not implemented');
    });
  });

  describe('sendMessage', () => {
    it('should throw not implemented error', async () => {
      await expect(provider.sendMessage('agent-id', 'container-id', 'message')).rejects.toThrow('Not implemented');
    });
  });

  describe('sendInitialization', () => {
    it('should throw not implemented error', async () => {
      await expect(provider.sendInitialization('agent-id', 'container-id')).rejects.toThrow('Not implemented');
    });
  });

  describe('toParseableStrings', () => {
    it('should throw not implemented error', () => {
      expect(() => provider.toParseableStrings('response')).toThrow('Not implemented');
    });
  });

  describe('toUnifiedResponse', () => {
    it('should throw not implemented error', () => {
      expect(() => provider.toUnifiedResponse('response')).toThrow('Not implemented');
    });
  });
});
