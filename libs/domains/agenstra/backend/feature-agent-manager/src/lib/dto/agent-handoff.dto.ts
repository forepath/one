import {
  AGENT_HANDOFF_LIMITS,
  AGENT_TASK_LIMITS,
  isAgentHandoffResponseStatus,
  type AgentHandoffCreateInput,
  type AgentHandoffProfileInput,
  type AgentHandoffRespondInput,
} from '@forepath/agenstra/shared/util-opencode-config';
import { BadRequestException, NotFoundException } from '@nestjs/common';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asBody(raw: unknown): Record<string, unknown> {
  return (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
}

function requireText(body: Record<string, unknown>, key: string, maxLength: number): string {
  const value = body[key];

  if (typeof value !== 'string' || !value.trim()) {
    throw new BadRequestException(`${key} must be a non-empty string`);
  }

  if (value.trim().length > maxLength) {
    throw new BadRequestException(`${key} must be at most ${maxLength} characters`);
  }

  return value.trim();
}

/**
 * The agent-manager has no global ValidationPipe, so agent-facing handoff input is normalized here. Shape and
 * bounds only — the controller checks that the target belongs to the caller's workspace.
 */
export function parseAgentHandoffCreate(raw: unknown): AgentHandoffCreateInput {
  const body = asBody(raw);
  const targetAgentId = requireText(body, 'targetAgentId', 64).toLowerCase();

  if (!UUID_V4.test(targetAgentId)) {
    throw new NotFoundException('Target agent not found in this workspace');
  }

  const input: AgentHandoffCreateInput = {
    targetAgentId,
    title: requireText(body, 'title', AGENT_HANDOFF_LIMITS.titleMaxLength),
    message: requireText(body, 'message', AGENT_HANDOFF_LIMITS.messageMaxLength),
  };

  if (body['model'] !== undefined) {
    input.model = requireText(body, 'model', AGENT_TASK_LIMITS.modelMaxLength);
  }

  return input;
}

export function parseAgentHandoffRespond(raw: unknown): AgentHandoffRespondInput {
  const body = asBody(raw);

  if (!isAgentHandoffResponseStatus(body['status'])) {
    throw new BadRequestException('status must be completed or failed');
  }

  return { status: body['status'], response: requireText(body, 'response', AGENT_HANDOFF_LIMITS.responseMaxLength) };
}

/** Empty (or whitespace-only) clears the profile. */
export function parseAgentHandoffProfile(raw: unknown): AgentHandoffProfileInput {
  const value = asBody(raw)['profile'];

  if (typeof value !== 'string') {
    throw new BadRequestException('profile must be a string');
  }

  if (value.trim().length > AGENT_HANDOFF_LIMITS.profileMaxLength) {
    throw new BadRequestException(`profile must be at most ${AGENT_HANDOFF_LIMITS.profileMaxLength} characters`);
  }

  return { profile: value.trim() };
}

/** Malformed agent ids are reported like agents outside the workspace. */
export function parseAgentHandoffTargetId(raw: string | undefined): string {
  const id = raw?.trim() ?? '';

  if (!UUID_V4.test(id)) {
    throw new NotFoundException('Target agent not found in this workspace');
  }

  return id.toLowerCase();
}

/** Unknown / malformed ids are reported like missing handoffs (no hint about other agents' handoffs). */
export function parseAgentHandoffId(raw: string | undefined): string {
  const id = raw?.trim() ?? '';

  if (!UUID_V4.test(id)) {
    throw new NotFoundException('Handoff not found');
  }

  return id.toLowerCase();
}
