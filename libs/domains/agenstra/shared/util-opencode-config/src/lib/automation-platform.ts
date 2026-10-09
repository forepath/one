import type { JsonObject } from './types';

/**
 * Bump when {@link injectPlatformAutomationConfig} / prepareConfigForSync platform wire changes.
 * Included in OpenCode sync revision hashes so existing agents re-sync after deploys.
 */
export const AGENSTRA_OPENCODE_PLATFORM_WIRE_VERSION = 4;

/** OpenCode primary agent used exclusively for Agenstra ticket automation sessions. */
export const AGENSTRA_AUTOMATION_AGENT_NAME = 'agenstra-automation';

/** Platform skill that documents structured turn-status protocol for ticket runs. */
export const AGENSTRA_TICKET_AUTOMATION_SKILL_NAME = 'agenstra-ticket-automation';

/**
 * Platform-owned skill directory outside the project, explicitly registered in skills.paths.
 */
export const AGENSTRA_TICKET_AUTOMATION_SKILL_ABS_DIR = '/opt/agenstra/skills/agenstra-ticket-automation';

/** Session-scoped OpenCode permission ruleset: allow every action for automation sessions. */
export const AGENSTRA_AUTOMATION_SESSION_PERMISSION_RULESET = [
  { permission: '*', pattern: '*', action: 'allow' as const },
];

/** Structured turn-status schema for OpenCode `format: json_schema` on automation loop prompts. */
export const AGENSTRA_AUTOMATION_TURN_STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: {
      type: 'string',
      enum: ['continue', 'complete'],
      description: 'continue = more implementation work remains; complete = ready for verification',
    },
    summary: {
      type: 'string',
      description: 'Short summary of what was done this turn or why work is complete',
    },
  },
  required: ['status'],
} as const;

export type AgenstraAutomationTurnStatus = 'continue' | 'complete';

export function isAgenstraAutomationTurnStatus(value: unknown): value is AgenstraAutomationTurnStatus {
  return value === 'continue' || value === 'complete';
}

/**
 * Parse structured turn status from OpenCode structured output, tool payloads, or JSON text.
 */
export function parseAgenstraAutomationTurnStatus(payload: unknown): AgenstraAutomationTurnStatus | undefined {
  if (isAgenstraAutomationTurnStatus(payload)) {
    return payload;
  }

  if (typeof payload === 'string') {
    const trimmed = payload.trim();

    if (isAgenstraAutomationTurnStatus(trimmed)) {
      return trimmed;
    }

    try {
      return parseAgenstraAutomationTurnStatus(JSON.parse(trimmed) as unknown);
    } catch {
      return undefined;
    }
  }

  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;

  if (isAgenstraAutomationTurnStatus(record['status'])) {
    return record['status'];
  }

  return undefined;
}

export const AGENSTRA_TICKET_AUTOMATION_SKILL_MD = `---
name: agenstra-ticket-automation
description: Structured turn-status protocol for Agenstra autonomous ticket prototyping runs
compatibility: opencode
metadata:
  audience: automation
  workflow: ticket-run
---

# Agenstra ticket automation

You are running an unattended ticket automation session. There is no human to approve tools or answer questions.

## Turn status (required)

After each implementation turn, Agenstra collects structured output:

- \`status: "continue"\` — more code changes or investigation are still needed
- \`status: "complete"\` — the scoped prototype is ready for automated verification

Set \`complete\` only when the requested ticket work is implemented and ready for verifier commands / commit.
Do not ask the user questions; proceed with reasonable defaults. Prefer finishing the scoped work in as few turns as possible.
`;

/**
 * Inject platform automation agent + skill paths into an effective V2 overlay before wire sync.
 * Always applied so UI overlays cannot remove the automation agent or skill discovery path.
 */
export function injectPlatformAutomationConfig(config: JsonObject): JsonObject {
  const next: JsonObject = { ...config };
  const agents = isPlainObject(next['agents']) ? { ...(next['agents'] as JsonObject) } : {};

  agents[AGENSTRA_AUTOMATION_AGENT_NAME] = {
    description: 'Unattended Agenstra ticket automation (platform-managed)',
    mode: 'primary',
    hidden: true,
    permission: 'allow',
  };
  next['agents'] = agents;

  const skills = normalizeSkillsRoot(next['skills']);
  const paths = new Set(skills.paths);
  paths.add(AGENSTRA_TICKET_AUTOMATION_SKILL_ABS_DIR);
  next['skills'] = { paths: [...paths], urls: skills.urls };

  return next;
}

function isPlainObject(value: unknown): value is JsonObject {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function normalizeSkillsRoot(value: unknown): { paths: string[]; urls: string[] } {
  if (Array.isArray(value)) {
    const paths: string[] = [];
    const urls: string[] = [];

    for (const entry of value) {
      if (typeof entry !== 'string' || !entry.trim()) {
        continue;
      }

      const trimmed = entry.trim();

      if (/^https?:\/\//i.test(trimmed)) {
        urls.push(trimmed);
      } else {
        paths.push(trimmed);
      }
    }

    return { paths, urls };
  }

  if (!isPlainObject(value)) {
    return { paths: [], urls: [] };
  }

  const paths = Array.isArray(value['paths'])
    ? value['paths'].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];
  const urls = Array.isArray(value['urls'])
    ? value['urls'].filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0)
    : [];

  return { paths, urls };
}
