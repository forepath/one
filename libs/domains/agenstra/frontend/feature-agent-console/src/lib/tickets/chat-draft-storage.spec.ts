import {
  AGENT_CONSOLE_CHAT_DRAFT_STORAGE_KEY,
  readAndClearAgentConsoleChatDraft,
  storeAgentConsoleChatDraft,
} from './chat-draft-storage';

describe('chat draft storage', () => {
  beforeEach(() => sessionStorage.clear());

  it('round-trips the context selection including linked plans (deduplicated) and clears the draft', () => {
    storeAgentConsoleChatDraft('Continue', {
      contextInjection: {
        includeWorkspaceContext: true,
        autoEnrichmentEnabled: false,
        selectedEnvironmentContextIds: ['agent-1'],
        selectedTicketContextShas: ['t1'],
        selectedKnowledgeContextShas: ['k1'],
        selectedPlanContextShas: ['p1', 'p1', 'p2'],
      },
    });

    expect(readAndClearAgentConsoleChatDraft()).toEqual({
      message: 'Continue',
      contextInjection: {
        includeWorkspaceContext: true,
        autoEnrichmentEnabled: false,
        selectedEnvironmentContextIds: ['agent-1'],
        selectedTicketContextShas: ['t1'],
        selectedKnowledgeContextShas: ['k1'],
        selectedPlanContextShas: ['p1', 'p2'],
      },
    });
    expect(sessionStorage.getItem(AGENT_CONSOLE_CHAT_DRAFT_STORAGE_KEY)).toBeNull();
  });

  it('reads drafts written before plans could be linked (no plan selection)', () => {
    sessionStorage.setItem(
      AGENT_CONSOLE_CHAT_DRAFT_STORAGE_KEY,
      JSON.stringify({
        v: 2,
        message: 'Old',
        contextInjection: {
          includeWorkspaceContext: false,
          autoEnrichmentEnabled: true,
          selectedEnvironmentContextIds: [],
        },
      }),
    );

    expect(readAndClearAgentConsoleChatDraft()?.contextInjection?.selectedPlanContextShas).toEqual([]);
  });
});
