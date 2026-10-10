/**
 * Baseline bookkeeping for agent-level environment variables.
 *
 * Agent-level variables are layered over the environment an agent container was provisioned with
 * (creation values, workspace configuration overrides, OpenCode config sync). The baseline records,
 * for every key currently controlled by an agent-level variable, the value it replaced (`null` when the
 * key did not exist). Removing or renaming a variable restores that value instead of leaving the stale
 * agent-level value behind, and other environment sources update the baseline instead of overwriting
 * the agent-level value.
 *
 * Stored AES-256-GCM encrypted on the agent (`environment_variable_baseline`), because values are secrets.
 * A missing baseline (agents created before this bookkeeping existed) is treated as "untracked".
 */
export type AgentEnvironmentBaseline = Record<string, string | null>;

/** Keys explicitly added/removed by the mutation that triggers a reconcile (used for untracked agents). */
export interface AgentEnvironmentVariableChangeHints {
  /** Keys newly introduced by the mutation; their current container value is a genuine base value. */
  addedKeys?: string[];
  /** Keys whose agent-level variable was removed (deleted or renamed away). */
  removedKeys?: string[];
}

/** Parses a stored baseline; anything that is not a `{ [key]: string | null }` object yields `null` (untracked). */
export function parseAgentEnvironmentBaseline(raw: string | null | undefined): AgentEnvironmentBaseline | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }

    const baseline: AgentEnvironmentBaseline = {};

    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === 'string') {
        baseline[key] = value;
      } else if (value === null) {
        baseline[key] = null;
      }
    }

    return baseline;
  } catch {
    return null;
  }
}

export function serializeAgentEnvironmentBaseline(baseline: AgentEnvironmentBaseline): string {
  return JSON.stringify(baseline);
}

/**
 * Computes the environment change for a full set of agent-level variables.
 * - Desired variables are applied; keys not yet tracked record their current container value (if any)
 *   as baseline. For untracked agents only {@link AgentEnvironmentVariableChangeHints.addedKeys} are
 *   trusted, because the container may already carry previously applied agent-level values.
 * - Tracked keys (plus hinted removals for untracked agents) that are no longer desired fall back to
 *   their baseline value, or are removed (`undefined`) when the key did not exist before.
 * @returns The env change for `DockerService.updateContainer` and the new baseline
 */
export function planAgentEnvironmentVariables(input: {
  desired: Record<string, string>;
  baseline: AgentEnvironmentBaseline | null;
  currentEnv: Record<string, string>;
  hints?: AgentEnvironmentVariableChangeHints;
}): { env: Record<string, string | undefined>; baseline: AgentEnvironmentBaseline } {
  const { desired, currentEnv, hints } = input;
  const tracked = input.baseline !== null;
  const previous = input.baseline ?? {};
  const addedKeys = new Set(hints?.addedKeys ?? []);
  const env: Record<string, string | undefined> = {};
  const baseline: AgentEnvironmentBaseline = {};

  for (const [key, value] of Object.entries(desired)) {
    env[key] = value;

    if (key in previous) {
      baseline[key] = previous[key];
    } else if (key in currentEnv && (tracked || addedKeys.has(key))) {
      baseline[key] = currentEnv[key];
    } else {
      baseline[key] = null;
    }
  }

  const removedKeys = new Set([...Object.keys(previous), ...(tracked ? [] : (hints?.removedKeys ?? []))]);

  for (const key of removedKeys) {
    if (key in desired) {
      continue;
    }

    const fallback = previous[key];

    env[key] = fallback === null || fallback === undefined ? undefined : fallback;
  }

  return { env, baseline };
}

/**
 * Keeps agent-level variables authoritative when another source (workspace configuration overrides,
 * OpenCode config sync) changes the environment: changes to keys controlled by an agent-level variable
 * only update their baseline, everything else passes through.
 * @param onlyExistingKeys - Only update baselines of keys that existed before the agent-level variable
 *   (workspace overrides apply only to containers that already carry a key)
 */
export function shieldAgentEnvironmentVariables(
  changes: Record<string, string | undefined>,
  baseline: AgentEnvironmentBaseline | null,
  options: { onlyExistingKeys?: boolean } = {},
): { env: Record<string, string | undefined>; baseline: AgentEnvironmentBaseline | null; baselineChanged: boolean } {
  if (!baseline) {
    return { env: { ...changes }, baseline, baselineChanged: false };
  }

  const env: Record<string, string | undefined> = {};
  const nextBaseline: AgentEnvironmentBaseline = { ...baseline };
  let baselineChanged = false;

  for (const [key, value] of Object.entries(changes)) {
    if (!(key in baseline)) {
      env[key] = value;
      continue;
    }

    if (options.onlyExistingKeys && baseline[key] === null) {
      continue;
    }

    const next = value ?? null;

    if (nextBaseline[key] !== next) {
      nextBaseline[key] = next;
      baselineChanged = true;
    }
  }

  return { env, baseline: nextBaseline, baselineChanged };
}

const agentEnvironmentLocks = new Map<string, Promise<unknown>>();

/**
 * Serializes baseline read-modify-write cycles per agent (within this process), so concurrent
 * environment updates cannot lose baseline entries.
 */
export async function withAgentEnvironmentLock<T>(agentId: string, task: () => Promise<T>): Promise<T> {
  const previous = agentEnvironmentLocks.get(agentId) ?? Promise.resolve();
  const run = previous.catch(() => undefined).then(task);
  const tail = run.catch(() => undefined);

  agentEnvironmentLocks.set(agentId, tail);

  try {
    return await run;
  } finally {
    if (agentEnvironmentLocks.get(agentId) === tail) {
      agentEnvironmentLocks.delete(agentId);
    }
  }
}
