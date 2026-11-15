import {
  AGENT_DEPLOYMENT_RUNS_MAX_LIMIT,
  DEPLOYMENT_LIMITS,
  type AgentDeploymentWorkflowInput,
  type AgentDeploymentWorkflowUpdateInput,
  type DeploymentTriggerInput,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
/** Provider job ids (GitHub / GitLab numeric ids, Jenkins stage / node ids). */
const JOB_ID = /^[\w.:-]{1,255}$/;
// eslint-disable-next-line no-control-regex -- control characters are exactly what is rejected
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
/** Context tickets are `ctx-<base64url>`; anything longer is not a ticket. */
const TICKET_MAX_LENGTH = 128;
const REQUEST_ID_MAX_LENGTH = 128;

/**
 * The agent-manager has no global ValidationPipe, so agent-facing deployment input is normalized here. Shape and
 * bounds only — the controller decides which workflows / runs the agent may see, trigger or cancel.
 */

/** Unknown / malformed ids are reported like missing workflows (no hint about other workspaces / environments). */
export function parseAgentDeploymentWorkflowId(raw: string | undefined): string {
  const id = raw?.trim() ?? '';

  if (!UUID_V4.test(id)) {
    throw new NotFoundException('Deployment workflow not found');
  }

  return id.toLowerCase();
}

export function parseAgentDeploymentRunId(raw: string | undefined): string {
  const id = raw?.trim() ?? '';

  if (!UUID_V4.test(id)) {
    throw new NotFoundException('Deployment run not found');
  }

  return id.toLowerCase();
}

export function parseAgentDeploymentJobId(raw: string | undefined): string | undefined {
  if (raw === undefined) {
    return undefined;
  }

  const id = raw.trim();

  if (!id) {
    return undefined;
  }

  if (!JOB_ID.test(id)) {
    throw new BadRequestException('jobId is invalid');
  }

  return id;
}

export function parseAgentDeploymentRunsQuery(
  workflowId: string | undefined,
  limit: string | undefined,
): { workflowId?: string; limit?: number } {
  const query: { workflowId?: string; limit?: number } = {};

  if (workflowId !== undefined && workflowId.trim()) {
    query.workflowId = parseAgentDeploymentWorkflowId(workflowId);
  }

  if (limit !== undefined && limit.trim()) {
    const value = Number(limit.trim());

    if (!Number.isInteger(value) || value < 1 || value > AGENT_DEPLOYMENT_RUNS_MAX_LIMIT) {
      throw new BadRequestException(`limit must be an integer between 1 and ${AGENT_DEPLOYMENT_RUNS_MAX_LIMIT}`);
    }

    query.limit = value;
  }

  return query;
}

export function parseAgentDeploymentTrigger(raw: unknown): DeploymentTriggerInput {
  if (raw !== undefined && raw !== null && (typeof raw !== 'object' || Array.isArray(raw))) {
    throw new BadRequestException('Body must be an object');
  }

  const body = (raw ?? {}) as Record<string, unknown>;
  const input: DeploymentTriggerInput = {};

  if (body['ref'] !== undefined && body['ref'] !== null) {
    const ref = body['ref'];

    if (typeof ref !== 'string' || !ref.trim() || CONTROL_CHARS.test(ref)) {
      throw new BadRequestException('ref must be a non-empty string');
    }

    if (ref.trim().length > DEPLOYMENT_LIMITS.refMaxLength) {
      throw new BadRequestException(`ref must be at most ${DEPLOYMENT_LIMITS.refMaxLength} characters`);
    }

    input.ref = ref.trim();
  }

  if (body['inputs'] !== undefined && body['inputs'] !== null) {
    input.inputs = parseInputs(body['inputs']);
  }

  return input;
}

function parseInputs(raw: unknown, field = 'inputs'): Record<string, string> {
  if (typeof raw !== 'object' || Array.isArray(raw) || raw === null) {
    throw new BadRequestException(`${field} must be an object of string values`);
  }

  const entries = Object.entries(raw as Record<string, unknown>);

  if (entries.length > DEPLOYMENT_LIMITS.inputsMax) {
    throw new BadRequestException(`${field} may contain at most ${DEPLOYMENT_LIMITS.inputsMax} entries`);
  }

  const inputs: Record<string, string> = {};

  for (const [key, value] of entries) {
    const name = key.trim();

    if (!name || name.length > DEPLOYMENT_LIMITS.inputKeyMaxLength || CONTROL_CHARS.test(name)) {
      throw new BadRequestException(`input names must be 1-${DEPLOYMENT_LIMITS.inputKeyMaxLength} characters`);
    }

    if (typeof value !== 'string') {
      throw new BadRequestException(`input "${name}" must be a string`);
    }

    if (value.length > DEPLOYMENT_LIMITS.inputValueMaxLength) {
      throw new BadRequestException(
        `input "${name}" must be at most ${DEPLOYMENT_LIMITS.inputValueMaxLength} characters`,
      );
    }

    inputs[name] = value;
  }

  return inputs;
}

/**
 * Context ticket of the prompt (`ticket` of trigger / cancel bodies, `?ticket=` of the status route). Unknown tickets
 * are rejected by the ticket store (404); this only rejects what cannot be a ticket.
 */
export function parseAgentDeploymentTicket(raw: unknown): string {
  const ticket = typeof raw === 'string' ? raw.trim() : '';

  if (!ticket || ticket.length > TICKET_MAX_LENGTH || CONTROL_CHARS.test(ticket)) {
    throw new BadRequestException(
      'ticket is required: pass the context ticket from the prompt hint (starts with "ctx-")',
    );
  }

  return ticket;
}

/** Ticket of a JSON body (trigger / cancel). */
export function parseAgentDeploymentBodyTicket(raw: unknown): string {
  const body = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;

  return parseAgentDeploymentTicket(body['ticket']);
}

/** Pending action ids are opaque; malformed ones are reported like expired requests. */
export function parseAgentDeploymentRequestId(raw: string | undefined): string {
  const id = raw?.trim() ?? '';

  if (!id || id.length > REQUEST_ID_MAX_LENGTH || !/^[\w-]+$/.test(id)) {
    throw new NotFoundException('Unknown or expired deployment action request');
  }

  return id;
}

function requiredLine(body: Record<string, unknown>, field: string, maxLength: number): string {
  const value = body[field];

  if (typeof value !== 'string' || !value.trim() || CONTROL_CHARS.test(value)) {
    throw new BadRequestException(`${field} must be a non-empty single-line string`);
  }

  if (value.trim().length > maxLength) {
    throw new BadRequestException(`${field} must be at most ${maxLength} characters`);
  }

  return value.trim();
}

/** Optional nullable text: empty strings and null clear the field. */
function nullableText(
  body: Record<string, unknown>,
  field: string,
  maxLength: number,
  multiline = false,
): string | null | undefined {
  const value = body[field];

  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value !== 'string' || (!multiline && CONTROL_CHARS.test(value))) {
    throw new BadRequestException(`${field} must be a ${multiline ? '' : 'single-line '}string or null`);
  }

  const trimmed = value.trim();

  if (trimmed.length > maxLength) {
    throw new BadRequestException(`${field} must be at most ${maxLength} characters`);
  }

  return trimmed || null;
}

