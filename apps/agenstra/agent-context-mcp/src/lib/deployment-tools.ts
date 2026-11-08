import {
  AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES,
  AGENT_DEPLOYMENT_RUNS_DEFAULT_LIMIT,
  AGENT_DEPLOYMENT_RUNS_MAX_LIMIT,
  DEPLOYMENT_LIMITS,
  type AgentDeploymentWorkflowUpdateInput,
  type DeploymentTriggerInput,
} from '@forepath/agenstra/shared/util-opencode-config';

import { ContextApiClient, ContextApiError } from './context-api.client';
import type { ContextToolDefinition, ContextToolResult } from './context-tools';

const WORKFLOW_ID_PROPERTY = {
  type: 'string',
  maxLength: 64,
  description: 'Deployment workflow id from deployments_list_workflows.',
};

const TICKET_PROPERTY = {
  type: 'string',
  description: 'Context ticket from the prompt hint (starts with "ctx-").',
};

const RUN_ACTION_DECISIONS =
  'The result is a decision: "applied" (run describes the run), "pending" (the user has not decided yet: call ' +
  'deployments_action_status with the requestId), "denied" (not allowed in this session or rejected by the user) or ' +
  '"failed" (message says why). In a chat with the user they approve each action; scheduled tasks and ticket ' +
  'automation may only do it when a workspace user allowed it for that task / automation; plans never can.';

const WORKFLOW_FIELD_PROPERTIES = {
  connectionId: {
    type: 'string',
    maxLength: 64,
    description: 'Connection id from deployments_list_connections.',
  },
  name: { type: 'string', maxLength: DEPLOYMENT_LIMITS.nameMaxLength, description: 'Short workflow name.' },
  description: {
    type: ['string', 'null'],
    maxLength: DEPLOYMENT_LIMITS.descriptionMaxLength,
    description: 'What the workflow deploys and when to use it (optional).',
  },
  repository: {
    type: 'string',
    maxLength: DEPLOYMENT_LIMITS.repositoryMaxLength,
    description: 'Provider repository: "owner/repo" (GitHub), project id or path (GitLab) or job full name (Jenkins).',
  },
  workflow: {
    type: ['string', 'null'],
    maxLength: DEPLOYMENT_LIMITS.workflowMaxLength,
    description: 'GitHub workflow file (e.g. "deploy.yml") or id; required for GitHub, not used by GitLab / Jenkins.',
  },
  defaultRef: {
    type: ['string', 'null'],
    maxLength: DEPLOYMENT_LIMITS.refMaxLength,
    description:
      'Branch / tag runs deploy (default: the repository default branch). Environments only deploy this ref.',
  },
  defaultInputs: {
    type: 'object',
    maxProperties: DEPLOYMENT_LIMITS.inputsMax,
    additionalProperties: { type: 'string', maxLength: DEPLOYMENT_LIMITS.inputValueMaxLength },
    description:
      'Default inputs / variables / parameters of runs. Only inputs listed here can be overridden when triggering.',
  },
  agentTriggerEnabled: {
    type: 'boolean',
    description:
      'Request permission to trigger and cancel runs yourself (default false). Only request it if you need to run ' +
      'the workflow yourself; it takes effect once a workspace admin approved the workflow.',
  },
  enabled: { type: 'boolean', description: 'Disabled workflows cannot run (default true).' },
};

const RUN_ID_PROPERTY = {
  type: 'string',
  maxLength: 64,
  description: 'Deployment run id from deployments_list_runs or deployments_trigger.',
};

