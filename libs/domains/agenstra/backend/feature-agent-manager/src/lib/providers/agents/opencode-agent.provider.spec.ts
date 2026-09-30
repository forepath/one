import { Test, TestingModule } from '@nestjs/testing';

import type { AgentResponseObject } from '../agent-provider.interface';
import { OpenCodeRuntimeService } from '../opencode/opencode-runtime.service';

import { OpenCodeAgentProvider } from './opencode-agent.provider';

describe('OpenCodeAgentProvider', () => {
  let provider: OpenCodeAgentProvider;
  const mockRuntime = {
    sendMessage: jest.fn(),
    sendMessageStream: jest.fn(),
    sendInitialization: jest.fn(),
    streamChatEvents: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OpenCodeAgentProvider,
        {
          provide: OpenCodeRuntimeService,
          useValue: mockRuntime,
        },
      ],
    }).compile();

    provider = module.get<OpenCodeAgentProvider>(OpenCodeAgentProvider);
  });

  afterEach(() => {
    jest.clearAllMocks();
    delete process.env.OPENCODE_AGENT_DOCKER_IMAGE;
    delete process.env.OPENCODE_AGENT_VIRTUAL_WORKSPACE_DOCKER_IMAGE;
    delete process.env.OPENCODE_AGENT_SSH_CONNECTION_DOCKER_IMAGE;
  });

  it('reports OpenCode HTTP chat capabilities', () => {
    expect(provider.getCapabilities()).toEqual({
      transport: 'opencode-http',
      supportsChat: true,
      supportsStreaming: true,
      supportsToolEvents: true,
      supportsQuestions: true,
    });
  });

  it('keeps base path, config path, image, and model helpers', () => {
    expect(provider.getType()).toBe('opencode');
    expect(provider.getDisplayName()).toBe('OpenCode');
    expect(provider.getBasePath()).toBe('/app');
    expect(provider.getConfigBasePath()).toBe('~/.config/opencode');
    expect(provider.getDockerImage()).toBe('ghcr.io/forepath/agenstra-manager-worker:latest');
    expect(provider.getVirtualWorkspaceDockerImage()).toBe('ghcr.io/forepath/agenstra-manager-vnc:latest');
    expect(provider.getSshConnectionDockerImage()).toBe('ghcr.io/forepath/agenstra-manager-ssh:latest');
    expect(provider.getModelsListCommand()).toBe('opencode models');
    expect(provider.buildModelsCommand()).toBe('opencode models');
  });

  it('parses OpenCode model output', () => {
    expect(provider.toModelsList('model-a\nmodel-b')).toEqual({
      'model-a': 'model-a',
      'model-b': 'model-b',
    });
  });

  it('strips ANSI and non-printable noise from model output', () => {
    expect(provider.toModelsList('\u001b[32mopencode/big-pickle\u001b[0m\n\xffopencode/other')).toEqual({
      'opencode/big-pickle': 'opencode/big-pickle',
      'opencode/other': 'opencode/other',
    });
  });

  it('delegates sendMessage to OpenCode runtime', async () => {
    mockRuntime.sendMessage.mockResolvedValue('{"type":"result","result":"hi"}');

    const result = await provider.sendMessage('agent-1', 'container-1', 'hello', {
      model: 'gpt-5',
      resumeSessionSuffix: '-x',
    });

    expect(result).toBe('{"type":"result","result":"hi"}');
    expect(mockRuntime.sendMessage).toHaveBeenCalledWith(
      { agentId: 'agent-1', containerId: 'container-1', resumeSessionSuffix: '-x' },
      'hello',
      { model: 'gpt-5', resumeSessionSuffix: '-x' },
    );
  });

  it('delegates sendMessageStream to OpenCode runtime', async () => {
    mockRuntime.sendMessageStream.mockImplementation(async function* () {
      yield '{"type":"delta","delta":"hi"}';
    });

    const chunks: string[] = [];

    for await (const chunk of provider.sendMessageStream('agent-1', 'container-1', 'hello')) {
      chunks.push(chunk);
    }

    expect(chunks).toEqual(['{"type":"delta","delta":"hi"}']);
  });

  it('delegates streamChatEvents to OpenCode runtime', async () => {
    mockRuntime.streamChatEvents.mockImplementation(async function* () {
      yield { type: 'delta', delta: 'hello' };
    });

    const events: AgentResponseObject[] = [];

    for await (const event of provider.streamChatEvents!('agent-1', 'container-1', 'hello')) {
      events.push(event);
    }

    expect(events).toEqual([{ type: 'delta', delta: 'hello' }]);
  });

  it('delegates initialization to OpenCode runtime', async () => {
    mockRuntime.sendInitialization.mockResolvedValue(undefined);

    await provider.sendInitialization('agent-1', 'container-1', { resumeSessionSuffix: '-init' });

    expect(mockRuntime.sendInitialization).toHaveBeenCalledWith(
      { agentId: 'agent-1', containerId: 'container-1', resumeSessionSuffix: '-init' },
      { resumeSessionSuffix: '-init' },
    );
  });

  it('splits JSON lines into parseable strings', () => {
    expect(provider.toParseableStrings(' {"type":"delta"} \n\n {"type":"result"} ')).toEqual([
      '{"type":"delta"}',
      '{"type":"result"}',
    ]);
  });

  it('parses JSON responses directly', () => {
    expect(provider.toUnifiedResponse('{"type":"result","result":"done"}')).toEqual({
      type: 'result',
      result: 'done',
    });
  });
});
