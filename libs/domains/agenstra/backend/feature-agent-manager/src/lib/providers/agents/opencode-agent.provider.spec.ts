import { Test, TestingModule } from '@nestjs/testing';

import { DockerService } from '../../services/docker.service';

import { OpenCodeAgentProvider } from './opencode-agent.provider';

describe('OpenCodeAgentProvider', () => {
  let provider: OpenCodeAgentProvider;
  let dockerService: jest.Mocked<DockerService>;
  const mockDockerService = {
    sendCommandToContainer: jest.fn(),
    execCommandStream: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenCodeAgentProvider,
        {
          provide: DockerService,
          useValue: mockDockerService,
        },
      ],
    }).compile();

    provider = module.get<OpenCodeAgentProvider>(OpenCodeAgentProvider);
    dockerService = module.get(DockerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.OPENCODE_AGENT_DOCKER_IMAGE;
    delete process.env.OPENCODE_AGENT_VIRTUAL_WORKSPACE_DOCKER_IMAGE;
    delete process.env.OPENCODE_AGENT_SSH_CONNECTION_DOCKER_IMAGE;
  });

  describe('getType', () => {
    it('should return "opencode"', () => {
      expect(provider.getType()).toBe('opencode');
    });
  });

  describe('getDisplayName', () => {
    it('should return "OpenCode"', () => {
      expect(provider.getDisplayName()).toBe('OpenCode');
    });
  });

  describe('getCapabilities', () => {
    it('should report chat and streaming capabilities', () => {
      expect(provider.getCapabilities()).toEqual({
        supportsChat: true,
        supportsStreaming: true,
        supportsToolEvents: true,
        supportsQuestions: true,
      });
    });
  });

  describe('getBasePath', () => {
    it('should return "/app"', () => {
      expect(provider.getBasePath()).toBe('/app');
    });
  });

  describe('getConfigBasePath', () => {
    it('should return "~/.config/opencode"', () => {
      expect(provider.getConfigBasePath()).toBe('~/.config/opencode');
    });
  });

  describe('getDockerImage', () => {
    it('should return default image when OPENCODE_AGENT_DOCKER_IMAGE is not set', () => {
      delete process.env.OPENCODE_AGENT_DOCKER_IMAGE;

      const image = provider.getDockerImage();

      expect(image).toBe('ghcr.io/forepath/agenstra-manager-worker:latest');
    });

    it('should return custom image from OPENCODE_AGENT_DOCKER_IMAGE environment variable', () => {
      process.env.OPENCODE_AGENT_DOCKER_IMAGE = 'custom-registry/custom-image:v1.0.0';

      const image = provider.getDockerImage();

      expect(image).toBe('custom-registry/custom-image:v1.0.0');
    });
  });

  describe('getModelsListCommand', () => {
    it('should return "opencode models"', () => {
      expect(provider.getModelsListCommand()).toBe('opencode models');
    });
  });

  describe('toModelsList', () => {
    it('should map each non-empty line to id and name equal to that line', () => {
      const raw = `openrouter/z-ai/glm-5
openrouter/z-ai/glm-5-turbo
openrouter/z-ai/glm-5.1`;

      expect(provider.toModelsList(raw)).toEqual({
        'openrouter/z-ai/glm-5': 'openrouter/z-ai/glm-5',
        'openrouter/z-ai/glm-5-turbo': 'openrouter/z-ai/glm-5-turbo',
        'openrouter/z-ai/glm-5.1': 'openrouter/z-ai/glm-5.1',
      });
    });

    it('should drop empty lines and trim whitespace', () => {
      const raw = `  model-a

model-b
`;

      expect(provider.toModelsList(raw)).toEqual({
        'model-a': 'model-a',
        'model-b': 'model-b',
      });
    });

    it('should handle CRLF line endings', () => {
      expect(provider.toModelsList('one\r\ntwo')).toEqual({
        one: 'one',
        two: 'two',
      });
    });

    it('should return empty object for empty or whitespace-only input', () => {
      expect(provider.toModelsList('')).toEqual({});
      expect(provider.toModelsList('   \n  \t  ')).toEqual({});
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

  describe('sendMessage', () => {
    const agentId = 'test-agent-id';
    const containerId = 'test-container-id';
    const message = 'Hello, agent!';

    it('should send message to container without model option', async () => {
      const expectedResponse = 'Hello from agent!';

      dockerService.sendCommandToContainer.mockResolvedValue(expectedResponse);

      const response = await provider.sendMessage(agentId, containerId, message);

      expect(response).toBe(expectedResponse);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        containerId,
        'opencode run --format json --continue',
        message,
      );
    });

    it('should send message to container with model option', async () => {
      const expectedResponse = 'Hello from agent!';
      const model = 'gpt-4';

      dockerService.sendCommandToContainer.mockResolvedValue(expectedResponse);

      const response = await provider.sendMessage(agentId, containerId, message, { model });

      expect(response).toBe(expectedResponse);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        containerId,
        `opencode run --format json --continue --model ${model}`,
        message,
      );
    });

    it('should send message without continue flag when continue is false', async () => {
      const expectedResponse = 'Hello from agent!';

      dockerService.sendCommandToContainer.mockResolvedValue(expectedResponse);

      const response = await provider.sendMessage(agentId, containerId, message, { continue: false });

      expect(response).toBe(expectedResponse);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        containerId,
        'opencode run --format json',
        message,
      );
    });

    it('should retry without continue flag when Session not found error occurs', async () => {
      const sessionNotFoundResponse = 'Session not found';
      const expectedResponse = 'Hello from agent!';

      dockerService.sendCommandToContainer
        .mockResolvedValueOnce(sessionNotFoundResponse)
        .mockResolvedValueOnce(expectedResponse);

      const response = await provider.sendMessage(agentId, containerId, message);

      expect(response).toBe(expectedResponse);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(2);
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        1,
        containerId,
        'opencode run --format json --continue',
        message,
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        2,
        containerId,
        'opencode run --format json',
        message,
      );
    });

    it('should retry without continue flag and preserve model option when Session not found error occurs', async () => {
      const sessionNotFoundResponse = 'Session not found';
      const expectedResponse = 'Hello from agent!';
      const model = 'gpt-4';

      dockerService.sendCommandToContainer
        .mockResolvedValueOnce(sessionNotFoundResponse)
        .mockResolvedValueOnce(expectedResponse);

      const response = await provider.sendMessage(agentId, containerId, message, { model });

      expect(response).toBe(expectedResponse);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledTimes(2);
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        1,
        containerId,
        `opencode run --format json --continue --model ${model}`,
        message,
      );
      expect(dockerService.sendCommandToContainer).toHaveBeenNthCalledWith(
        2,
        containerId,
        `opencode run --format json --model ${model}`,
        message,
      );
    });

    it('should handle errors from docker service', async () => {
      const error = new Error('Container not found');

      dockerService.sendCommandToContainer.mockRejectedValue(error);

      await expect(provider.sendMessage(agentId, containerId, message)).rejects.toThrow('Container not found');
    });
  });

  describe('sendMessageStream', () => {
    const agentId = 'test-agent-id';
    const containerId = 'test-container-id';
    const message = 'Hello, agent!';

    it('should yield stdout chunks from execCommandStream', async () => {
      async function* mockStream(): AsyncGenerator<{ stream: 'stdout' | 'stderr'; chunk: string }> {
        yield { stream: 'stdout', chunk: '{"type":"text",' };
        yield { stream: 'stdout', chunk: '"part":{"type":"text","text":"Hi"}}\n' };
      }

      dockerService.execCommandStream.mockImplementation(mockStream);

      const chunks: string[] = [];

      for await (const chunk of provider.sendMessageStream(agentId, containerId, message)) {
        chunks.push(chunk);
      }

      expect(chunks.join('')).toBe('{"type":"text","part":{"type":"text","text":"Hi"}}\n');
      expect(dockerService.execCommandStream).toHaveBeenCalledWith(
        containerId,
        'opencode run --format json --continue',
        message,
      );
    });

    it('should retry without continue when output contains Session not found', async () => {
      let call = 0;

      async function* firstSessionMissing(): AsyncGenerator<{ stream: 'stdout' | 'stderr'; chunk: string }> {
        yield { stream: 'stdout', chunk: 'Session not found\n' };
      }

      async function* secondOk(): AsyncGenerator<{ stream: 'stdout' | 'stderr'; chunk: string }> {
        yield { stream: 'stdout', chunk: '{"ok":true}\n' };
      }

      dockerService.execCommandStream.mockImplementation(async function* () {
        call += 1;

        if (call === 1) {
          yield* firstSessionMissing();
        } else {
          yield* secondOk();
        }
      });

      const chunks: string[] = [];

      for await (const chunk of provider.sendMessageStream(agentId, containerId, message)) {
        chunks.push(chunk);
      }

      expect(chunks).toEqual(['Session not found\n', '{"ok":true}\n']);
      expect(dockerService.execCommandStream).toHaveBeenNthCalledWith(
        1,
        containerId,
        'opencode run --format json --continue',
        message,
      );
      expect(dockerService.execCommandStream).toHaveBeenNthCalledWith(
        2,
        containerId,
        'opencode run --format json',
        message,
      );
    });
  });

  describe('sendInitialization', () => {
    const agentId = 'test-agent-id';
    const containerId = 'test-container-id';

    it('should return immediately without sending any command', async () => {
      await provider.sendInitialization(agentId, containerId);

      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should return immediately even with model option', async () => {
      const model = 'gpt-4';

      await provider.sendInitialization(agentId, containerId, { model });

      expect(dockerService.sendCommandToContainer).not.toHaveBeenCalled();
    });

    it('should not throw errors', async () => {
      await expect(provider.sendInitialization(agentId, containerId)).resolves.toBeUndefined();
    });
  });

  describe('toParseableStrings', () => {
    it('should extract JSON object with type text from response', () => {
      const json = JSON.stringify({
        type: 'text',
        part: { type: 'text', text: 'Hello' },
      });
      const response = `Some text before ${json} and text after`;
      const result = provider.toParseableStrings(response);

      expect(result).toEqual([json]);
    });

    it('should return empty array when no type text object found', () => {
      const response = 'Some text without type text';
      const result = provider.toParseableStrings(response);

      expect(result).toEqual([]);
    });

    it('should return empty array when type text object has empty text', () => {
      const json = JSON.stringify({
        type: 'text',
        part: { type: 'text', text: '' },
      });
      const response = `Some text ${json} more text`;
      const result = provider.toParseableStrings(response);

      expect(result).toEqual([]);
    });

    it('should extract JSON object and clean braces', () => {
      const json = JSON.stringify({
        type: 'text',
        part: { type: 'text', text: 'Hello' },
      });
      const response = `Prefix ${json} suffix`;
      const result = provider.toParseableStrings(response);

      expect(result).toEqual([json]);
    });

    it('should handle response with text before and after JSON', () => {
      const json = JSON.stringify({
        type: 'text',
        part: { type: 'text', text: 'Message' },
      });
      const response = `Log: ${json} done`;
      const result = provider.toParseableStrings(response);

      expect(result).toEqual([json]);
    });

    it('should handle multiline response with type text', () => {
      const json = JSON.stringify({
        type: 'text',
        part: { type: 'text', text: 'Hello' },
      });
      const response = `Line 1\n${json}\nLine 3`;
      const result = provider.toParseableStrings(response);

      expect(result).toEqual([json]);
    });

    it('should expand tool_use lines into synthetic tool_call plus original tool_use for tool_result', () => {
      const json = JSON.stringify({
        type: 'tool_use',
        part: { type: 'tool', callID: 'c1', tool: 'bash', state: { status: 'completed' } },
      });
      const response = `log ${json}`;
      const result = provider.toParseableStrings(response);

      expect(result).toHaveLength(2);
      const call = JSON.parse(result[0] ?? '{}') as {
        type?: string;
        toolCallId?: string;
        name?: string;
        status?: string;
      };

      expect(call.type).toBe('tool_call');
      expect(call.toolCallId).toBe('c1');
      expect(call.name).toBe('bash');
      expect(call.status).toBe('succeeded');
      expect(result[1]).toBe(json);
    });

    it('should trim whitespace from extracted JSON', () => {
      const json = JSON.stringify({
        type: 'text',
        part: { type: 'text', text: 'Hello' },
      });
      const response = `   ${json}   `;
      const result = provider.toParseableStrings(response);

      expect(result).toEqual([json]);
    });

    it('should handle empty string', () => {
      const response = '';
      const result = provider.toParseableStrings(response);

      expect(result).toEqual([]);
    });

    it('should handle response with only whitespace', () => {
      const response = '   \n\t   ';
      const result = provider.toParseableStrings(response);

      expect(result).toEqual([]);
    });

    it('should extract multiple JSONL lines', () => {
      const first = JSON.stringify({
        type: 'text',
        part: { type: 'text', text: 'First' },
      });
      const second = JSON.stringify({
        type: 'text',
        part: { type: 'text', text: 'Second' },
      });
      const response = `${first}\n${second}`;
      const result = provider.toParseableStrings(response);

      expect(result).toEqual([first, second]);
    });
  });

  describe('toUnifiedResponse', () => {
    it('should parse valid opencode response object', () => {
      const response = JSON.stringify({
        type: 'text',
        timestamp: 1234567890,
        sessionID: 'session-123',
        part: {
          id: 'part-1',
          sessionID: 'session-123',
          messageID: 'msg-1',
          type: 'text',
          text: 'Hello from agent!',
          time: {
            start: 1234567890,
            end: 1234567900,
          },
        },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'result',
        subtype: 'success',
        result: 'Hello from agent!',
      });
    });

    it('should extract text from part object', () => {
      const response = JSON.stringify({
        type: 'text',
        timestamp: 1234567890,
        sessionID: 'session-123',
        part: {
          id: 'part-1',
          sessionID: 'session-123',
          messageID: 'msg-1',
          type: 'text',
          text: 'Response text',
          time: {
            start: 1234567890,
            end: 1234567900,
          },
        },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'result',
        subtype: 'success',
        result: 'Response text',
      });
    });

    it('should handle empty text in part object', () => {
      const response = JSON.stringify({
        type: 'text',
        timestamp: 1234567890,
        sessionID: 'session-123',
        part: {
          id: 'part-1',
          sessionID: 'session-123',
          messageID: 'msg-1',
          type: 'text',
          text: '',
          time: {
            start: 1234567890,
            end: 1234567900,
          },
        },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'result',
        subtype: 'success',
        result: '',
      });
    });

    it('should handle multiline text in part object', () => {
      const response = JSON.stringify({
        type: 'text',
        timestamp: 1234567890,
        sessionID: 'session-123',
        part: {
          id: 'part-1',
          sessionID: 'session-123',
          messageID: 'msg-1',
          type: 'text',
          text: 'Line 1\nLine 2\nLine 3',
          time: {
            start: 1234567890,
            end: 1234567900,
          },
        },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'result',
        subtype: 'success',
        result: 'Line 1\nLine 2\nLine 3',
      });
    });

    it('should handle text with special characters', () => {
      const response = JSON.stringify({
        type: 'text',
        timestamp: 1234567890,
        sessionID: 'session-123',
        part: {
          id: 'part-1',
          sessionID: 'session-123',
          messageID: 'msg-1',
          type: 'text',
          text: 'Hello! @#$%^&*()_+-=[]{}|;:,.<>?',
          time: {
            start: 1234567890,
            end: 1234567900,
          },
        },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'result',
        subtype: 'success',
        result: 'Hello! @#$%^&*()_+-=[]{}|;:,.<>?',
      });
    });

    it('should handle text with unicode characters', () => {
      const response = JSON.stringify({
        type: 'text',
        timestamp: 1234567890,
        sessionID: 'session-123',
        part: {
          id: 'part-1',
          sessionID: 'session-123',
          messageID: 'msg-1',
          type: 'text',
          text: 'Hello 世界 🌍',
          time: {
            start: 1234567890,
            end: 1234567900,
          },
        },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'result',
        subtype: 'success',
        result: 'Hello 世界 🌍',
      });
    });

    it('should always return type "result"', () => {
      const response = JSON.stringify({
        type: 'text',
        timestamp: 1234567890,
        sessionID: 'session-123',
        part: {
          id: 'part-1',
          sessionID: 'session-123',
          messageID: 'msg-1',
          type: 'text',
          text: 'Any message',
          time: {
            start: 1234567890,
            end: 1234567900,
          },
        },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result.type).toBe('result');
    });

    it('should always return subtype "success"', () => {
      const response = JSON.stringify({
        type: 'text',
        timestamp: 1234567890,
        sessionID: 'session-123',
        part: {
          id: 'part-1',
          sessionID: 'session-123',
          messageID: 'msg-1',
          type: 'text',
          text: 'Any message',
          time: {
            start: 1234567890,
            end: 1234567900,
          },
        },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result.subtype).toBe('success');
    });

    it('should handle very long text', () => {
      const longText = 'A'.repeat(10000);
      const response = JSON.stringify({
        type: 'text',
        timestamp: 1234567890,
        sessionID: 'session-123',
        part: {
          id: 'part-1',
          sessionID: 'session-123',
          messageID: 'msg-1',
          type: 'text',
          text: longText,
          time: {
            start: 1234567890,
            end: 1234567900,
          },
        },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'result',
        subtype: 'success',
        result: longText,
      });
      expect(typeof result?.result === 'string' ? result.result.length : 0).toBe(10000);
    });

    it('should throw error for invalid JSON', () => {
      const response = '{"type":"text","part":{"text":"Hello"'; // Missing closing brace

      expect(() => provider.toUnifiedResponse(response)).toThrow();
    });

    it('should map synthetic tool_call JSON to unified tool_call', () => {
      const response = JSON.stringify({
        type: 'tool_call',
        toolCallId: 'call-1',
        name: 'bash',
        args: { command: 'echo hi' },
        status: 'succeeded',
      });
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'tool_call',
        toolCallId: 'call-1',
        name: 'bash',
        args: { command: 'echo hi' },
        status: 'succeeded',
      });
    });

    it('should map tool_use line to tool_result', () => {
      const response = JSON.stringify({
        type: 'tool_use',
        timestamp: 1,
        sessionID: 'ses_x',
        part: {
          id: 'p1',
          type: 'tool',
          callID: 'call-1',
          tool: 'bash',
          state: {
            status: 'completed',
            input: { command: 'echo hi' },
            output: 'hi\n',
            title: 'Run',
            metadata: { exit: 0 },
            time: { start: 1, end: 2 },
          },
        },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'tool_result',
        toolCallId: 'call-1',
        name: 'bash',
        result: {
          output: 'hi\n',
          input: { command: 'echo hi' },
          title: 'Run',
          metadata: { exit: 0 },
        },
        isError: false,
      });
    });

    it('should set isError when bash exit is non-zero', () => {
      const response = JSON.stringify({
        type: 'tool_use',
        part: {
          type: 'tool',
          callID: 'call-1',
          tool: 'bash',
          state: {
            status: 'completed',
            metadata: { exit: 1 },
          },
        },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result?.isError).toBe(true);
    });

    it('should map error event', () => {
      const response = JSON.stringify({
        type: 'error',
        timestamp: 1,
        sessionID: 'ses_x',
        error: { name: 'APIError', data: { message: 'Rate limited' } },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'error',
        is_error: true,
        result: 'Rate limited',
      });
    });
  });
});
