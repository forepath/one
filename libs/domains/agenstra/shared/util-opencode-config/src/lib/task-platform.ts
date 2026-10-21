/**
 * Recurring agent tasks. Tasks are stored and scheduled by the agent-controller (BullMQ) and managed
 * in the console (`/tasks/:clientId`) or by the agent itself through the platform `agenstra` MCP server
 * (`agenstra_tasks_*` tools). Runs execute in hidden, unattended `-task-{taskId}` OpenCode sessions.
 */

/** OpenCode names MCP tools `<server>_<tool>`, so the agent sees `agenstra_tasks_*`. */
export const AGENSTRA_TASKS_MCP_TOOL_NAMES = {
  list: 'tasks_list',
  get: 'tasks_get',
  create: 'tasks_create',
  update: 'tasks_update',
  delete: 'tasks_delete',
  run: 'tasks_run',
} as const;

/** OpenCode permission key covering every task tool (wildcard on the tool id). */
export const AGENSTRA_TASKS_MCP_TOOL_PERMISSION = 'agenstra_tasks_*';

/**
 * Manager route segment below the agent context API route (`/api/agent-context/tasks`), so the
 * agent-token authentication and the egress exception of the context API apply unchanged.
 */
export const AGENSTRA_TASKS_API_SEGMENT = 'tasks';

/** Socket.IO event (manager → controller, with ack) that reads / writes the tasks of one agent. */
export const AGENT_TASK_REQUEST_EVENT = 'agentTaskRequest';

/** Prefix of the hidden OpenCode session a task run executes in (`-task-{taskId}`). */
export const AGENT_TASK_RESUME_SESSION_SUFFIX_PREFIX = '-task-';

export function buildAgentTaskResumeSessionSuffix(taskId: string): string {
  return `${AGENT_TASK_RESUME_SESSION_SUFFIX_PREFIX}${taskId}`;
}

export function isAgentTaskResumeSessionSuffix(suffix: string | undefined): boolean {
  return (
    typeof suffix === 'string' &&
    suffix.startsWith(AGENT_TASK_RESUME_SESSION_SUFFIX_PREFIX) &&
    suffix.length > AGENT_TASK_RESUME_SESSION_SUFFIX_PREFIX.length
  );
}

/** Input bounds shared by the console, the manager API and the controller (authoritative validation). */
export const AGENT_TASK_LIMITS = {
  titleMaxLength: 200,
  promptMaxLength: 20_000,
  cronExpressionMaxLength: 128,
  timezoneMaxLength: 64,
  modelMaxLength: 256,
} as const;

export type AgentTaskRunStatus = 'running' | 'succeeded' | 'failed';

/** Who created / last changed a task: a console user or the agent (MCP tools). */
export type AgentTaskActorType = 'user' | 'agent';

export type AgentTaskRunTrigger = 'schedule' | 'manual';

export interface AgentTaskSummary {
  id: string;
  agentId: string;
  title: string;
  prompt: string;
  /** Five-field cron expression (minute hour day-of-month month day-of-week). */
  cronExpression: string;
  /** IANA time zone the cron expression is evaluated in. */
  timezone: string;
  /** OpenCode `provider/model` used for runs. */
  model: string;
  enabled: boolean;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: AgentTaskRunStatus | null;
  createdBy: AgentTaskActorType;
  updatedBy: AgentTaskActorType;
  createdAt: string;
  updatedAt: string;
}

export interface AgentTaskRunSummary {
  id: string;
  taskId: string;
  agentId: string;
  trigger: AgentTaskRunTrigger;
  status: AgentTaskRunStatus;
  scheduledFor: string;
  startedAt: string;
  finishedAt: string | null;
  /** Tail of the agent's final answer (bounded). */
  outputExcerpt: string | null;
  failureMessage: string | null;
}

export interface AgentTaskCreateInput {
  title: string;
  prompt: string;
  cronExpression: string;
  /** Defaults to UTC. */
  timezone?: string;
  /** Defaults to the model of the agent's current chat when created through the MCP server. */
  model?: string;
  /** Defaults to true. */
  enabled?: boolean;
}

export type AgentTaskUpdateInput = Partial<AgentTaskCreateInput>;

export interface AgentTaskListResponse {
  tasks: AgentTaskSummary[];
}

export interface AgentTaskDetailResponse {
  task: AgentTaskSummary;
  runs: AgentTaskRunSummary[];
}

export interface AgentTaskRunNowResponse {
  taskId: string;
  queued: boolean;
  message?: string;
}

/** Manager → controller request (Socket.IO ack). `agentId` is the authenticated agent of the MCP call. */
export type AgentTaskControllerRequest =
  | { op: 'list'; agentId: string }
  | { op: 'get'; agentId: string; taskId: string }
  | { op: 'create'; agentId: string; input: AgentTaskCreateInput }
  | { op: 'update'; agentId: string; taskId: string; input: AgentTaskUpdateInput }
  | { op: 'delete'; agentId: string; taskId: string }
  | { op: 'run'; agentId: string; taskId: string };

export type AgentTaskControllerResponse =
  | {
      ok: true;
      tasks?: AgentTaskSummary[];
      task?: AgentTaskSummary;
      runs?: AgentTaskRunSummary[];
      deleted?: boolean;
      queued?: boolean;
    }
  /** `status` mirrors the HTTP status the controller would have answered with (400, 404, ...). */
  | { ok: false; error: string; status?: number };
