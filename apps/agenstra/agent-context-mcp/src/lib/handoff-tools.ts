import {
  AGENSTRA_HANDOFF_MCP_TOOL_NAMES,
  AGENT_HANDOFF_LIMITS,
  isAgentHandoffResponseStatus,
  type AgentHandoffSummary,
} from '@forepath/agenstra/shared/util-opencode-config';

import { ContextApiClient, ContextApiError } from './context-api.client';
import type { ContextToolDefinition, ContextToolResult } from './context-tools';

const HANDOFF_ID_PROPERTY = { type: 'string', description: 'Handoff id (from handoff_create or the handoff message).' };

export const HANDOFF_TOOL_DEFINITIONS: ContextToolDefinition[] = [
  {
    name: AGENSTRA_HANDOFF_MCP_TOOL_NAMES.agents,
    description:
      'List the other agents of your workspace (id, name, description, handoff profile, container type, repository) ' +
      'plus your own entry. Use it whenever a task touches an area another agent owns (another repository, service, ' +
      'infrastructure) or would benefit from its knowledge, to gather information or offload work with handoff_create. ' +
      'For a peer without handoff profile call handoff_profile_get. Keep your own profile current with ' +
      'handoff_profile_update.',
    inputSchema: { type: 'object', properties: {}, additionalProperties: false },
  },
  {
    name: AGENSTRA_HANDOFF_MCP_TOOL_NAMES.profileGet,
    description:
      'Read the metadata and handoff profile (responsibilities, what it can take over) of one agent of your ' +
      'workspace. A missing profile is generated first: the agent describes itself, which can take a minute or two.',
    inputSchema: {
      type: 'object',
      properties: { targetAgentId: { type: 'string', description: 'Agent id from handoff_agents.' } },
      required: ['targetAgentId'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_HANDOFF_MCP_TOOL_NAMES.profileUpdate,
    description:
      'Set your own handoff profile: what your environment and repository are, which areas and tasks you can take ' +
      'over and what you cannot do. Other agents read it to decide what to hand over to you. An empty profile clears it.',
    inputSchema: {
      type: 'object',
      properties: {
        profile: {
          type: 'string',
          maxLength: AGENT_HANDOFF_LIMITS.profileMaxLength,
          description: 'Profile text (plain text or short markdown).',
        },
      },
      required: ['profile'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_HANDOFF_MCP_TOOL_NAMES.create,
    description:
      'Hand a task over to another agent of your workspace. The agent works on it in a new chat and its answer ' +
      'arrives in this chat as a new message once it is done — do not poll or wait for it, finish your turn. ' +
      'The message must be self-contained: the other agent does not see this conversation. Only possible from a ' +
      'visible chat while no other session of yours is working (not from task runs or ticket automation).',
    inputSchema: {
      type: 'object',
      properties: {
        targetAgentId: { type: 'string', description: 'Agent id from handoff_agents.' },
        title: {
          type: 'string',
          maxLength: AGENT_HANDOFF_LIMITS.titleMaxLength,
          description: 'Short name of the task (used as chat title).',
        },
        message: {
          type: 'string',
          maxLength: AGENT_HANDOFF_LIMITS.messageMaxLength,
          description: 'Complete task description incl. context, constraints and the expected result.',
        },
        model: {
          type: 'string',
          description: 'Optional OpenCode "provider/model" for the other agent. Defaults to its usual model.',
        },
      },
      required: ['targetAgentId', 'title', 'message'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_HANDOFF_MCP_TOOL_NAMES.get,
    description:
      'Read the status, the response (once available) and the delivery state of a handoff you created or received. ' +
      'delivery "undeliverable" means the requesting chat no longer exists (see deliveryFailureMessage).',
    inputSchema: {
      type: 'object',
      properties: { handoffId: HANDOFF_ID_PROPERTY },
      required: ['handoffId'],
      additionalProperties: false,
    },
  },
  {
    name: AGENSTRA_HANDOFF_MCP_TOOL_NAMES.respond,
    description:
      'Answer a handoff you received. Call it exactly once when you are done, or with status "failed" when you ' +
      'cannot complete the task. The requesting agent only receives the response text, so make it self-contained.',
    inputSchema: {
      type: 'object',
      properties: {
        handoffId: HANDOFF_ID_PROPERTY,
        status: { type: 'string', enum: ['completed', 'failed'], description: 'Outcome of the task.' },
        response: {
          type: 'string',
          maxLength: AGENT_HANDOFF_LIMITS.responseMaxLength,
          description: 'Result for the requesting agent (findings, changes, open points).',
        },
      },
      required: ['handoffId', 'status', 'response'],
      additionalProperties: false,
    },
  },
];

const HANDOFF_TOOL_NAMES = new Set<string>(Object.values(AGENSTRA_HANDOFF_MCP_TOOL_NAMES));

export function isHandoffToolName(name: string): boolean {
  return HANDOFF_TOOL_NAMES.has(name);
}

function text(value: string, isError = false): ContextToolResult {
  return { content: [{ type: 'text', text: value }], ...(isError ? { isError: true } : {}) };
}

function json(value: unknown): ContextToolResult {
  return text(JSON.stringify(value, null, 2));
}

function stringArg(args: Record<string, unknown>, key: string): string {
  return typeof args[key] === 'string' ? (args[key] as string).trim() : '';
}

/**
 * `handoffId` sits at the top level of the create result: the agent-manager reads it from the tool result in the
 * chat stream to bind the handoff to the chat it was made in.
 */
function createdResult(handoff: AgentHandoffSummary): ContextToolResult {
  return json({
    handoffId: handoff.id,
    status: handoff.status,
    title: handoff.title,
    targetAgentId: handoff.targetAgentId,
    targetAgentName: handoff.targetAgentName,
    targetChatId: handoff.targetChatId,
    note: 'The response will arrive in this chat as a new message. Do not poll; continue or end your turn.',
  });
}

/** Dispatch one handoff tool call. Errors become `isError` results (never thrown to the transport). */
export async function callHandoffTool(
  client: ContextApiClient,
  name: string,
  rawArgs: unknown,
): Promise<ContextToolResult> {
  const args = (rawArgs && typeof rawArgs === 'object' ? rawArgs : {}) as Record<string, unknown>;
  const handoffId = stringArg(args, 'handoffId');

  if (
    (name === AGENSTRA_HANDOFF_MCP_TOOL_NAMES.get || name === AGENSTRA_HANDOFF_MCP_TOOL_NAMES.respond) &&
    !handoffId
  ) {
    return text('Missing "handoffId".', true);
  }

  if (name === AGENSTRA_HANDOFF_MCP_TOOL_NAMES.profileGet && !stringArg(args, 'targetAgentId')) {
    return text('Missing "targetAgentId": use handoff_agents to find it.', true);
  }

  try {
    switch (name) {
      case AGENSTRA_HANDOFF_MCP_TOOL_NAMES.agents: {
        const listing = await client.listHandoffAgents();

        return json({
          ...listing,
          ...(listing.self?.handoffProfile
            ? {}
            : { hint: 'Your own handoff profile is empty: describe yourself with handoff_profile_update.' }),
        });
      }
      case AGENSTRA_HANDOFF_MCP_TOOL_NAMES.profileGet:
        return json(await client.getHandoffProfile(stringArg(args, 'targetAgentId')));
      case AGENSTRA_HANDOFF_MCP_TOOL_NAMES.profileUpdate: {
        if (typeof args['profile'] !== 'string') {
          return text('Provide "profile" (an empty string clears it).', true);
        }

        return json(await client.updateHandoffProfile({ profile: args['profile'] }));
      }
      case AGENSTRA_HANDOFF_MCP_TOOL_NAMES.create: {
        const targetAgentId = stringArg(args, 'targetAgentId');
        const title = stringArg(args, 'title');
        const message = stringArg(args, 'message');
        const model = stringArg(args, 'model');

        if (!targetAgentId || !title || !message) {
          return text('Provide "targetAgentId" (see handoff_agents), "title" and "message".', true);
        }

        const { handoff } = await client.createHandoff({ targetAgentId, title, message, ...(model ? { model } : {}) });

        return createdResult(handoff);
      }
      case AGENSTRA_HANDOFF_MCP_TOOL_NAMES.get:
        return json(await client.getHandoff(handoffId));
      case AGENSTRA_HANDOFF_MCP_TOOL_NAMES.respond: {
        const status = args['status'];
        const response = stringArg(args, 'response');

        if (!isAgentHandoffResponseStatus(status) || !response) {
          return text('Provide "status" ("completed" or "failed") and a non-empty "response".', true);
        }

        await client.respondToHandoff(handoffId, { status, response });

        return text('Response recorded. It is delivered to the requesting agent when your turn ends.');
      }
      default:
        return text(`Unknown tool: ${name}`, true);
    }
  } catch (error) {
    const message =
      error instanceof ContextApiError || error instanceof Error ? error.message : 'Handoff request failed';

    return text(message, true);
  }
}
