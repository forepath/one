import type { AgentHandoffSummary } from '@forepath/agenstra/shared/util-opencode-config';

import { ContextApiClient, ContextApiError } from './context-api.client';
import { CONTEXT_TOOL_DEFINITIONS } from './context-tools';
import { callHandoffTool, HANDOFF_TOOL_DEFINITIONS, isHandoffToolName } from './handoff-tools';
import { TASK_TOOL_DEFINITIONS } from './task-tools';

const HANDOFF: AgentHandoffSummary = {
  id: '11111111-1111-4111-8111-111111111111',
  sourceAgentId: 'agent-a',
  sourceAgentName: 'Backend',
  sourceChatId: 'chat-a',
  sourceTaskId: null,
  sourceTaskRunId: null,
  targetAgentId: 'agent-b',
  targetAgentName: 'Reviewer',
  targetChatId: 'chat-b',
  title: 'Review',
  message: 'Review the API',
  status: 'pending',
  response: null,
  failureMessage: null,
  delivery: 'pending',
  deliveryFailureMessage: null,
  createdAt: '2026-10-21T09:00:00.000Z',
  finishedAt: null,
};

describe('handoff tools', () => {
  let client: jest.Mocked<
    Pick<
      ContextApiClient,
      | 'listHandoffAgents'
      | 'createHandoff'
      | 'getHandoff'
      | 'respondToHandoff'
      | 'getHandoffProfile'
      | 'updateHandoffProfile'
    >
  >;

  beforeEach(() => {
    client = {
      listHandoffAgents: jest.fn(),
      createHandoff: jest.fn(),
      getHandoff: jest.fn(),
      respondToHandoff: jest.fn(),
      getHandoffProfile: jest.fn(),
      updateHandoffProfile: jest.fn(),
    };
  });

  const call = (name: string, args: unknown) => callHandoffTool(client as unknown as ContextApiClient, name, args);

  it('exposes four handoff tools that do not collide with the other tools', () => {
    expect(HANDOFF_TOOL_DEFINITIONS.map((tool) => tool.name)).toEqual([
      'handoff_agents',
      'handoff_profile_get',
      'handoff_profile_update',
      'handoff_create',
      'handoff_get',
      'handoff_respond',
    ]);

    const otherNames = new Set([...CONTEXT_TOOL_DEFINITIONS, ...TASK_TOOL_DEFINITIONS].map((tool) => tool.name));

    for (const tool of HANDOFF_TOOL_DEFINITIONS) {
      expect(otherNames.has(tool.name)).toBe(false);
      expect(isHandoffToolName(tool.name)).toBe(true);
    }

    expect(isHandoffToolName('tasks_list')).toBe(false);
  });

  it('lists workspace agents and reminds the agent of its own empty profile', async () => {
    client.listHandoffAgents.mockResolvedValue({
      self: { id: 'agent-a', name: 'Backend' },
      agents: [{ id: 'agent-b', name: 'Reviewer', handoffProfile: 'Reviews code' }],
    });

    const result = JSON.parse((await call('handoff_agents', {})).content[0].text);

    expect(result.agents).toEqual([{ id: 'agent-b', name: 'Reviewer', handoffProfile: 'Reviews code' }]);
    expect(result.hint).toContain('handoff_profile_update');

    client.listHandoffAgents.mockResolvedValue({
      self: { id: 'agent-a', name: 'Backend', handoffProfile: 'Owns the API' },
      agents: [],
    });

    expect(JSON.parse((await call('handoff_agents', {})).content[0].text).hint).toBeUndefined();
  });

  it('reads peer profiles and updates only the own profile', async () => {
    client.getHandoffProfile.mockResolvedValue({ id: 'agent-b', name: 'Reviewer', handoffProfile: 'Reviews code' });
    client.updateHandoffProfile.mockResolvedValue({ id: 'agent-a', name: 'Backend' });

    await call('handoff_profile_get', { targetAgentId: ' agent-b ' });
    await call('handoff_profile_update', { profile: '', agentId: 'agent-b' });

    expect(client.getHandoffProfile).toHaveBeenCalledWith('agent-b');
    expect(client.updateHandoffProfile).toHaveBeenCalledWith({ profile: '' });
    expect((await call('handoff_profile_get', {})).isError).toBe(true);
    expect((await call('handoff_profile_update', { profile: 3 })).isError).toBe(true);
  });

  it('creates a handoff from typed fields and reports the id at the top level', async () => {
    client.createHandoff.mockResolvedValue({ handoff: HANDOFF });

    const result = await call('handoff_create', {
      targetAgentId: ' agent-b ',
      title: 'Review',
      message: 'Review the API',
      model: 42,
      sourceAgentId: 'spoofed',
    });

    expect(client.createHandoff).toHaveBeenCalledWith({
      targetAgentId: 'agent-b',
      title: 'Review',
      message: 'Review the API',
    });
    expect(JSON.parse(result.content[0].text)).toEqual(
      expect.objectContaining({ handoffId: HANDOFF.id, targetChatId: 'chat-b', status: 'pending' }),
    );
  });

  it('rejects incomplete creations and responses', async () => {
    expect((await call('handoff_create', { title: 'Only a title' })).isError).toBe(true);
    expect((await call('handoff_respond', { handoffId: HANDOFF.id, status: 'done', response: 'x' })).isError).toBe(
      true,
    );
    expect((await call('handoff_respond', { status: 'completed', response: 'x' })).isError).toBe(true);
    expect((await call('handoff_get', {})).isError).toBe(true);

    expect(client.createHandoff).not.toHaveBeenCalled();
    expect(client.respondToHandoff).not.toHaveBeenCalled();
    expect(client.getHandoff).not.toHaveBeenCalled();
  });

  it('records responses', async () => {
    client.respondToHandoff.mockResolvedValue({ handoff: { ...HANDOFF, status: 'completed' } });

    const result = await call('handoff_respond', { handoffId: HANDOFF.id, status: 'completed', response: ' Done ' });

    expect(client.respondToHandoff).toHaveBeenCalledWith(HANDOFF.id, { status: 'completed', response: 'Done' });
    expect(result.isError).toBeUndefined();
  });

  it('turns API errors into tool errors', async () => {
    client.getHandoff.mockRejectedValue(new ContextApiError('Handoff not found', 404));

    expect(await call('handoff_get', { handoffId: 'nope' })).toEqual({
      content: [{ type: 'text', text: 'Handoff not found' }],
      isError: true,
    });
  });
});
