import { usesAppSessionJwt, usesExternalSignIn, usesStaticCredential } from './auth-environment';

describe('auth-environment helpers', () => {
  it.each([
    ['api-key', true, false, false],
    ['mtls', true, false, false],
    ['users', false, true, false],
    ['saml', false, true, true],
    ['oidc', false, false, true],
    [null, false, false, false],
    [undefined, false, false, false],
  ] as const)('%s → static %s, session JWT %s, external %s', (type, staticCredential, sessionJwt, external) => {
    expect(usesStaticCredential(type)).toBe(staticCredential);
    expect(usesAppSessionJwt(type)).toBe(sessionJwt);
    expect(usesExternalSignIn(type)).toBe(external);
  });
});
