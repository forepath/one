import {
  getMissingPatScopes,
  IDENTITY_PAT_SCOPES,
  isAdminPatScope,
  parsePatScope,
  patScopeSatisfied,
} from './identity-pat.scopes';

describe('IDENTITY_PAT_SCOPES', () => {
  it('has unique entries', () => {
    expect(new Set(IDENTITY_PAT_SCOPES).size).toBe(IDENTITY_PAT_SCOPES.length);
  });

  it('matches the expected shared catalog', () => {
    expect(IDENTITY_PAT_SCOPES).toEqual(['users:admin', 'webhooks:admin', 'updates:admin']);
  });

  it('only contains pattern-conformant scopes', () => {
    expect(IDENTITY_PAT_SCOPES.every((scope) => parsePatScope(scope) !== undefined)).toBe(true);
  });
});

describe('parsePatScope', () => {
  it('parses resource and level', () => {
    expect(parsePatScope('agent_files:write')).toEqual({ resource: 'agent_files', level: 'write' });
  });

  it.each(['clients', 'clients:pay', 'Clients:read', ':read', 'clients:read:extra', 'clients:*'])(
    'rejects non-conformant scope %s',
    (scope) => {
      expect(parsePatScope(scope)).toBeUndefined();
    },
  );
});

describe('isAdminPatScope', () => {
  it('detects admin level scopes', () => {
    expect(isAdminPatScope('users:admin')).toBe(true);
    expect(isAdminPatScope('clients:write')).toBe(false);
    expect(isAdminPatScope('admin')).toBe(false);
  });
});

describe('patScopeSatisfied', () => {
  it('matches exact scopes', () => {
    expect(patScopeSatisfied(['clients:read'], 'clients:read')).toBe(true);
  });

  it('lets write imply read', () => {
    expect(patScopeSatisfied(['clients:write'], 'clients:read')).toBe(true);
  });

  it('lets admin imply write and read', () => {
    expect(patScopeSatisfied(['clients:admin'], 'clients:write')).toBe(true);
    expect(patScopeSatisfied(['clients:admin'], 'clients:read')).toBe(true);
  });

  it('never lets a lower level imply a higher one', () => {
    expect(patScopeSatisfied(['clients:read'], 'clients:write')).toBe(false);
    expect(patScopeSatisfied(['clients:write'], 'clients:admin')).toBe(false);
  });

  it('never crosses resources', () => {
    expect(patScopeSatisfied(['clients:admin'], 'agents:read')).toBe(false);
    expect(patScopeSatisfied(['agents:admin'], 'agent_files:read')).toBe(false);
  });

  it('only matches non-conformant required scopes exactly', () => {
    expect(patScopeSatisfied(['invoices:admin'], 'invoices:pay')).toBe(false);
    expect(patScopeSatisfied(['invoices:pay'], 'invoices:pay')).toBe(true);
  });
});

describe('getMissingPatScopes', () => {
  it('returns unsatisfied required scopes', () => {
    expect(getMissingPatScopes(['tickets:write'], ['tickets:read', 'attachments:read'])).toEqual(['attachments:read']);
  });
});

describe('namespaced resources (`<namespace>:<name>:<level>`)', () => {
  it('parses one namespace segment as part of the resource', () => {
    expect(parsePatScope('websocket:clients:read')).toEqual({ resource: 'websocket:clients', level: 'read' });
    expect(parsePatScope('websocket:status:write')).toEqual({ resource: 'websocket:status', level: 'write' });
  });

  it('rejects malformed namespaced scopes', () => {
    expect(parsePatScope('websocket:a:b:read')).toBeUndefined();
    expect(parsePatScope('websocket::read')).toBeUndefined();
    expect(parsePatScope(':clients:read')).toBeUndefined();
    expect(parsePatScope('websocket:Clients:read')).toBeUndefined();
    expect(parsePatScope('websocket:clients:delete')).toBeUndefined();
  });

  it('applies the level hierarchy within the namespaced resource only', () => {
    expect(patScopeSatisfied(['websocket:clients:write'], 'websocket:clients:read')).toBe(true);
    expect(patScopeSatisfied(['websocket:clients:read'], 'websocket:clients:write')).toBe(false);
    expect(patScopeSatisfied(['websocket:status:write'], 'websocket:clients:read')).toBe(false);
    // A plain resource of the same name is a different resource.
    expect(patScopeSatisfied(['clients:admin'], 'websocket:clients:read')).toBe(false);
    expect(patScopeSatisfied(['websocket:clients:write'], 'clients:read')).toBe(false);
  });

  it('treats namespaced :admin scopes as admin scopes', () => {
    expect(isAdminPatScope('websocket:clients:admin')).toBe(true);
    expect(isAdminPatScope('websocket:clients:write')).toBe(false);
  });
});
