import {
  AGENT_TASK_LIMITS,
  type AgentTaskCreateInput,
  type AgentTaskUpdateInput,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const STRING_FIELDS: Array<{ key: keyof AgentTaskUpdateInput & string; maxLength: number }> = [
  { key: 'title', maxLength: AGENT_TASK_LIMITS.titleMaxLength },
  { key: 'prompt', maxLength: AGENT_TASK_LIMITS.promptMaxLength },
  { key: 'cronExpression', maxLength: AGENT_TASK_LIMITS.cronExpressionMaxLength },
  { key: 'timezone', maxLength: AGENT_TASK_LIMITS.timezoneMaxLength },
  { key: 'model', maxLength: AGENT_TASK_LIMITS.modelMaxLength },
];

/**
 * The agent-manager has no global ValidationPipe, so agent-facing task input is normalized here. Shape and
 * bounds only — the controller validates schedule, time zone and model semantics.
 */
function parseTaskFields(raw: unknown): AgentTaskUpdateInput {
  const body = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const fields: AgentTaskUpdateInput = {};

  for (const { key, maxLength } of STRING_FIELDS) {
    const value = body[key];

    if (value === undefined) {
      continue;
    }

    if (typeof value !== 'string' || !value.trim()) {
      throw new BadRequestException(`${key} must be a non-empty string`);
    }

    if (value.trim().length > maxLength) {
      throw new BadRequestException(`${key} must be at most ${maxLength} characters`);
    }

    (fields as Record<string, string>)[key] = value.trim();
  }

  if (body['enabled'] !== undefined) {
    if (typeof body['enabled'] !== 'boolean') {
      throw new BadRequestException('enabled must be a boolean');
    }

    fields.enabled = body['enabled'];
  }

  if (body['allowedHandoffAgentIds'] !== undefined) {
    const ids = body['allowedHandoffAgentIds'];

    if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string' || !UUID_V4.test(id.trim()))) {
      throw new BadRequestException('allowedHandoffAgentIds must be a list of agent ids');
    }

    if (ids.length > AGENT_TASK_LIMITS.allowedHandoffAgentsMax) {
      throw new BadRequestException(
        `allowedHandoffAgentIds may list at most ${AGENT_TASK_LIMITS.allowedHandoffAgentsMax} agents`,
      );
    }

    fields.allowedHandoffAgentIds = ids.map((id: string) => id.trim().toLowerCase());
  }

  return fields;
}

export function parseAgentTaskCreate(raw: unknown): AgentTaskCreateInput {
  const fields = parseTaskFields(raw);

  if (!fields.title || !fields.prompt || !fields.cronExpression) {
    throw new BadRequestException('title, prompt and cronExpression are required');
  }

  return fields as AgentTaskCreateInput;
}

export function parseAgentTaskUpdate(raw: unknown): AgentTaskUpdateInput {
  const fields = parseTaskFields(raw);

  if (Object.keys(fields).length === 0) {
    throw new BadRequestException('Provide at least one field to change');
  }

  return fields;
}

/** Unknown / malformed ids are reported like missing tasks (no hint about other agents' tasks). */
export function parseAgentTaskId(raw: string | undefined): string {
  const id = raw?.trim() ?? '';

  if (!UUID_V4.test(id)) {
    throw new NotFoundException('Task not found');
  }

  return id.toLowerCase();
}
