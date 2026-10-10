import type { JsonObject } from './types';

/** OpenCode primary agent used exclusively for Agenstra chat plan-mode sessions. */
export const AGENSTRA_PLAN_AGENT_NAME = 'agenstra-plan';

/** Platform skill that documents explore-only planning + structured ready protocol. */
export const AGENSTRA_CHAT_PLAN_SKILL_NAME = 'agenstra-chat-plan';

/**
 * Absolute skill path installed on workers (root-owned layer emit / sync).
 * Relative discovery under `.opencode/skills` is also listed for OpenCode path concat.
 */
export const AGENSTRA_CHAT_PLAN_SKILL_ABS_DIR = '/opt/agenstra/skills/agenstra-chat-plan';

export const AGENSTRA_CHAT_PLAN_SKILL_REL_DIR = '.opencode/skills/agenstra-chat-plan';

/** Explore-oriented permission names auto-allowed when residual asks appear on plan sessions. */
export const AGENSTRA_PLAN_EXPLORE_PERMISSION_NAMES = [
  'read',
  'glob',
  'grep',
  'list',
  'codesearch',
  'webfetch',
  'websearch',
] as const;

/** Mutating permission names that must be denied / rejected on plan sessions. */
export const AGENSTRA_PLAN_WRITE_PERMISSION_NAMES = ['edit', 'write', 'patch', 'bash', 'task', 'todowrite'] as const;

/**
 * Session-scoped OpenCode permission ruleset for plan explore/refine sessions.
 * Allow read/explore tools; deny write/mutation tools (including bash — cannot safely scope shell).
 */
export const AGENSTRA_PLAN_SESSION_PERMISSION_RULESET = [
  ...AGENSTRA_PLAN_EXPLORE_PERMISSION_NAMES.map((permission) => ({
    permission,
    pattern: '*',
    action: 'allow' as const,
  })),
  ...AGENSTRA_PLAN_WRITE_PERMISSION_NAMES.map((permission) => ({
    permission,
    pattern: '*',
    action: 'deny' as const,
  })),
  { permission: '*', pattern: '*', action: 'deny' as const },
];

/** Structured turn-status schema for OpenCode `format: json_schema` on plan prompts. */
export const AGENSTRA_PLAN_TURN_STATUS_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: {
      type: 'string',
      enum: ['exploring', 'ready'],
      description: 'exploring = more investigation needed; ready = plan is complete for user review/execute',
    },
    planMarkdown: {
      type: 'string',
      description: 'Full implementation plan in markdown (required when status is ready)',
    },
    summary: {
      type: 'string',
      description: 'Short status line for the chat card',
    },
  },
  required: ['status'],
} as const;

export type AgenstraPlanTurnStatus = 'exploring' | 'ready';

export function isAgenstraPlanTurnStatus(value: unknown): value is AgenstraPlanTurnStatus {
  return value === 'exploring' || value === 'ready';
}

export interface AgenstraPlanTurnStatusPayload {
  status: AgenstraPlanTurnStatus;
  planMarkdown?: string;
  summary?: string;
}

/**
 * Parse structured plan turn status from OpenCode structured output, tool payloads, or JSON text.
 */
export function parseAgenstraPlanTurnStatus(payload: unknown): AgenstraPlanTurnStatusPayload | undefined {
  if (typeof payload === 'string') {
    const trimmed = payload.trim();

    if (isAgenstraPlanTurnStatus(trimmed)) {
      return { status: trimmed };
    }

    try {
      return parseAgenstraPlanTurnStatus(JSON.parse(trimmed) as unknown);
    } catch {
      return undefined;
    }
  }

  if (!payload || typeof payload !== 'object') {
    return undefined;
  }

  const record = payload as Record<string, unknown>;

  if (!isAgenstraPlanTurnStatus(record['status'])) {
    return undefined;
  }

  const planMarkdown = typeof record['planMarkdown'] === 'string' ? record['planMarkdown'] : undefined;
  const summary = typeof record['summary'] === 'string' ? record['summary'] : undefined;

  return {
    status: record['status'],
    ...(planMarkdown !== undefined ? { planMarkdown } : {}),
    ...(summary !== undefined ? { summary } : {}),
  };
}

/** True when a residual permission ask should be auto-allowed on a plan session. */
export function isAgenstraPlanExplorePermission(permissionType: string | undefined): boolean {
  if (!permissionType) {
    return false;
  }

  const normalized = permissionType.trim().toLowerCase();

  return (AGENSTRA_PLAN_EXPLORE_PERMISSION_NAMES as readonly string[]).includes(normalized);
}

/** True when a residual permission ask must be rejected on a plan session. */
export function isAgenstraPlanWritePermission(permissionType: string | undefined): boolean {
  if (!permissionType) {
    return true;
  }

  const normalized = permissionType.trim().toLowerCase();

  if ((AGENSTRA_PLAN_EXPLORE_PERMISSION_NAMES as readonly string[]).includes(normalized)) {
    return false;
  }

  if ((AGENSTRA_PLAN_WRITE_PERMISSION_NAMES as readonly string[]).includes(normalized)) {
    return true;
  }

  // Unknown tools default to deny for plan sessions (fail closed).
  return true;
}

export const AGENSTRA_CHAT_PLAN_SKILL_MD = `---
name: agenstra-chat-plan
description: Explore-only planning protocol for Agenstra chat plan mode
compatibility: opencode
metadata:
  audience: planning
  workflow: chat-plan
---

# Agenstra chat plan mode

You are running an explore-only planning session. Do **not** create, edit, patch, or delete files.
Do **not** run shell commands that mutate the workspace. Use read, glob, grep, and similar explore tools only.

## Goal

Investigate the repository (and any injected context) thoroughly, then produce a comprehensive implementation plan
the user can review, refine, and later execute in their visible chat.

## Turn status (required)

After each planning turn, Agenstra collects structured output:

- \`status: "exploring"\` — more investigation is still needed
- \`status: "ready"\` — the plan is complete enough for the user to review / execute

When \`ready\`, always include \`planMarkdown\` with the full plan (sections, files to touch, risks, test plan).
Include a short \`summary\` for the chat card whenever possible.
Do not ask the user questions; proceed with reasonable defaults. Prefer finishing the plan in as few turns as possible.
`;

/**
 * Inject platform plan agent + skill paths into an effective V2 overlay before wire sync.
 * Always applied so UI overlays cannot remove the plan agent or skill discovery path.
 */
export function injectPlatformPlanConfig(config: JsonObject): JsonObject {
  const next: JsonObject = { ...config };
  const agents = isPlainObject(next['agents']) ? { ...(next['agents'] as JsonObject) } : {};

  agents[AGENSTRA_PLAN_AGENT_NAME] = {
    description: 'Explore-only Agenstra chat plan mode (platform-managed)',
    mode: 'primary',
    hidden: true,
    permission: {
      read: 'allow',
      glob: 'allow',
      grep: 'allow',
      edit: 'deny',
      write: 'deny',
      bash: 'deny',
    },
  };
  next['agents'] = agents;

  const skills = normalizeSkillsRoot(next['skills']);
  const paths = new Set(skills.paths);
  paths.add(AGENSTRA_CHAT_PLAN_SKILL_ABS_DIR);
  paths.add(AGENSTRA_CHAT_PLAN_SKILL_REL_DIR);
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
