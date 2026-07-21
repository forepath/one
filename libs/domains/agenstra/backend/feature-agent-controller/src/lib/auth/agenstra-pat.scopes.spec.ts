import { AGENSTRA_PAT_SCOPES } from './agenstra-pat.scopes';

describe('AGENSTRA_PAT_SCOPES', () => {
  it('has unique entries', () => {
    expect(new Set(AGENSTRA_PAT_SCOPES).size).toBe(AGENSTRA_PAT_SCOPES.length);
  });

  it('includes the full agenstra PAT scope catalog', () => {
    expect(AGENSTRA_PAT_SCOPES).toEqual(
      expect.arrayContaining([
        'clients:read',
        'clients:write',
        'tickets:read',
        'tickets:write',
        'filter_rules:write',
        'agents:read',
        'agents:write',
        'agents:lifecycle',
        'agents:files',
        'agents:environment',
        'agents:vcs',
        'agents:deployments',
        'imports:write',
        'statistics:read',
        'users:admin',
        'webhooks:admin',
      ]),
    );
  });
});
