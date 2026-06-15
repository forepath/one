/** sessionStorage key for one-shot chat input prefill (e.g. ticket prototype → Spaces). */
export const AGENT_CONSOLE_CHAT_DRAFT_STORAGE_KEY = 'agentConsole.chatDraft.v1';

export interface AgentConsoleChatDraftV1 {
  v: 1;
  message: string;
}

export interface AgentConsoleChatDraftV2 {
  v: 2;
  message: string;
  contextInjection?: {
    includeWorkspaceContext: boolean;
    autoEnrichmentEnabled: boolean;
    selectedEnvironmentContextIds: string[];
    selectedTicketContextShas?: string[];
    selectedKnowledgeContextShas?: string[];
  };
}

export function storeAgentConsoleChatDraft(
  message: string,
  options?: {
    contextInjection?: {
      includeWorkspaceContext: boolean;
      autoEnrichmentEnabled: boolean;
      selectedEnvironmentContextIds: string[];
      selectedTicketContextShas?: string[];
      selectedKnowledgeContextShas?: string[];
    };
  },
): void {
  if (typeof sessionStorage === 'undefined' || !message) {
    return;
  }

  const payload: AgentConsoleChatDraftV2 = {
    v: 2,
    message,
    ...(options?.contextInjection
      ? {
          contextInjection: {
            includeWorkspaceContext: options.contextInjection.includeWorkspaceContext === true,
            autoEnrichmentEnabled: options.contextInjection.autoEnrichmentEnabled !== false,
            selectedEnvironmentContextIds: [...new Set(options.contextInjection.selectedEnvironmentContextIds ?? [])],
            selectedTicketContextShas: [...new Set(options.contextInjection.selectedTicketContextShas ?? [])],
            selectedKnowledgeContextShas: [...new Set(options.contextInjection.selectedKnowledgeContextShas ?? [])],
          },
        }
      : {}),
  };

  sessionStorage.setItem(AGENT_CONSOLE_CHAT_DRAFT_STORAGE_KEY, JSON.stringify(payload));
}

/**
 * Reads and removes the stored draft. Returns message text or null if missing/invalid.
 */
export function readAndClearAgentConsoleChatDraft(): {
  message: string;
  contextInjection?: {
    includeWorkspaceContext: boolean;
    autoEnrichmentEnabled: boolean;
    selectedEnvironmentContextIds: string[];
    selectedTicketContextShas?: string[];
    selectedKnowledgeContextShas?: string[];
  };
} | null {
  if (typeof sessionStorage === 'undefined') {
    return null;
  }

  const raw = sessionStorage.getItem(AGENT_CONSOLE_CHAT_DRAFT_STORAGE_KEY);

  if (!raw) {
    return null;
  }

  sessionStorage.removeItem(AGENT_CONSOLE_CHAT_DRAFT_STORAGE_KEY);

  try {
    const data = JSON.parse(raw) as AgentConsoleChatDraftV1 | AgentConsoleChatDraftV2;

    if (data?.v === 2 && typeof data.message === 'string' && data.message.length > 0) {
      return {
        message: data.message,
        ...(data.contextInjection
          ? {
              contextInjection: {
                includeWorkspaceContext: data.contextInjection.includeWorkspaceContext === true,
                autoEnrichmentEnabled: data.contextInjection.autoEnrichmentEnabled !== false,
                selectedEnvironmentContextIds: [...new Set(data.contextInjection.selectedEnvironmentContextIds ?? [])],
                selectedTicketContextShas: [...new Set(data.contextInjection.selectedTicketContextShas ?? [])],
                selectedKnowledgeContextShas: [...new Set(data.contextInjection.selectedKnowledgeContextShas ?? [])],
              },
            }
          : {}),
      };
    }

    if (data?.v === 1 && typeof data.message === 'string' && data.message.length > 0) {
      return { message: data.message };
    }
  } catch {
    // ignore
  }

  return null;
}
