/** Repeatable coordinator: claims due task occurrences and enqueues unit jobs (keep in sync with job-registry). */
export const AGENT_TASK_COORDINATOR_JOB_NAME = 'agent-task.coordinator';

/** One task occurrence (`{ taskId, scheduledFor, trigger }`) executed against the agent (keep in sync with job-registry). */
export const AGENT_TASK_UNIT_JOB_NAME = 'agent-task.unit';

/** BullMQ jobId namespace for unit jobs: `agent-task.<taskId>.<scheduledFor ms>`. */
export const AGENT_TASK_UNIT_JOB_ID_NAMESPACE = 'agent-task';

/** Socket.IO events on the `clients` namespace (server → client). */
export const AGENT_TASK_SOCKET_EVENTS = {
  /** Run card for the agent's main chat (like `ticketAutomationRunChatUpsert`). */
  runChatUpsert: 'agentTaskRunChatUpsert',
  /** Full task row for the `/tasks` page. */
  taskUpsert: 'agentTaskUpsert',
  taskRemoved: 'agentTaskRemoved',
} as const;

/** Upper bound of tasks per agent (agent-created tasks included). */
export function getAgentTasksMaxPerAgent(): number {
  return positiveIntFromEnv('AGENT_TASKS_MAX_PER_AGENT', 25);
}

/** Minimum distance between two scheduled occurrences of one task. */
export function getAgentTaskMinIntervalMs(): number {
  return positiveIntFromEnv('AGENT_TASK_MIN_INTERVAL_MINUTES', 5) * 60_000;
}

/** How long one run may wait for the agent's answer. */
export function getAgentTaskRunTimeoutMs(): number {
  return positiveIntFromEnv('AGENT_TASK_RUN_TIMEOUT_MS', 1_800_000);
}

/** Runs still `running` this long after their timeout are marked failed (worker restart, lost job). */
export const AGENT_TASK_STALE_RUN_GRACE_MS = 10 * 60_000;

/**
 * How long a run waits for the response to one of its handoffs (`awaiting_handoff`). After that the handoff is
 * failed, the failure is delivered into the run's session and the run ends once it reacted.
 */
export function getAgentTaskHandoffWaitTimeoutMs(): number {
  return positiveIntFromEnv('AGENT_TASK_HANDOFF_WAIT_TIMEOUT_MS', 3_600_000);
}

/** Handoffs one run may make in total (one open at a time), so a run cannot fan out. */
export function getAgentTaskRunMaxHandoffs(): number {
  return positiveIntFromEnv('AGENT_TASK_RUN_MAX_HANDOFFS', 3);
}

/** Bounded tail of the agent's answer stored on the run. */
export const AGENT_TASK_RUN_EXCERPT_MAX_LENGTH = 4_000;

/** Runs returned with a task detail (REST + MCP). */
export const AGENT_TASK_RUNS_DEFAULT_LIMIT = 10;
export const AGENT_TASK_RUNS_MAX_LIMIT = 50;

/** Post-login chat hydration of run cards (per agent + client). */
export const AGENT_TASK_CHAT_HYDRATE_LIMIT = 100;
export const AGENT_TASK_CHAT_HYDRATE_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

function positiveIntFromEnv(key: string, fallback: number): number {
  const parsed = parseInt(process.env[key] ?? '', 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
