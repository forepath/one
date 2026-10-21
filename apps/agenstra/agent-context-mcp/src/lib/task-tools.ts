import {
  AGENSTRA_TASKS_MCP_TOOL_NAMES,
  AGENT_TASK_LIMITS,
  type AgentTaskCreateInput,
  type AgentTaskUpdateInput,
} from '@forepath/agenstra/shared/util-opencode-config';

import { ContextApiClient, ContextApiError } from './context-api.client';
import type { ContextToolDefinition, ContextToolResult } from './context-tools';

const TASK_ID_PROPERTY = { type: 'string', description: 'Task id from tasks_list.' };

const TASK_FIELD_PROPERTIES = {
  title: { type: 'string', maxLength: AGENT_TASK_LIMITS.titleMaxLength, description: 'Short task name.' },
  prompt: {
    type: 'string',
    maxLength: AGENT_TASK_LIMITS.promptMaxLength,
    description: 'Instructions you receive on every run (self-contained: runs start without chat history).',
  },
  cronExpression: {
    type: 'string',
    maxLength: AGENT_TASK_LIMITS.cronExpressionMaxLength,
    description:
      'Five-field cron expression "minute hour day-of-month month day-of-week", e.g. "0 9 * * 1-5" for ' +
      'weekdays at 09:00. Runs must be at least a few minutes apart.',
  },
  timezone: {
    type: 'string',
    maxLength: AGENT_TASK_LIMITS.timezoneMaxLength,
    description: 'IANA time zone for the cron expression, e.g. "Europe/Berlin" (default UTC).',
  },
  model: {
    type: 'string',
    maxLength: AGENT_TASK_LIMITS.modelMaxLength,
    description: 'OpenCode "provider/model" for runs. Defaults to the model of the current chat.',
  },
  enabled: { type: 'boolean', description: 'Disabled tasks keep their schedule but do not run.' },
  allowedHandoffAgentIds: {
    type: 'array',
    items: { type: 'string' },
    maxItems: AGENT_TASK_LIMITS.allowedHandoffAgentsMax,
    description:
      'Agents of your workspace (ids from handoff_agents) the runs may hand off work to with handoff_create. ' +
      'Only takes effect after a user approved the task; empty means the runs cannot hand off.',
  },
};

export const TASK_TOOL_DEFINITIONS: ContextToolDefinition[] = [
  {
    name: AGENSTRA_TASKS_MCP_TOOL_NAMES.list,
    description:
      'List your recurring tasks (schedule, next / last run, status). Tasks run unattended in a separate ' +
      'session; results are posted to the main chat.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: AGENSTRA_TASKS_MCP_TOOL_NAMES.get,
    description: 'Read one of your tasks including its recent runs and their output.',
    inputSchema: {
      type: 'object',
      properties: { taskId: TASK_ID_PROPERTY },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_TASKS_MCP_TOOL_NAMES.create,
    description:
      'Create a recurring task for yourself. Use it when the user asks for something to happen regularly ' +
      '(reports, checks, maintenance). Confirm the schedule with the user when it is ambiguous. Tasks you create ' +
      'only run after a user approved them in the console (Tasks page); tell the user.',
    inputSchema: {
      type: 'object',
      properties: TASK_FIELD_PROPERTIES,
      required: ['title', 'prompt', 'cronExpression'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_TASKS_MCP_TOOL_NAMES.update,
    description:
      'Change one of your tasks (only the given fields), e.g. pause it with enabled=false. Changing prompt, model, ' +
      'schedule or the allowed handoff agents, or enabling it again, needs a new approval by a user before it runs.',
    inputSchema: {
      type: 'object',
      properties: { taskId: TASK_ID_PROPERTY, ...TASK_FIELD_PROPERTIES },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_TASKS_MCP_TOOL_NAMES.delete,
    description: 'Delete one of your tasks and its run history.',
    inputSchema: {
      type: 'object',
      properties: { taskId: TASK_ID_PROPERTY },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_TASKS_MCP_TOOL_NAMES.run,
    description: 'Queue an immediate run of one of your tasks (in addition to its schedule).',
    inputSchema: {
      type: 'object',
      properties: { taskId: TASK_ID_PROPERTY },
      required: ['taskId'],
      additionalProperties: false,
    },
  },
];

const TASK_TOOL_NAMES = new Set<string>(Object.values(AGENSTRA_TASKS_MCP_TOOL_NAMES));

export function isTaskToolName(name: string): boolean {
  return TASK_TOOL_NAMES.has(name);
}

function text(value: string, isError = false): ContextToolResult {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

function json(value: unknown): ContextToolResult {
  return text(JSON.stringify(value, null, 2));
}

/** Copy the known task fields with the expected primitive types; everything else is dropped. */
function taskFields(args: Record<string, unknown>): AgentTaskUpdateInput {
  const fields: AgentTaskUpdateInput = {};

  for (const key of ['title', 'prompt', 'cronExpression', 'timezone', 'model'] as const) {
    if (typeof args[key] === 'string') {
      fields[key] = args[key] as string;
    }
  }

  if (typeof args['enabled'] === 'boolean') {
    fields.enabled = args['enabled'];
  }

  if (Array.isArray(args['allowedHandoffAgentIds'])) {
    fields.allowedHandoffAgentIds = args['allowedHandoffAgentIds'].filter((id): id is string => typeof id === 'string');
  }

  return fields;
}

/** Dispatch one task tool call. Errors become `isError` results (never thrown to the transport). */
export async function callTaskTool(
  client: ContextApiClient,
  name: string,
  rawArgs: unknown,
): Promise<ContextToolResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
  const taskId = typeof args['taskId'] === 'string' ? args['taskId'].trim() : '';

  if (name !== AGENSTRA_TASKS_MCP_TOOL_NAMES.list && name !== AGENSTRA_TASKS_MCP_TOOL_NAMES.create && !taskId) {
    return text('Missing "taskId": use tasks_list to find it.', true);
  }

  try {
    switch (name) {
      case AGENSTRA_TASKS_MCP_TOOL_NAMES.list:
        return json(await client.listTasks());
      case AGENSTRA_TASKS_MCP_TOOL_NAMES.get:
        return json(await client.getTask(taskId));
      case AGENSTRA_TASKS_MCP_TOOL_NAMES.create: {
        const fields = taskFields(args);

        if (!fields.title || !fields.prompt || !fields.cronExpression) {
          return text('Provide "title", "prompt" and "cronExpression".', true);
        }

        return json(await client.createTask(fields as AgentTaskCreateInput));
      }
      case AGENSTRA_TASKS_MCP_TOOL_NAMES.update: {
        const fields = taskFields(args);

        if (Object.keys(fields).length === 0) {
          return text('Provide at least one field to change.', true);
        }

        return json(await client.updateTask(taskId, fields));
      }
      case AGENSTRA_TASKS_MCP_TOOL_NAMES.delete:
        await client.deleteTask(taskId);

        return text(`Deleted task ${taskId}.`);
      case AGENSTRA_TASKS_MCP_TOOL_NAMES.run:
        return json(await client.runTask(taskId));
      default:
        return text(`Unknown tool: ${name}`, true);
    }
  } catch (error) {
    const message = error instanceof ContextApiError || error instanceof Error ? error.message : 'Task request failed';

    return text(message, true);
  }
}
