import { parseAgentHandoffChatMessage } from '@forepath/agenstra/shared/util-opencode-config';

import {
  buildAgentHandoffDeliveryMessage,
  buildAgentHandoffFallbackResponse,
  buildAgentHandoffRepairPrompt,
  buildAgentHandoffTargetMessage,
} from './agent-handoff-prompt.utils';

describe('agent handoff prompts', () => {
  const handoff = {
    id: '33333333-3333-4333-8333-333333333333',
    title: 'Review the API',
    message: 'Check the new endpoints.',
    sourceAgentId: 'agent-a',
    sourceAgentName: 'Backend',
    sourceChatId: 'chat-a',
    targetAgentId: 'agent-b',
    targetAgentName: 'Reviewer',
    targetChatId: 'chat-b',
    response: null,
    failureMessage: null,
  };

  it('builds the incoming message with the source chat link and the respond protocol', () => {
    const text = buildAgentHandoffTargetMessage(handoff);
    const parsed = parseAgentHandoffChatMessage(text);

    expect(parsed).toEqual({
      kind: 'request',
      meta: {
        id: handoff.id,
        title: 'Review the API',
        sourceAgentId: 'agent-a',
        sourceAgentName: 'Backend',
        sourceChatId: 'chat-a',
      },
      body: '# Review the API\n\nCheck the new endpoints.',
    });
    expect(text).toContain(`agenstra_handoff_respond exactly once with handoffId "${handoff.id}"`);
  });

  it('asks for the missing response without new work', () => {
    const prompt = buildAgentHandoffRepairPrompt(handoff);

    expect(prompt).toContain('Do not start new work');
    expect(prompt).toContain(handoff.id);
  });

  it('delivers completed and failed outcomes with a link to the handoff chat', () => {
    const completed = parseAgentHandoffChatMessage(
      buildAgentHandoffDeliveryMessage({ ...handoff, response: 'All good.' }, 'completed'),
    );
    const failed = parseAgentHandoffChatMessage(
      buildAgentHandoffDeliveryMessage({ ...handoff, failureMessage: 'Agent unreachable' }, 'failed'),
    );

    expect(completed).toEqual({
      kind: 'response',
      meta: {
        id: handoff.id,
        title: 'Review the API',
        status: 'completed',
        targetAgentId: 'agent-b',
        targetAgentName: 'Reviewer',
        targetChatId: 'chat-b',
      },
      body: 'All good.',
    });
    expect(failed?.meta).toEqual(expect.objectContaining({ status: 'failed' }));
    expect(failed?.body).toBe('Agent unreachable');
  });

  it('falls back to the tail of the last answer', () => {
    expect(buildAgentHandoffFallbackResponse('  ')).toBeNull();
    expect(buildAgentHandoffFallbackResponse(undefined)).toBeNull();
    expect(buildAgentHandoffFallbackResponse('Done.')).toContain('Done.');

    const long = buildAgentHandoffFallbackResponse(`${'a'.repeat(9_000)}END`) as string;

    expect(long.endsWith('END')).toBe(true);
    expect(long.length).toBeLessThan(8_200);
  });
});
