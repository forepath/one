/**
 * Initiatives (workspace planning that follows the BMad Method). Step runs execute in hidden, read-only
 * `-initiative-{runId}` OpenCode sessions: the same explore-only agent and permission ruleset as chat plan sessions,
 * only the pre-granted context, and no content changes (the agent returns its result in a status block that a user
 * accepts on the Initiatives page).
 */

/** Prefix of the hidden OpenCode session of a step run (`-initiative-{runId}`). */
export const AGENSTRA_INITIATIVE_RESUME_SESSION_SUFFIX_PREFIX = '-initiative-';

export function buildInitiativeResumeSessionSuffix(runId: string): string {
  return `${AGENSTRA_INITIATIVE_RESUME_SESSION_SUFFIX_PREFIX}${runId}`;
}

export function isInitiativeResumeSessionSuffix(suffix: string | undefined): boolean {
  return (
    typeof suffix === 'string' &&
    suffix.startsWith(AGENSTRA_INITIATIVE_RESUME_SESSION_SUFFIX_PREFIX) &&
    suffix.length > AGENSTRA_INITIATIVE_RESUME_SESSION_SUFFIX_PREFIX.length
  );
}

/** Context refs of initiatives (overview incl. work items) and of their documents. */
export const AGENT_CONTEXT_INITIATIVE_KINDS = ['initiative', 'artifact'] as const;
