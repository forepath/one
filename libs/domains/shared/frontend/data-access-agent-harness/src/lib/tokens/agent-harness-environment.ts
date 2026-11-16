import { InjectionToken } from '@angular/core';
import type { AgentHarnessCredential, AgentToolApprovalRequest } from '@forepath/shared/shared/util-agent-harness';

/**
 * `relay` (recommended for products): the application's own backend runs the harness with
 * `@forepath/shared/backend/feature-agent-harness` (credential and domain tools stay server-side) and exposes
 * `POST {relayUrl}/turns` (SSE), `POST {relayUrl}/conversations` and `GET {relayUrl}/conversations/:id/items`.
 * Requests go through Angular's `HttpClient`, so the application's auth interceptors apply.
 */
export interface AgentHarnessRelayEnvironment {
  mode: 'relay';
  /** Base URL of the application's assistant endpoints (no trailing slash). */
  relayUrl: string;
}

/**
 * `direct`: the browser talks to the Agenstra agent's OpenAI-compatible API itself, with a user-bound credential from
 * {@link AGENT_HARNESS_CREDENTIAL} (e.g. an app access token from the Agenstra app flow; never a shared key). Browser
 * tools from `AgentHarnessToolsService` run in the page. The console origin must be in the controller's `CORS_ORIGIN`.
 */
export interface AgentHarnessDirectEnvironment {
  mode: 'direct';
  /** Controller REST base URL incl. global prefix, e.g. `https://agenstra.example.com/api`. */
  apiUrl: string;
  clientId: string;
  agentId: string;
  model?: string;
  instructions?: string;
  toolActivity?: boolean;
}

export type AgentHarnessEnvironment = AgentHarnessRelayEnvironment | AgentHarnessDirectEnvironment;

export const AGENT_HARNESS_ENVIRONMENT = new InjectionToken<AgentHarnessEnvironment>('AgentHarnessEnvironment');

/** Credential provider of the `direct` mode (called before every request; refresh tokens there). */
export const AGENT_HARNESS_CREDENTIAL = new InjectionToken<AgentHarnessCredential>('AgentHarnessCredential');

/** Approval of browser tools with `requiresApproval` (e.g. a confirm dialog). Without it such calls are denied. */
export const AGENT_HARNESS_APPROVAL = new InjectionToken<
  (request: AgentToolApprovalRequest<unknown>) => boolean | Promise<boolean>
>('AgentHarnessApproval');
