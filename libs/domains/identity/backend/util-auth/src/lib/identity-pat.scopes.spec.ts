import { IDENTITY_PAT_SCOPES } from './identity-pat.scopes';

describe('IDENTITY_PAT_SCOPES', () => {
  it('has unique entries', () => {
    expect(new Set(IDENTITY_PAT_SCOPES).size).toBe(IDENTITY_PAT_SCOPES.length);
  });

  it('matches the expected shared catalog', () => {
    expect(IDENTITY_PAT_SCOPES).toEqual(['users:admin', 'webhooks:admin']);
  });
});
