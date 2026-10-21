import { promises as dns } from 'dns';
import { isIP } from 'net';

import { AGENT_CONTEXT_MCP_ENABLED_ENV, AGENT_CONTEXT_MCP_MANAGER_URL_ENV } from '../constants/agent-context.constants';

import type { EgressPlatformAllow } from './egress-guard-config.utils';

type LookupFn = (hostname: string) => Promise<Array<{ address: string; family: number }>>;

const defaultLookup: LookupFn = (hostname) => dns.lookup(hostname, { all: true });

/**
 * Egress-guard exceptions for the manager context API so the worker `agenstra` MCP server keeps
 * working in `enforce` / `offline` mode. Empty when the context MCP is disabled or unresolvable.
 */
export async function resolveAgentContextEgressAllows(
  env: NodeJS.ProcessEnv = process.env,
  lookup: LookupFn = defaultLookup,
): Promise<EgressPlatformAllow[]> {
  if (env[AGENT_CONTEXT_MCP_ENABLED_ENV]?.trim().toLowerCase() === 'false') {
    return [];
  }

  const raw = env[AGENT_CONTEXT_MCP_MANAGER_URL_ENV]?.trim();

  if (!raw) {
    return [];
  }

  let url: URL;

  try {
    url = new URL(raw);
  } catch {
    return [];
  }

  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return [];
  }

  const port = url.port ? Number.parseInt(url.port, 10) : url.protocol === 'https:' ? 443 : 80;
  const hostname = url.hostname.replace(/^\[|\]$/g, '');

  if (isIP(hostname)) {
    return [{ destination: hostname, port }];
  }

  try {
    const addresses = await lookup(hostname);

    return addresses.map((entry) => ({ destination: entry.address, port }));
  } catch {
    return [];
  }
}