export const DEPLOYMENT_TOOL_DEFINITIONS: ContextToolDefinition[] = [
  {
    name: AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.listWorkflows,
    description:
      'List the CI/CD deployment workflows (GitHub Actions, GitLab CI, Jenkins) available to your environment: ' +
      'enabled workflows of your workspace that are global or assigned to you. Workflows of other environments are ' +
      'not visible. "agentTriggerEnabled" tells whether you may trigger and cancel runs of a workflow; otherwise ' +
      'you can only read its runs. Workflows are configured by workspace admins in the console (Deployments page); ' +
      'workflows you proposed yourself are listed too, with "approvalStatus" (pending ones cannot run yet).',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.getWorkflow,
    description:
      'Read one deployment workflow available to your environment (same visibility as deployments_list_workflows): ' +
      'connection, repository, provider workflow, default ref, default inputs, availability, whether you may ' +
      'trigger it ("agentTriggerEnabled"), its approval status and its last run.',
    inputSchema: {
      type: 'object',
      properties: { workflowId: WORKFLOW_ID_PROPERTY },
      required: ['workflowId'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.syncWorkflow,
    description:
      "Refresh a workflow's run history from the CI/CD provider: imports runs started on the provider and updates " +
      'the status of active ones. Read-only towards the provider (it never starts or stops anything) and only for ' +
      'approved, enabled workflows available to you; one sync per workflow every 30 seconds. Use it before ' +
      'deployments_list_runs when you need runs started outside Agenstra.',
    inputSchema: {
      type: 'object',
      properties: { workflowId: WORKFLOW_ID_PROPERTY },
      required: ['workflowId'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.listRuns,
    description:
      'List recent runs (newest first) of the deployment workflows available to your environment, optionally of ' +
      'one workflow: status (queued / in_progress / completed), conclusion, ref, who triggered it and the provider URL.',
    inputSchema: {
      type: 'object',
      properties: {
        workflowId: { ...WORKFLOW_ID_PROPERTY, description: 'Only runs of this workflow (optional).' },
        limit: {
          type: 'integer',
          minimum: 1,
          maximum: AGENT_DEPLOYMENT_RUNS_MAX_LIMIT,
          description: `Maximum number of runs (default ${AGENT_DEPLOYMENT_RUNS_DEFAULT_LIMIT}).`,
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.getRun,
    description:
      'Read one deployment run with its jobs and their current status (refreshed from the provider while the run ' +
      'is active). Use it to follow a run you triggered until status is "completed".',
    inputSchema: {
      type: 'object',
      properties: { runId: RUN_ID_PROPERTY },
      required: ['runId'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.getRunLogs,
    description:
      'Read the logs of a deployment run, or of one of its jobs (job ids from deployments_get_run). Only the tail ' +
      `is returned (at most ${DEPLOYMENT_LIMITS.agentLogsMaxBytes} bytes; "truncated" is true when cut). Use it to ` +
      'find out why a run failed.',
    inputSchema: {
      type: 'object',
      properties: {
        runId: RUN_ID_PROPERTY,
        jobId: {
          type: 'string',
          maxLength: 255,
          description: 'Job id from deployments_get_run (optional; default: logs of the whole run).',
        },
      },
      required: ['runId'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.trigger,
    description:
      'Start a run of a deployment workflow available to your environment. Only possible when the workflow has ' +
      '"agentTriggerEnabled" (see deployments_list_workflows). Deployments change shared systems: only trigger one ' +
      'when the user asked for it or your task clearly requires it, and report the run (id, URL) to the user. The run ' +
      'is recorded in the workspace audit log as triggered by you. Environments always deploy the workflow default ' +
      'ref and may only override the inputs listed in its "defaultInputs". ' +
      RUN_ACTION_DECISIONS,
    inputSchema: {
      type: 'object',
      properties: {
        ticket: TICKET_PROPERTY,
        workflowId: WORKFLOW_ID_PROPERTY,
        ref: {
          type: 'string',
          maxLength: DEPLOYMENT_LIMITS.refMaxLength,
          description:
            'Only the workflow default ref ("defaultRef") is allowed for environments; omit it to use the default ' +
            '(or the repository default branch when the workflow has none). Any other ref is refused.',
        },
        inputs: {
          type: 'object',
          maxProperties: DEPLOYMENT_LIMITS.inputsMax,
          additionalProperties: { type: 'string', maxLength: DEPLOYMENT_LIMITS.inputValueMaxLength },
          description:
            `Overrides of the workflow defaults ("defaultInputs"); only names listed there are allowed, as string values (at most ${DEPLOYMENT_LIMITS.inputsMax} entries, names up to ` +
            `${DEPLOYMENT_LIMITS.inputKeyMaxLength} characters).`,
        },
      },
      required: ['ticket', 'workflowId'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.cancelRun,
    description:
      'Cancel an active run of a deployment workflow available to your environment. Only possible when the workflow ' +
      'has "agentTriggerEnabled"; completed runs cannot be cancelled. ' +
      RUN_ACTION_DECISIONS,
    inputSchema: {
      type: 'object',
      properties: { ticket: TICKET_PROPERTY, runId: RUN_ID_PROPERTY },
      required: ['ticket', 'runId'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.actionStatus,
    description:
      'Keep waiting on a pending deployments_trigger / deployments_cancel_run (requestId from its result) until the ' +
      'user decided.',
    inputSchema: {
      type: 'object',
      properties: {
        ticket: TICKET_PROPERTY,
        requestId: { type: 'string', maxLength: 128, description: 'requestId of the pending action.' },
      },
      required: ['ticket', 'requestId'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.listConnections,
    description:
      'List the CI/CD connections (id, label, provider, status) your workspace may build deployment workflows on. ' +
      'Use a connection id with deployments_create_workflow. Repositories are not listed: ask the user which ' +
      'repository / workflow to use when it is not clear from your workspace.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.createWorkflow,
    description:
      'Propose a deployment workflow for yourself. The workflow is assigned to your environment only and waits for ' +
      'approval by a workspace admin (console, Deployments page) before it can run; tell the user. Request ' +
      '"agentTriggerEnabled" only if you need to run it yourself.',
    inputSchema: {
      type: 'object',
      properties: WORKFLOW_FIELD_PROPERTIES,
      required: ['connectionId', 'name', 'repository'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.updateWorkflow,
    description:
      'Change a deployment workflow you created for yourself (only workflows assigned to your environment alone). ' +
      'Changes need approval by a workspace admin again before runs can start; disabling keeps the approval. Only ' +
      'pass the fields to change.',
    inputSchema: {
      type: 'object',
      properties: { workflowId: WORKFLOW_ID_PROPERTY, ...WORKFLOW_FIELD_PROPERTIES },
      required: ['workflowId'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.deleteWorkflow,
    description:
      'Delete a deployment workflow you created for yourself (only workflows assigned to your environment alone). ' +
      'Its run history is deleted with it.',
    inputSchema: {
      type: 'object',
      properties: { workflowId: WORKFLOW_ID_PROPERTY },
      required: ['workflowId'],
      additionalProperties: false,
    },
  },
];

const DEPLOYMENT_TOOL_NAMES = new Set<string>(Object.values(AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES));

export function isDeploymentToolName(name: string): boolean {
  return DEPLOYMENT_TOOL_NAMES.has(name);
}

function text(value: string, isError = false): ContextToolResult {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

function json(value: unknown): ContextToolResult {
  return text(JSON.stringify(value, null, 2));
}

function trimmedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Validate trigger inputs locally (string / number / boolean values, bounded); returns an error message instead. */
function triggerInputs(raw: unknown): Record<string, string> | string {
  if (raw === undefined || raw === null) {
    return {};
  }

  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return '"inputs" must be an object of string values.';
  }

  const entries = Object.entries(raw as Record<string, unknown>);

  if (entries.length > DEPLOYMENT_LIMITS.inputsMax) {
    return `"inputs" may contain at most ${DEPLOYMENT_LIMITS.inputsMax} entries.`;
  }

  const inputs: Record<string, string> = {};

  for (const [key, value] of entries) {
    const name = key.trim();

    if (!name || name.length > DEPLOYMENT_LIMITS.inputKeyMaxLength) {
      return `Input names must be 1-${DEPLOYMENT_LIMITS.inputKeyMaxLength} characters.`;
    }

    if (typeof value !== 'string' && typeof value !== 'number' && typeof value !== 'boolean') {
      return `Input "${name}" must be a string.`;
    }

    const stringValue = String(value);

    if (stringValue.length > DEPLOYMENT_LIMITS.inputValueMaxLength) {
      return `Input "${name}" must be at most ${DEPLOYMENT_LIMITS.inputValueMaxLength} characters.`;
    }

    inputs[name] = stringValue;
  }

  return inputs;
}

const NULLABLE_WORKFLOW_FIELDS = ['description', 'workflow', 'defaultRef'] as const;

/** Workflow fields of a create / update call (types checked locally, bounds by the manager). */
function workflowFields(args: Record<string, unknown>): AgentDeploymentWorkflowUpdateInput | string {
  const fields: AgentDeploymentWorkflowUpdateInput = {};

  for (const key of ['connectionId', 'name', 'repository'] as const) {
    if (args[key] === undefined) {
      continue;
    }

    if (typeof args[key] !== 'string') {
      return `"${key}" must be a string.`;
    }

    fields[key] = (args[key] as string).trim();
  }

  for (const key of NULLABLE_WORKFLOW_FIELDS) {
    if (args[key] === undefined) {
      continue;
    }

    if (args[key] !== null && typeof args[key] !== 'string') {
      return `"${key}" must be a string or null.`;
    }

    fields[key] = args[key] as string | null;
  }

  if (args['defaultInputs'] !== undefined) {
    const inputs = triggerInputs(args['defaultInputs']);

    if (typeof inputs === 'string') {
      return inputs.replace('"inputs"', '"defaultInputs"');
    }

    fields.defaultInputs = inputs;
  }

  for (const key of ['agentTriggerEnabled', 'enabled'] as const) {
    if (args[key] === undefined) {
      continue;
    }

    if (typeof args[key] !== 'boolean') {
      return `"${key}" must be true or false.`;
    }

    fields[key] = args[key] as boolean;
  }

  return fields;
}

/** Dispatch one deployment tool call. Errors become `isError` results (never thrown to the transport). */
export async function callDeploymentTool(
  client: ContextApiClient,
  name: string,
  rawArgs: unknown,
): Promise<ContextToolResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
  const runId = trimmedString(args['runId']);
  const workflowId = trimmedString(args['workflowId']);
  const ticket = trimmedString(args['ticket']);
  const missingTicket = () =>
    text('Missing "ticket": pass the context ticket from the prompt hint (starts with "ctx-").', true);

  try {
    switch (name) {
      case AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.listWorkflows:
        return json(await client.listDeploymentWorkflows());
      case AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.listRuns: {
        const limit = args['limit'];

        if (
          limit !== undefined &&
          (typeof limit !== 'number' ||
            !Number.isInteger(limit) ||
            limit < 1 ||
            limit > AGENT_DEPLOYMENT_RUNS_MAX_LIMIT)
        ) {
          return text(`"limit" must be an integer between 1 and ${AGENT_DEPLOYMENT_RUNS_MAX_LIMIT}.`, true);
        }

        return json(
          await client.listDeploymentRuns({
            ...(workflowId ? { workflowId } : {}),
            ...(typeof limit === 'number' ? { limit } : {}),
          }),
        );
      }
      case AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.getRun:
        if (!runId) {
          return text('Missing "runId": use deployments_list_runs to find it.', true);
        }

        return json(await client.getDeploymentRun(runId));
      case AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.getRunLogs: {
        if (!runId) {
          return text('Missing "runId": use deployments_list_runs to find it.', true);
        }

        const jobId = trimmedString(args['jobId']);

        return json(await client.getDeploymentRunLogs(runId, jobId || undefined));
      }
      case AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.trigger: {
        if (!ticket) {
          return missingTicket();
        }

        if (!workflowId) {
          return text('Missing "workflowId": use deployments_list_workflows to find it.', true);
        }

        const inputs = triggerInputs(args['inputs']);

        if (typeof inputs === 'string') {
          return text(inputs, true);
        }

        const ref = trimmedString(args['ref']);

        if (ref.length > DEPLOYMENT_LIMITS.refMaxLength) {
          return text(`"ref" must be at most ${DEPLOYMENT_LIMITS.refMaxLength} characters.`, true);
        }

        const input: DeploymentTriggerInput = {
          ...(ref ? { ref } : {}),
          ...(Object.keys(inputs).length > 0 ? { inputs } : {}),
        };

        return json(await client.triggerDeployment(ticket, workflowId, input));
      }
      case AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.cancelRun:
        if (!ticket) {
          return missingTicket();
        }

        if (!runId) {
          return text('Missing "runId": use deployments_list_runs to find it.', true);
        }

        return json(await client.cancelDeploymentRun(ticket, runId));
      case AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.actionStatus: {
        const requestId = trimmedString(args['requestId']);

        if (!ticket) {
          return missingTicket();
        }

        if (!requestId) {
          return text('Missing "requestId".', true);
        }

        return json(await client.deploymentActionStatus(ticket, requestId));
      }
      case AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.listConnections:
        return json(await client.listDeploymentConnections());
      case AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.createWorkflow: {
        const fields = workflowFields(args);

        if (typeof fields === 'string') {
          return text(fields, true);
        }

        if (!fields.connectionId || !fields.name || !fields.repository) {
          return text(
            '"connectionId" (from deployments_list_connections), "name" and "repository" are required.',
            true,
          );
        }

        return json(
          await client.createDeploymentWorkflow({
            ...fields,
            connectionId: fields.connectionId,
            name: fields.name,
            repository: fields.repository,
          }),
        );
      }
      case AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.updateWorkflow: {
        if (!workflowId) {
          return text('Missing "workflowId": use deployments_list_workflows to find it.', true);
        }

        const fields = workflowFields(args);

        if (typeof fields === 'string') {
          return text(fields, true);
        }

        if (Object.keys(fields).length === 0) {
          return text('Pass at least one field to change.', true);
        }

        return json(await client.updateDeploymentWorkflow(workflowId, fields));
      }
      case AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.getWorkflow:
        if (!workflowId) {
          return text('Missing "workflowId": use deployments_list_workflows to find it.', true);
        }

        return json(await client.getDeploymentWorkflow(workflowId));
      case AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.syncWorkflow:
        if (!workflowId) {
          return text('Missing "workflowId": use deployments_list_workflows to find it.', true);
        }

        return json(await client.syncDeploymentWorkflow(workflowId));
      case AGENSTRA_DEPLOYMENTS_MCP_TOOL_NAMES.deleteWorkflow:
        if (!workflowId) {
          return text('Missing "workflowId": use deployments_list_workflows to find it.', true);
        }

        await client.deleteDeploymentWorkflow(workflowId);

        return text(`Deleted deployment workflow ${workflowId}.`);
      default:
        return text(`Unknown tool: ${name}`, true);
    }
  } catch (error) {
    const message =
      error instanceof ContextApiError || error instanceof Error ? error.message : 'Deployment request failed';

    return text(message, true);
  }
}
