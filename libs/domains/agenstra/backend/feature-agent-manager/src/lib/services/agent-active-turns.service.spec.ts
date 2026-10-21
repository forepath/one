import { AgentActiveTurnsService, resolveAgentTurnContext } from './agent-active-turns.service';

describe('AgentActiveTurnsService', () => {
  const agentId = 'agent-1';
  const chatId = '33333333-3333-4333-8333-333333333333';
  let turns: AgentActiveTurnsService;

  beforeEach(() => {
    turns = new AgentActiveTurnsService();
  });

  it('maps session suffixes to chat contexts', () => {
    expect(resolveAgentTurnContext(undefined)).toEqual({ kind: 'primary' });
    expect(resolveAgentTurnContext('')).toEqual({ kind: 'primary' });
    expect(resolveAgentTurnContext(`-chat-${chatId.toUpperCase()}`)).toEqual({ kind: 'chat', chatId });
    expect(resolveAgentTurnContext('-chat-not-a-uuid')).toEqual({ kind: 'hidden' });
    expect(resolveAgentTurnContext('-task-x')).toEqual({ kind: 'hidden' });
    expect(resolveAgentTurnContext('-ticket-auto-loop')).toEqual({ kind: 'hidden' });
    expect(resolveAgentTurnContext('-plan-x')).toEqual({ kind: 'hidden' });
    expect(resolveAgentTurnContext('-prompt-enhance')).toEqual({ kind: 'hidden' });
  });

  it('is idle without running turns and resolves a single visible chat', () => {
    expect(turns.callingContext(agentId)).toEqual({ kind: 'idle' });

    const end = turns.begin(agentId, `-chat-${chatId}`);
    // A second prompt queued into the same chat keeps the context unambiguous.
    const endQueued = turns.begin(agentId, `-chat-${chatId}`);

    expect(turns.callingContext(agentId)).toEqual({ kind: 'visible', context: { kind: 'chat', chatId } });

    end();
    endQueued();
    endQueued();

    expect(turns.callingContext(agentId)).toEqual({ kind: 'idle' });
  });

  it('reports hidden-only and parallel contexts', () => {
    const endTask = turns.begin(agentId, '-task-1');

    expect(turns.callingContext(agentId)).toEqual({ kind: 'hidden' });

    const endPrimary = turns.begin(agentId, '');

    expect(turns.callingContext(agentId)).toEqual({ kind: 'ambiguous' });

    endTask();

    expect(turns.callingContext(agentId)).toEqual({ kind: 'visible', context: { kind: 'primary' } });
    expect(turns.callingContext('other-agent')).toEqual({ kind: 'idle' });

    endPrimary();
  });
});
