/** Repeatable coordinator: recovers lost / stalled handoffs and undelivered responses (keep in sync with job-registry). */
export const AGENT_HANDOFF_COORDINATOR_JOB_NAME = 'agent-handoff.coordinator';

/** One handoff (`{ handoffId }`): target turn(s) plus response delivery (keep in sync with job-registry). */
export const AGENT_HANDOFF_UNIT_JOB_NAME = 'agent-handoff.unit';

/** BullMQ jobId namespace for unit jobs: `agent-handoff.<handoffId>`. */
export const AGENT_HANDOFF_UNIT_JOB_ID_NAMESPACE = 'agent-handoff';

/**
 * Repair turns after the first target turn when the target did not call `agenstra_handoff_respond`
 * (same bound as chat plan repair turns).
 */
export const AGENT_HANDOFF_RESPONSE_REPAIR_ATTEMPTS = 2;

/** Handoffs still `running` this long after their turns could have timed out are failed (worker restart). */
export const AGENT_HANDOFF_STALE_GRACE_MS = 10 * 60_000;

/** Pending handoffs / undelivered responses older than this are re-enqueued by the coordinator. */
export const AGENT_HANDOFF_REQUEUE_AFTER_MS = 2 * 60_000;

/** Response deliveries are given up after this many failed attempts (handoff marked undeliverable). */
export const AGENT_HANDOFF_MAX_DELIVERY_ATTEMPTS = 10;

/** Fallback response when the target ends without `agenstra_handoff_respond` (tail of its last answer). */
export const AGENT_HANDOFF_FALLBACK_RESPONSE_MAX_LENGTH = 8_000;

export const AGENT_HANDOFF_FAILURE_MESSAGE_MAX_LENGTH = 512;

/** How long one target turn may take. */
export function getAgentHandoffTurnTimeoutMs(): number {
  return positiveIntFromEnv('AGENT_HANDOFF_TURN_TIMEOUT_MS', 1_800_000);
}

/** Handoffs that are not answered yet, per workspace (bounds loops between agents). */
export function getAgentHandoffsMaxActivePerWorkspace(): number {
  return positiveIntFromEnv('AGENT_HANDOFFS_MAX_ACTIVE_PER_WORKSPACE', 20);
}

/** How often a handed-over task may be handed over again (A → B → C is depth 2). */
export function getAgentHandoffMaxDepth(): number {
  return positiveIntFromEnv('AGENT_HANDOFF_MAX_DEPTH', 3);
}

function positiveIntFromEnv(key: string, fallback: number): number {
  const parsed = parseInt(process.env[key] ?? '', 10);

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
