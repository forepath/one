export type AgentProviderTransport = 'legacy' | 'acp';

/**
 * Resolves CLI vs ACP transport for an agent provider type.
 * Per-type override: `CURSOR_AGENT_TRANSPORT`, `OPENCODE_AGENT_TRANSPORT`, `OPENCLAW_AGENT_TRANSPORT`.
 */
export function resolveAgentProviderTransport(agentType: string): AgentProviderTransport {
  const envKey = `${agentType.toUpperCase().replace(/-/g, '_')}_AGENT_TRANSPORT`;
  const override = process.env[envKey];

  if (override === 'acp' || override === 'legacy') {
    return override;
  }

  const globalTransport = (process.env.AGENT_PROVIDER_TRANSPORT ?? 'legacy').toLowerCase();

  if (globalTransport === 'acp') {
    return 'acp';
  }

  return 'legacy';
}

export function isAcpTransport(agentType: string): boolean {
  return resolveAgentProviderTransport(agentType) === 'acp';
}
