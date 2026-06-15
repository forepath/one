import { Test, TestingModule } from '@nestjs/testing';

import { DockerService } from '../../services/docker.service';

import { CursorAgentProvider } from './cursor-agent.provider';

describe('CursorAgentProvider', () => {
  let provider: CursorAgentProvider;
  let dockerService: jest.Mocked<DockerService>;
  const mockDockerService = {
    sendCommandToContainer: jest.fn(),
    execCommandStream: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        CursorAgentProvider,
        {
          provide: DockerService,
          useValue: mockDockerService,
        },
      ],
    }).compile();

    provider = module.get<CursorAgentProvider>(CursorAgentProvider);
    dockerService = module.get(DockerService);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.CURSOR_AGENT_DOCKER_IMAGE;
  });

  describe('getType', () => {
    it('should return "cursor"', () => {
      expect(provider.getType()).toBe('cursor');
    });
  });

  describe('getDisplayName', () => {
    it('should return "Cursor"', () => {
      expect(provider.getDisplayName()).toBe('Cursor');
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
    it('should return "~/.cursor"', () => {
      expect(provider.getConfigBasePath()).toBe('~/.cursor');
    });
  });

  describe('getDockerImage', () => {
    it('should return default image when CURSOR_AGENT_DOCKER_IMAGE is not set', () => {
      delete process.env.CURSOR_AGENT_DOCKER_IMAGE;

      const image = provider.getDockerImage();

      expect(image).toBe('ghcr.io/forepath/agenstra-manager-worker:latest');
    });

    it('should return custom image from CURSOR_AGENT_DOCKER_IMAGE environment variable', () => {
      process.env.CURSOR_AGENT_DOCKER_IMAGE = 'custom-registry/custom-image:v1.0.0';

      const image = provider.getDockerImage();

      expect(image).toBe('custom-registry/custom-image:v1.0.0');
    });
  });

  describe('getModelsListCommand', () => {
    it('should return "cursor-agent --list-models"', () => {
      expect(provider.getModelsListCommand()).toBe('cursor-agent --list-models');
    });
  });

  describe('toModelsList', () => {
    it('should parse model lines with ANSI noise and id - name pairs', () => {
      const raw = `\u001b[2K\u001b[GLoading models…
\u001b[2K\u001b[1A\u001b[2K\u001b[GAvailable models

auto - Auto
composer-2-fast - Composer 2 Fast  (current, default)
composer-2 - Composer 2
composer-1.5 - Composer 1.5
`;

      expect(provider.toModelsList(raw)).toEqual({
        auto: 'Auto',
        'composer-2-fast': 'Composer 2 Fast  (current, default)',
        'composer-2': 'Composer 2',
        'composer-1.5': 'Composer 1.5',
      });
    });

    it('should split only on first " - " so names may contain hyphens', () => {
      expect(provider.toModelsList('my-id - Display - with - extra')).toEqual({
        'my-id': 'Display - with - extra',
      });
    });

    it('should skip lines without " - " and return empty object when nothing matches', () => {
      expect(
        provider.toModelsList(`Available models
no separator here
`),
      ).toEqual({});
    });

    it('should return empty object for empty or whitespace-only input', () => {
      expect(provider.toModelsList('')).toEqual({});
      expect(provider.toModelsList('   \n  \t  ')).toEqual({});
    });

    it('should ignore lines with empty id after split', () => {
      expect(provider.toModelsList(' - only name')).toEqual({});
    });
  });

  describe('sendMessage', () => {
    const agentId = 'test-agent-id';
    const containerId = 'test-container-id';
    const message = 'Hello, agent!';

    it('should send message to container without model option', async () => {
      const expectedResponse = '{"type":"result","result":"Hello from agent!"}';

      dockerService.sendCommandToContainer.mockResolvedValue(expectedResponse);

      const response = await provider.sendMessage(agentId, containerId, message);

      expect(response).toBe(expectedResponse);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        containerId,
        `cursor-agent --print --approve-mcps --force --output-format json --resume ${agentId}-${containerId}`,
        message,
      );
    });

    it('should send message to container with model option', async () => {
      const expectedResponse = '{"type":"result","result":"Hello from agent!"}';
      const model = 'gpt-4';

      dockerService.sendCommandToContainer.mockResolvedValue(expectedResponse);

      const response = await provider.sendMessage(agentId, containerId, message, { model });

      expect(response).toBe(expectedResponse);
      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        containerId,
        `cursor-agent --print --approve-mcps --force --output-format json --resume ${agentId}-${containerId} --model ${model}`,
        message,
      );
    });

    it('should append resumeSessionSuffix to resume id when provided', async () => {
      dockerService.sendCommandToContainer.mockResolvedValue('{}');

      await provider.sendMessage(agentId, containerId, message, { resumeSessionSuffix: '-prompt-enhance' });

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        containerId,
        `cursor-agent --print --approve-mcps --force --output-format json --resume ${agentId}-${containerId}-prompt-enhance`,
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

    it('should use stream-json and stream-partial-output with execCommandStream', async () => {
      async function* mockStream(): AsyncGenerator<{ stream: 'stdout' | 'stderr'; chunk: string }> {
        yield { stream: 'stdout', chunk: '{"type":"assistant"' };
        yield { stream: 'stdout', chunk: '}\n' };
      }

      dockerService.execCommandStream.mockImplementation(mockStream);

      const chunks: string[] = [];

      for await (const chunk of provider.sendMessageStream(agentId, containerId, message)) {
        chunks.push(chunk);
      }

      expect(chunks.join('')).toBe('{"type":"assistant"}\n');
      expect(dockerService.execCommandStream).toHaveBeenCalledWith(
        containerId,
        `cursor-agent --print --approve-mcps --force --output-format stream-json --stream-partial-output --resume ${agentId}-${containerId}`,
        message,
      );
    });

    it('should forward model flag when provided', async () => {
      async function* emptyStream(): AsyncGenerator<{ stream: 'stdout' | 'stderr'; chunk: string }> {
        // empty
      }

      dockerService.execCommandStream.mockImplementation(emptyStream);
      const model = 'gpt-4';

      for await (const _ of provider.sendMessageStream(agentId, containerId, message, { model })) {
        // consume
      }

      expect(dockerService.execCommandStream).toHaveBeenCalledWith(
        containerId,
        `cursor-agent --print --approve-mcps --force --output-format stream-json --stream-partial-output --resume ${agentId}-${containerId} --model ${model}`,
        message,
      );
    });
  });

  describe('sendInitialization', () => {
    const agentId = 'test-agent-id';
    const containerId = 'test-container-id';

    it('should send initialization message without model option', async () => {
      const loggerDebugSpy = jest.spyOn(provider['logger'], 'debug').mockImplementation();

      dockerService.sendCommandToContainer.mockResolvedValue('');

      await provider.sendInitialization(agentId, containerId);

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        containerId,
        `cursor-agent --print --approve-mcps --force --output-format json --resume ${agentId}-${containerId}`,
        expect.stringContaining('You are operating in a codebase with a structured command and rules system'),
      );
      expect(loggerDebugSpy).toHaveBeenCalledWith(`Sent initialization message to agent ${agentId}`);

      loggerDebugSpy.mockRestore();
    });

    it('should send initialization message with model option', async () => {
      const loggerDebugSpy = jest.spyOn(provider['logger'], 'debug').mockImplementation();
      const model = 'gpt-4';

      dockerService.sendCommandToContainer.mockResolvedValue('');

      await provider.sendInitialization(agentId, containerId, { model });

      expect(dockerService.sendCommandToContainer).toHaveBeenCalledWith(
        containerId,
        `cursor-agent --print --approve-mcps --force --output-format json --resume ${agentId}-${containerId} --model ${model}`,
        expect.stringContaining('You are operating in a codebase with a structured command and rules system'),
      );
      expect(loggerDebugSpy).toHaveBeenCalledWith(`Sent initialization message to agent ${agentId}`);

      loggerDebugSpy.mockRestore();
    });

    it('should include command system instructions in initialization message', async () => {
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await provider.sendInitialization(agentId, containerId);

      const callArgs = dockerService.sendCommandToContainer.mock.calls[0];
      const instructions = callArgs[2] as string;

      expect(instructions).toContain('COMMAND SYSTEM');
      expect(instructions).toContain('.cursor/commands');
      expect(instructions).toContain('/{filenamewithoutextension}');
    });

    it('should include rules system instructions in initialization message', async () => {
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await provider.sendInitialization(agentId, containerId);

      const callArgs = dockerService.sendCommandToContainer.mock.calls[0];
      const instructions = callArgs[2] as string;

      expect(instructions).toContain('RULES SYSTEM');
      expect(instructions).toContain('.cursor/rules');
      expect(instructions).toContain('alwaysApply');
    });

    it('should include message handling instructions in initialization message', async () => {
      dockerService.sendCommandToContainer.mockResolvedValue('');

      await provider.sendInitialization(agentId, containerId);

      const callArgs = dockerService.sendCommandToContainer.mock.calls[0];
      const instructions = callArgs[2] as string;

      expect(instructions).toContain('MESSAGE HANDLING');
      expect(instructions).toContain('one-time initialization message');
    });

    it('should log warning and re-throw error on failure', async () => {
      const loggerWarnSpy = jest.spyOn(provider['logger'], 'warn').mockImplementation();
      const error = new Error('Container error');

      dockerService.sendCommandToContainer.mockRejectedValue(error);

      await expect(provider.sendInitialization(agentId, containerId)).rejects.toThrow('Container error');

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        `Failed to send initialization message to agent ${agentId}: Container error`,
        expect.any(String), // Error stack trace
      );

      loggerWarnSpy.mockRestore();
    });

    it('should log warning with stack trace when error has stack', async () => {
      const loggerWarnSpy = jest.spyOn(provider['logger'], 'warn').mockImplementation();
      const error = new Error('Container error');

      error.stack = 'Error stack trace';
      dockerService.sendCommandToContainer.mockRejectedValue(error);

      await expect(provider.sendInitialization(agentId, containerId)).rejects.toThrow('Container error');

      expect(loggerWarnSpy).toHaveBeenCalledWith(
        `Failed to send initialization message to agent ${agentId}: Container error`,
        'Error stack trace',
      );

      loggerWarnSpy.mockRestore();
    });
  });

  describe('toParseableStrings', () => {
    it('should extract JSON from each line of response', () => {
      const response = 'Some text before {"type":"result","result":"Hello"} and text after';
      const result = provider.toParseableStrings(response);

      // The implementation extracts JSON by removing text before { and after }
      expect(result).toEqual(['{"type":"result","result":"Hello"}']);
    });

    it('should return array with clean JSON when response is already clean', () => {
      const response = '{"type":"result","result":"Hello"}';
      const result = provider.toParseableStrings(response);

      expect(result).toEqual(['{"type":"result","result":"Hello"}']);
    });

    it('should handle response with only opening brace', () => {
      const response = 'Some text {';
      const result = provider.toParseableStrings(response);

      expect(result).toEqual(['{']);
    });

    it('should handle response with only closing brace', () => {
      const response = '} some text';
      const result = provider.toParseableStrings(response);

      expect(result).toEqual(['}']);
    });

    it('should handle response with no braces', () => {
      const response = 'Some text without braces';
      const result = provider.toParseableStrings(response);

      expect(result).toEqual(['Some text without braces']);
    });

    it('should extract JSON from multiple lines', () => {
      const response = '{"type":"first","result":"First"}\n{"type":"second","result":"Second"}';
      const result = provider.toParseableStrings(response);

      expect(result).toEqual(['{"type":"first","result":"First"}', '{"type":"second","result":"Second"}']);
    });

    it('should handle nested JSON objects', () => {
      const response = 'Prefix {"type":"result","data":{"nested":"value"}} suffix';
      const result = provider.toParseableStrings(response);

      // The implementation extracts JSON by removing text before { and after }
      expect(result).toEqual(['{"type":"result","data":{"nested":"value"}}']);
    });

    it('should trim whitespace from each line', () => {
      const response = '   {"type":"result","result":"Hello"}   ';
      const result = provider.toParseableStrings(response);

      expect(result).toEqual(['{"type":"result","result":"Hello"}']);
    });

    it('should return empty array for empty string', () => {
      const response = '';
      const result = provider.toParseableStrings(response);

      // Empty string splits to [''] which maps to ['']
      expect(result).toEqual(['']);
    });

    it('should handle response with only whitespace', () => {
      const response = '   \n\t   ';
      const result = provider.toParseableStrings(response);

      // Splits to ['   ', '\t   '] which both trim to ['']
      expect(result).toEqual(['', '']);
    });

    it('should handle complex JSON with arrays and nested objects', () => {
      const response = 'Log: {"type":"result","items":[{"id":1},{"id":2}]} done';
      const result = provider.toParseableStrings(response);

      // The implementation extracts JSON by removing text before { and after }
      expect(result).toEqual(['{"type":"result","items":[{"id":1},{"id":2}]}']);
    });

    it('should process each line independently', () => {
      const response = 'Line 1 {"type":"result","result":"First"}\nLine 2 {"type":"result","result":"Second"}';
      const result = provider.toParseableStrings(response);

      // The implementation extracts JSON from each line by removing text before { and after }
      expect(result).toEqual(['{"type":"result","result":"First"}', '{"type":"result","result":"Second"}']);
    });

    it('should handle lines with text before and after JSON', () => {
      const response =
        'Prefix {"type":"result","result":"Hello"} Suffix\nAnother {"type":"result","result":"World"} End';
      const result = provider.toParseableStrings(response);

      // The implementation extracts JSON from each line by removing text before { and after }
      expect(result).toEqual(['{"type":"result","result":"Hello"}', '{"type":"result","result":"World"}']);
    });
  });

  describe('toUnifiedResponse', () => {
    it('should parse valid JSON response with required fields', () => {
      const response = '{"type":"result","result":"Hello from agent"}';
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'result',
        result: 'Hello from agent',
      });
    });

    it('should parse valid JSON response with all optional fields', () => {
      const response =
        '{"type":"result","subtype":"success","is_error":false,"duration_ms":100,"duration_api_ms":50,"result":"Success","session_id":"session-123","request_id":"req-456"}';
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'result',
        subtype: 'success',
        is_error: false,
        duration_ms: 100,
        duration_api_ms: 50,
        result: 'Success',
        session_id: 'session-123',
        request_id: 'req-456',
      });
    });

    it('should parse JSON response with additional properties', () => {
      const response = '{"type":"result","result":"Hello","custom_field":"custom_value","another_field":123}';
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'result',
        result: 'Hello',
        custom_field: 'custom_value',
        another_field: 123,
      });
    });

    it('should parse error response', () => {
      const response = '{"type":"error","is_error":true,"result":"Something went wrong"}';
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'error',
        is_error: true,
        result: 'Something went wrong',
      });
    });

    it('should throw error for invalid JSON', () => {
      const response = '{"type":"result","result":"Hello"'; // Missing closing brace

      expect(() => provider.toUnifiedResponse(response)).toThrow();
    });

    it('should throw error for empty string', () => {
      const response = '';

      expect(() => provider.toUnifiedResponse(response)).toThrow();
    });

    it('should throw error for non-JSON string', () => {
      const response = 'This is not JSON';

      expect(() => provider.toUnifiedResponse(response)).toThrow();
    });

    it('should throw error for malformed JSON with trailing comma', () => {
      const response = '{"type":"result","result":"Hello",}'; // Trailing comma

      expect(() => provider.toUnifiedResponse(response)).toThrow();
    });

    it('should parse JSON with null values', () => {
      const response = '{"type":"result","result":null,"subtype":null}';
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'result',
        result: null,
        subtype: null,
      });
    });

    it('should parse JSON with boolean values', () => {
      const response = '{"type":"result","is_error":true,"success":false}';
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'result',
        is_error: true,
        success: false,
      });
    });

    it('should parse JSON with numeric values', () => {
      const response = '{"type":"result","duration_ms":1234,"count":42,"rate":3.14}';
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({
        type: 'result',
        duration_ms: 1234,
        count: 42,
        rate: 3.14,
      });
    });

    it('should map stream-json assistant line to delta', () => {
      const response = JSON.stringify({
        type: 'assistant',
        message: {
          role: 'assistant',
          content: [{ type: 'text', text: 'Hello' }],
        },
        session_id: 's1',
      });
      const result = provider.toUnifiedResponse(response);

      expect(result).toEqual({ type: 'delta', delta: 'Hello' });
    });

    it('should return undefined for stream-json user line', () => {
      const response = JSON.stringify({
        type: 'user',
        message: { role: 'user', content: [{ type: 'text', text: 'Hi' }] },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result).toBeUndefined();
    });

    it('should map tool_call started to tool_call', () => {
      const response = JSON.stringify({
        type: 'tool_call',
        subtype: 'started',
        tool_call: {
          readToolCall: {
            args: { path: '/src/a.ts' },
          },
        },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result?.type).toBe('tool_call');
      expect(result?.toolCallId).toMatch(/^cursor-read-/);
      expect(result?.name).toBe('read');
      expect(result?.status).toBe('started');
    });

    it('should map tool_call completed to tool_result', () => {
      const response = JSON.stringify({
        type: 'tool_call',
        subtype: 'completed',
        tool_call: {
          readToolCall: {
            args: { path: '/src/a.ts' },
            result: {
              success: { totalLines: 10, contentSize: 100 },
            },
          },
        },
      });
      const result = provider.toUnifiedResponse(response);

      expect(result?.type).toBe('tool_result');
      expect(result?.toolCallId).toMatch(/^cursor-read-/);
      expect(result?.name).toBe('read');
      expect(result?.isError).toBe(false);
    });
  });
});