function optionalBoolean(body: Record<string, unknown>, field: string): boolean | undefined {
  const value = body[field];

  if (value === undefined) {
    return undefined;
  }

  if (typeof value !== 'boolean') {
    throw new BadRequestException(`${field} must be a boolean`);
  }

  return value;
}

/**
 * Workflow fields an environment may set for itself. Scope and assigned environments are not part of the input (the
 * controller always assigns the workflow to the calling environment only) and are refused; other unknown fields are
 * dropped.
 */
function parseWorkflowFields(raw: unknown, create: boolean): AgentDeploymentWorkflowUpdateInput {
  if (raw === undefined || raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new BadRequestException('Body must be an object');
  }

  const body = raw as Record<string, unknown>;

  // Said explicitly (like the controller) instead of silently ignoring it, so the agent does not assume it got a
  // wider workflow than the one assigned to itself.
  if (body['scope'] !== undefined || body['agentIds'] !== undefined) {
    throw new BadRequestException(
      'scope and agentIds cannot be set: pipelines you propose are always assigned to your environment only',
    );
  }

  const fields: AgentDeploymentWorkflowUpdateInput = {};

  if (create || body['connectionId'] !== undefined) {
    const connectionId = typeof body['connectionId'] === 'string' ? body['connectionId'].trim() : '';

    if (!UUID_V4.test(connectionId)) {
      throw new BadRequestException('connectionId must be a connection id from deployments_list_connections');
    }

    fields.connectionId = connectionId.toLowerCase();
  }

  if (create || body['name'] !== undefined) {
    fields.name = requiredLine(body, 'name', DEPLOYMENT_LIMITS.nameMaxLength);
  }

  if (create || body['repository'] !== undefined) {
    fields.repository = requiredLine(body, 'repository', DEPLOYMENT_LIMITS.repositoryMaxLength);
  }

  const description = nullableText(body, 'description', DEPLOYMENT_LIMITS.descriptionMaxLength, true);
  const workflow = nullableText(body, 'workflow', DEPLOYMENT_LIMITS.workflowMaxLength);
  const defaultRef = nullableText(body, 'defaultRef', DEPLOYMENT_LIMITS.refMaxLength);
  const agentTriggerEnabled = optionalBoolean(body, 'agentTriggerEnabled');
  const enabled = optionalBoolean(body, 'enabled');

  if (description !== undefined) fields.description = description;

  if (workflow !== undefined) fields.workflow = workflow;

  if (defaultRef !== undefined) fields.defaultRef = defaultRef;

  if (body['defaultInputs'] !== undefined && body['defaultInputs'] !== null) {
    fields.defaultInputs = parseInputs(body['defaultInputs'], 'defaultInputs');
  } else if (body['defaultInputs'] === null) {
    fields.defaultInputs = {};
  }

  if (agentTriggerEnabled !== undefined) fields.agentTriggerEnabled = agentTriggerEnabled;

  if (enabled !== undefined) fields.enabled = enabled;

  return fields;
}

export function parseAgentDeploymentWorkflowCreate(raw: unknown): AgentDeploymentWorkflowInput {
  return parseWorkflowFields(raw, true) as AgentDeploymentWorkflowInput;
}

export function parseAgentDeploymentWorkflowUpdate(raw: unknown): AgentDeploymentWorkflowUpdateInput {
  const fields = parseWorkflowFields(raw, false);

  if (Object.keys(fields).length === 0) {
    throw new BadRequestException('Provide at least one field to change');
  }

  return fields;
}
