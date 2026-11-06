import { readOidcResourceServerConfig } from './oidc.config';

describe('readOidcResourceServerConfig', () => {
  const base = {
    OIDC_ISSUER: 'https://idp.example.com/realms/test',
    OIDC_CLIENT_ID: 'api',
    OIDC_CLIENT_SECRET: 'secret',
  };

  it('defaults to ONLINE validation, asymmetric algorithms and the standard discovery URL', () => {
    const config = readOidcResourceServerConfig({ ...base });

    expect(config.tokenValidation).toBe('ONLINE');
    expect(config.discoveryUrl).toBe('https://idp.example.com/realms/test/.well-known/openid-configuration');
    expect(config.algorithms).toContain('RS256');
    expect(config.algorithms.some((alg) => alg.startsWith('HS'))).toBe(false);
    expect(config.emailClaim).toBe('email');
  });

  it('requires an issuer', () => {
    expect(() => readOidcResourceServerConfig({})).toThrow(/OIDC_ISSUER/);
  });

  it('requires client credentials for ONLINE validation', () => {
    expect(() => readOidcResourceServerConfig({ OIDC_ISSUER: base.OIDC_ISSUER })).toThrow(/introspection/);
    expect(
      readOidcResourceServerConfig({ OIDC_ISSUER: base.OIDC_ISSUER, OIDC_TOKEN_VALIDATION: 'offline' }).tokenValidation,
    ).toBe('OFFLINE');
  });

  it('rejects the former NONE validation and symmetric algorithms', () => {
    expect(() => readOidcResourceServerConfig({ ...base, OIDC_TOKEN_VALIDATION: 'NONE' })).toThrow();
    expect(() => readOidcResourceServerConfig({ ...base, OIDC_ALLOWED_ALGORITHMS: 'RS256,HS256' })).toThrow(/HS256/);
  });

  it('rejects non-http issuers and credentials in URLs', () => {
    expect(() => readOidcResourceServerConfig({ ...base, OIDC_ISSUER: 'file:///etc/passwd' })).toThrow();
    expect(() => readOidcResourceServerConfig({ ...base, OIDC_ISSUER: 'https://u:p@idp.example.com' })).toThrow();
  });

  it('parses audience and authorized party allowlists', () => {
    const config = readOidcResourceServerConfig({ ...base, OIDC_AUDIENCE: 'a, b,', OIDC_AUTHORIZED_PARTIES: 'c' });

    expect(config.audiences).toEqual(['a', 'b']);
    expect(config.authorizedParties).toEqual(['c']);
  });

  describe('production', () => {
    const prod = { ...base, NODE_ENV: 'production', OIDC_ISSUER: 'https://idp.example.com/realms/test' };

    it('requires an audience or authorized-party restriction (opt-out available)', () => {
      expect(() => readOidcResourceServerConfig(prod)).toThrow(/OIDC_AUDIENCE or OIDC_AUTHORIZED_PARTIES/);
      expect(readOidcResourceServerConfig({ ...prod, OIDC_AUDIENCE: 'api' }).audiences).toEqual(['api']);
      expect(readOidcResourceServerConfig({ ...prod, OIDC_AUTHORIZED_PARTIES: 'c' }).authorizedParties).toEqual(['c']);
      expect(() => readOidcResourceServerConfig({ ...prod, OIDC_ALLOW_UNRESTRICTED_AUDIENCE: 'true' })).not.toThrow();
    });

    it('requires https for the provider unless explicitly allowed', () => {
      const http = { ...prod, OIDC_AUDIENCE: 'api', OIDC_ISSUER: 'http://idp.example.com/realms/test' };

      expect(() => readOidcResourceServerConfig(http)).toThrow(/https/);
      expect(() => readOidcResourceServerConfig({ ...http, OIDC_ALLOW_INSECURE_HTTP: 'true' })).not.toThrow();
    });
  });
});
