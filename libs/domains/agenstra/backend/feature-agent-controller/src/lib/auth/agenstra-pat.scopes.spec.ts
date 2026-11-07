import { parsePatScope } from '@forepath/identity/backend';

import { AGENSTRA_PAT_SCOPES } from './agenstra-pat.scopes';

describe('AGENSTRA_PAT_SCOPES', () => {
  it('has unique entries', () => {
    expect(new Set(AGENSTRA_PAT_SCOPES).size).toBe(AGENSTRA_PAT_SCOPES.length);
  });

  it('only contains <resource>:read|write|admin scopes', () => {
    expect(AGENSTRA_PAT_SCOPES.filter((scope) => parsePatScope(scope) === undefined)).toEqual([]);
  });

  it('matches the full agenstra PAT scope catalog', () => {
    expect([...AGENSTRA_PAT_SCOPES]).toEqual([
      'clients:read',
      'clients:write',
      'clients:admin',
      'agents:read',
      'agents:write',
      'agent_files:read',
      'agent_files:write',
      'agent_environment:read',
      'agent_environment:write',
      'agent_chats:read',
      'agent_chats:write',
      'agent_vcs:read',
      'agent_vcs:write',
      'agent_deployments:read',
      'agent_deployments:write',
      'agent_vnc:write',
      'tickets:read',
      'tickets:write',
      'knowledge:read',
      'knowledge:write',
      'initiatives:read',
      'initiatives:write',
      'attachments:read',
      'attachments:write',
      'imports:admin',
      'statistics:read',
      'websocket:clients:read',
      'websocket:clients:write',
      'websocket:status:read',
      'websocket:status:write',
      'websocket:tickets:read',
      'websocket:pages:read',
      'websocket:initiatives:read',
      'websocket:vnc:write',
      'users:admin',
      'webhooks:admin',
      'updates:admin',
    ]);
  });
});
