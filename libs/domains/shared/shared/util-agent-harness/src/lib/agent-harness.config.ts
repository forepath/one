import { AGENT_HARNESS_OPENAI_PATH, AGENT_HARNESS_UUID_PATTERN } from './agent-harness.constants';
import { AgentHarnessConfigError } from './agent-harness.errors';

/**
 * Credential sent as `Authorization: Bearer …`: a personal access token (`fp_pat_…`), an app access token, an
 * interactive session token or the controller's static API key. A function is called before every request (refresh
 * short-lived tokens there); returning `undefined` sends no `Authorization` header (e.g. same-origin cookie proxies).
 */
export type AgentHarnessCredential = string | (() => string | undefined | Promise<string | undefined>);

export type AgentHarnessFetch = (input: string, init: RequestInit) => Promise<Response>;

export interface AgentHarnessConnectionConfig {
  /** Controller REST base URL including the global prefix, e.g. `https://agenstra.example.com/api`. */
  apiUrl: string;
  /** Workspace (client) UUID. */
  clientId: string;
  /** Environment (agent) UUID. */
  agentId: string;
  credential?: AgentHarnessCredential;
  /** Additional headers sent with every request (e.g. `Authorization: Certificate …` for mTLS assertions). */
  headers?: Record<string, string>;
  /** Fetch implementation (defaults to the global `fetch`). */
  fetch?: AgentHarnessFetch;
  /**
   * Plain `http://` is only accepted for loopback hosts (local development) unless explicitly allowed, because the
   * credential would otherwise travel unencrypted.
   */
  allowInsecureHttp?: boolean;
  /**
   * Fetch credentials mode (browsers). Default `omit`; `same-origin` / `include` only for relays to the application's
   * own backend that authenticate with cookies.
   */
  requestCredentials?: 'omit' | 'same-origin' | 'include';
  /** Timeout of non-turn requests (models, conversations) in milliseconds. Turns are bounded by the caller's signal. */
  requestTimeoutMs?: number;
}

export interface NormalizedAgentHarnessConnection {
  /** `…/clients/{clientId}/agents/{agentId}/openai/v1` (no trailing slash). */
  baseUrl: string;
  clientId: string;
  agentId: string;
  credential?: AgentHarnessCredential;
  headers: Record<string, string>;
  fetch: AgentHarnessFetch;
  requestTimeoutMs: number;
  requestCredentials: 'omit' | 'same-origin' | 'include';
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1', 'host.docker.internal']);
const FORBIDDEN_HEADERS = new Set(['authorization', 'content-type', 'content-length', 'host', 'cookie']);

function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();

  return LOOPBACK_HOSTS.has(host) || host.endsWith('.localhost') || /^127(\.\d{1,3}){3}$/.test(host);
}

/** Validates the connection config and builds the agent's OpenAI-compatible base URL. */
export function normalizeAgentHarnessConnection(
  config: AgentHarnessConnectionConfig,
): NormalizedAgentHarnessConnection {
  if (!config || typeof config !== 'object') {
    throw new AgentHarnessConfigError('Agent harness connection config is required');
  }

  const { clientId, agentId } = config;

  if (typeof clientId !== 'string' || !AGENT_HARNESS_UUID_PATTERN.test(clientId)) {
    throw new AgentHarnessConfigError('clientId must be a workspace UUID');
  }

  if (typeof agentId !== 'string' || !AGENT_HARNESS_UUID_PATTERN.test(agentId)) {
    throw new AgentHarnessConfigError('agentId must be an environment UUID');
  }

  let url: URL;

  try {
    url = new URL(String(config.apiUrl ?? '').trim());
  } catch {
    throw new AgentHarnessConfigError('apiUrl must be an absolute URL (e.g. https://agenstra.example.com/api)');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new AgentHarnessConfigError('apiUrl must use https (or http for local development)');
  }

  if (url.protocol === 'http:' && !config.allowInsecureHttp && !isLoopbackHost(url.hostname)) {
    throw new AgentHarnessConfigError(
      'apiUrl must use https: credentials would be sent unencrypted (set allowInsecureHttp only for trusted networks)',
    );
  }

  if (url.username || url.password) {
    throw new AgentHarnessConfigError('apiUrl must not contain credentials; use the credential option');
  }

  if (url.search || url.hash) {
    throw new AgentHarnessConfigError('apiUrl must not contain a query string or fragment');
  }

  const headers: Record<string, string> = {};

  for (const [name, value] of Object.entries(config.headers ?? {})) {
    if (FORBIDDEN_HEADERS.has(name.toLowerCase()) && !(name.toLowerCase() === 'authorization' && !config.credential)) {
      throw new AgentHarnessConfigError(`Header '${name}' is managed by the harness`);
    }

    if (/[\r\n]/.test(name) || /[\r\n]/.test(String(value))) {
      throw new AgentHarnessConfigError(`Header '${name}' contains a line break`);
    }

    headers[name] = String(value);
  }

  const fetchImpl = config.fetch ?? (typeof fetch === 'function' ? fetch.bind(globalThis) : undefined);

  if (!fetchImpl) {
    throw new AgentHarnessConfigError('No fetch implementation available; pass one via the fetch option');
  }

  const root = url.toString().replace(/\/+$/, '');

  return {
    baseUrl: `${root}/clients/${clientId.toLowerCase()}/agents/${agentId.toLowerCase()}/${AGENT_HARNESS_OPENAI_PATH}`,
    clientId: clientId.toLowerCase(),
    agentId: agentId.toLowerCase(),
    credential: config.credential,
    headers,
    fetch: fetchImpl as AgentHarnessFetch,
    requestCredentials: config.requestCredentials ?? 'omit',
    requestTimeoutMs:
      typeof config.requestTimeoutMs === 'number' && config.requestTimeoutMs > 0 ? config.requestTimeoutMs : 30_000,
  };
}

export async function resolveAgentHarnessCredential(credential?: AgentHarnessCredential): Promise<string | undefined> {
  if (credential === undefined) {
    return undefined;
  }

  const value = typeof credential === 'function' ? await credential() : credential;

  if (value === undefined || value === null || value === '') {
    return undefined;
  }

  if (typeof value !== 'string' || /[\r\n\s]/.test(value)) {
    throw new AgentHarnessConfigError('The credential must be a single token without whitespace');
  }

  return value;
}
