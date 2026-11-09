import { IDENTITY_PAT_SCOPES } from '@forepath/identity/backend';

/**
 * Agenstra PAT capability scopes (allowlist for create + JWT).
 * Every entry must be enforced via `@RequireScopes` (or equivalent) on machine routes.
 *
 * Pattern: `<resource>:read` | `<resource>:write` (implies read) | `<resource>:admin` (implies write, admin-only).
 */
export const AGENSTRA_PAT_SCOPES = [
  // Workspaces: clients, members, provisioning, isolation/egress, workspace + agent OpenCode config, catalogs
  'clients:read',
  'clients:write',
  // Instance-wide OpenCode configuration (admin console)
  'clients:admin',
  // Agents: CRUD, models, permission/question replies, autonomy, lifecycle (start/stop/restart)
  'agents:read',
  'agents:write',
  // Agent workspace files and workspace search
  'agent_files:read',
  'agent_files:write',
  // Agent environment variables (secrets)
  'agent_environment:read',
  'agent_environment:write',
  // Agent chats: sessions, messages, plans, scheduled tasks
  'agent_chats:read',
  'agent_chats:write',
  // Agent version control and automation command verification
  'agent_vcs:read',
  'agent_vcs:write',
  // Agent remote desktop sessions
  'agent_vnc:write',
  'tickets:read',
  'tickets:write',
  'knowledge:read',
  'knowledge:write',
  // Initiatives: planning context (documents, work items, runs, proposals, findings, decisions)
  'initiatives:read',
  'initiatives:write',
  'attachments:read',
  'attachments:write',
  // Environment / workspace / global graphs (write: rebuild). Mirrored data stays capped by the domain scopes above
  // (files: code / paths graphs, chats: prompt references, tickets / knowledge / chats: snapshot nodes).
  'graph:read',
  'graph:write',
  // Instance-wide connections (admin console): Atlassian context import + CI/CD deployment connections
  'connections:admin',
  // Workspace deployments: workflows, runs, logs (write: trigger / cancel; workflow management: workspace admins)
  'deployments:read',
  'deployments:write',
  'statistics:read',
  // WebSockets (connect + subscribe: read; state-changing events: write). Events stay capped by the domain scopes
  // above (see agenstra-websocket.scopes.ts).
  'websocket:clients:read',
  'websocket:clients:write',
  'websocket:status:read',
  'websocket:status:write',
  'websocket:tickets:read',
  'websocket:pages:read',
  'websocket:initiatives:read',
  'websocket:vnc:write',
  ...IDENTITY_PAT_SCOPES,
] as const;

export type AgenstraPatScope = (typeof AGENSTRA_PAT_SCOPES)[number];
