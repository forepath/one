/** Matches server `AGENT_TASK_SOCKET_EVENTS` on the agent-controller `clients` namespace. */
export const CLIENT_CHAT_AGENT_TASK_SOCKET_EVENT = 'agentTaskRunChatUpsert' as const;

/** Task rows for the `/tasks` page (created / changed by users or by the agent itself). */
export const CLIENT_AGENT_TASK_UPSERT_SOCKET_EVENT = 'agentTaskUpsert' as const;

export const CLIENT_AGENT_TASK_REMOVED_SOCKET_EVENT = 'agentTaskRemoved' as const;
