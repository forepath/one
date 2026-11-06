import { formatEnvLines } from '../../utils/cloud-init/env.utils';

import {
  assertConsoleOidcConfig,
  buildConsoleAuthenticationConfig,
  buildOidcEnvLines,
  buildSamlEnvLines,
  normalizeCertificateBody,
  readProvisionedOidcConfig,
  readProvisionedSamlConfig,
  resolveConsoleAuthenticationMethod,
  resolveManagerAuthenticationMethod,
  toNginxJsonReturnBody,
  toSingleLineValue,
} from './external-auth-config.utils';

describe('external-auth-config.utils', () => {
  describe('resolve*AuthenticationMethod', () => {
    it.each([
      ['users', 'users'],
      ['api-key', 'api-key'],
      ['oidc', 'oidc'],
      ['saml', 'saml'],
      [undefined, 'users'],
      ['', 'users'],
    ])('console %s → %s', (input, expected) => {
      expect(resolveConsoleAuthenticationMethod(input)).toBe(expected);
    });

    it('rejects the removed keycloak method and unknown console methods (no silent fallback to open sign-up)', () => {
      expect(() => resolveConsoleAuthenticationMethod('keycloak')).toThrow(/no longer supported/);
      expect(() => resolveConsoleAuthenticationMethod('OIDC')).toThrow(/Unsupported authenticationMethod/);
    });

    it.each([
      ['oidc', 'oidc'],
      ['api-key', 'api-key'],
      ['saml', 'api-key'],
      ['users', 'api-key'],
      ['keycloak', 'api-key'],
      [undefined, 'api-key'],
    ])('manager %s → %s', (input, expected) => {
      expect(resolveManagerAuthenticationMethod(input)).toBe(expected);
    });
  });

  describe('toSingleLineValue', () => {
    it('removes line breaks and control characters', () => {
      expect(toSingleLineValue('a\nb\r\nc\td\u0000')).toBe('a b c d');
      expect(toSingleLineValue(undefined)).toBe('');
      expect(toSingleLineValue(42)).toBe('42');
    });
  });

  describe('normalizeCertificateBody', () => {
    it('strips PEM armor and whitespace', () => {
      expect(
        normalizeCertificateBody('-----BEGIN CERTIFICATE-----\nMIIB\n  AbC+/==\n-----END CERTIFICATE-----\n'),
      ).toBe('MIIBAbC+/==');
    });

    it('accepts a bare base64 body', () => {
      expect(normalizeCertificateBody('MIIBAbC=')).toBe('MIIBAbC=');
    });

    it('drops values that are not base64 (no injection through the certificate)', () => {
      expect(normalizeCertificateBody("MIIB'\nEVIL: x")).toBe('');
      expect(normalizeCertificateBody(undefined)).toBe('');
    });
  });

  describe('read*Config', () => {
    it('returns undefined when the object is missing', () => {
      expect(readProvisionedOidcConfig(undefined)).toBeUndefined();
      expect(readProvisionedSamlConfig('x')).toBeUndefined();
    });

    it('normalizes oidc and saml values', () => {
      expect(
        readProvisionedOidcConfig({ issuer: ' https://idp\n', clientId: 'c', clientSecret: 's', audience: '' }),
      ).toEqual({
        issuer: 'https://idp',
        clientId: 'c',
        clientSecret: 's',
        audience: undefined,
        frontendClientId: undefined,
      });
      expect(readProvisionedSamlConfig({ idpSsoUrl: 'https://idp/sso', idpCert: 'MIIB\nAB==' })).toMatchObject({
        idpSsoUrl: 'https://idp/sso',
        idpCert: 'MIIBAB==',
      });
    });
  });

  describe('env lines', () => {
    it('emits nothing for other methods', () => {
      expect(buildOidcEnvLines('users', { issuer: 'i', clientId: 'c', clientSecret: 's' })).toEqual([]);
      expect(buildSamlEnvLines('oidc', { idpSsoUrl: 'u', idpCert: 'AA==' }, 'h.example.com')).toEqual([]);
    });

    it('restricts console backends to a dedicated console client (azp), never the API client itself', () => {
      expect(
        buildOidcEnvLines('oidc', { issuer: 'https://idp', clientId: 'c', clientSecret: 's' }).join('\n'),
      ).not.toContain('OIDC_AUTHORIZED_PARTIES');
      expect(
        buildOidcEnvLines('oidc', {
          issuer: 'https://idp',
          clientId: 'c',
          clientSecret: 's',
          frontendClientId: 'c',
        }).join('\n'),
      ).not.toContain('OIDC_AUTHORIZED_PARTIES');
      expect(
        buildOidcEnvLines('oidc', { issuer: 'https://idp', clientId: 'c', clientSecret: 's', frontendClientId: 'spa' }),
      ).toContain('OIDC_AUTHORIZED_PARTIES: spa');
    });

    it('gives managers OFFLINE validation pinned to the controller client and never the secret', () => {
      const lines = buildOidcEnvLines(
        'oidc',
        { issuer: 'https://idp', clientId: 'c', clientSecret: 's' },
        { role: 'manager' },
      );

      expect(lines).toEqual([
        'OIDC_ISSUER: https://idp',
        'OIDC_TOKEN_VALIDATION: OFFLINE',
        'OIDC_AUTHORIZED_PARTIES: c',
      ]);
    });

    it('honours an explicit SP entity id and optional SAML settings', () => {
      expect(
        buildSamlEnvLines(
          'saml',
          {
            idpSsoUrl: 'https://idp/sso',
            idpCert: 'AA==',
            spEntityId: 'urn:sp',
            nameIdFormat: 'urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
            emailAttribute: 'mail',
          },
          'h.example.com',
        ),
      ).toEqual([
        'SAML_IDP_SSO_URL: https://idp/sso',
        'SAML_IDP_CERT: AA==',
        'SAML_SP_ENTITY_ID: urn:sp',
        'SAML_SP_ACS_URL: https://h.example.com/api/auth/saml/acs',
        'SAML_FRONTEND_CALLBACK_URL: https://h.example.com/login/saml/callback',
        'SAML_NAMEID_FORMAT: urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress',
        'SAML_EMAIL_ATTRIBUTE: mail',
      ]);
    });

    it('yields exactly one compose env line per variable even for hostile values', () => {
      const lines = buildOidcEnvLines('oidc', {
        issuer: "https://idp'\nEOF\necho pwned",
        clientId: 'c\n      INJECTED: 1',
        clientSecret: "s'#",
      });
      const yaml = formatEnvLines(lines);

      expect(yaml.split('\n')).toHaveLength(lines.length);
      expect(yaml).not.toMatch(/^\s*INJECTED: 1$/m);
      expect(yaml).not.toMatch(/^EOF$/m);
    });
  });

  describe('buildConsoleAuthenticationConfig', () => {
    it('builds the runtime config per method', () => {
      expect(buildConsoleAuthenticationConfig('users', { disableSignup: true })).toEqual({
        type: 'users',
        disableSignup: true,
      });
      expect(buildConsoleAuthenticationConfig('api-key', {})).toEqual({ type: 'api-key' });
      expect(buildConsoleAuthenticationConfig('saml', {})).toEqual({ type: 'saml' });
      expect(
        buildConsoleAuthenticationConfig('oidc', {
          oidc: { issuer: 'https://idp', clientId: 'api', clientSecret: 's' },
        }),
      ).toEqual({ type: 'oidc', issuer: 'https://idp', clientId: 'api' });
      expect(
        buildConsoleAuthenticationConfig('oidc', {
          oidc: { issuer: 'https://idp', clientId: 'api', clientSecret: 's', frontendClientId: 'spa' },
        }),
      ).toEqual({ type: 'oidc', issuer: 'https://idp', clientId: 'spa' });
    });
  });

  describe('assertConsoleOidcConfig', () => {
    const base = { issuer: 'https://idp.example.com/realms/r', clientId: 'api', clientSecret: 's' };

    it('accepts a distinct console client or an audience', () => {
      expect(() => assertConsoleOidcConfig('oidc', { ...base, frontendClientId: 'console' })).not.toThrow();
      expect(() => assertConsoleOidcConfig('oidc', { ...base, audience: 'api' })).not.toThrow();
      expect(() => assertConsoleOidcConfig('users', undefined)).not.toThrow();
    });

    it('rejects configs where the console API would accept the service client tokens', () => {
      expect(() => assertConsoleOidcConfig('oidc', base)).toThrow(/frontendClientId/);
      expect(() => assertConsoleOidcConfig('oidc', { ...base, frontendClientId: 'api' })).toThrow(/frontendClientId/);
      expect(() => assertConsoleOidcConfig('oidc', { ...base, clientSecret: '' })).toThrow(/required/);
    });
  });

  describe('toNginxJsonReturnBody', () => {
    /** nginx quoted-string parsing: a backslash escapes the next character. */
    const nginxUnquote = (body: string) => body.replace(/\\(.)/g, '$1');

    it('round-trips any value and never contains a raw quote or $', () => {
      const config = {
        authentication: { config: { type: 'oidc', issuer: 'https://x/\'; evil $host \\ "q"', clientId: 'c' } },
        nested: ['a\nb', 'ü€'],
      };
      const body = toNginxJsonReturnBody(config);

      expect(body).not.toMatch(/'/);
      expect(body).not.toMatch(/\$/);
      expect(JSON.parse(nginxUnquote(body))).toEqual(config);
    });
  });

  describe('readProvisionedOidcConfig validation', () => {
    it('accepts regular values', () => {
      expect(
        readProvisionedOidcConfig({
          issuer: 'https://login.microsoftonline.com/tenant-id/v2.0',
          clientId: 'api://agenstra',
          clientSecret: 's',
          frontendClientId: '0b1c-console',
          audience: 'api://agenstra,account',
        }),
      ).toMatchObject({ clientId: 'api://agenstra' });
    });

    it.each([
      [{ issuer: 'https://u:p@idp.example.com' }],
      [{ issuer: 'javascript:alert(1)' }],
      [{ issuer: 'https://idp.example.com', clientId: "c'" }],
      [{ issuer: 'https://idp.example.com', frontendClientId: 'a b' }],
      [{ issuer: 'https://idp.example.com', audience: 'a$b' }],
    ])('rejects %j', (raw) => {
      expect(() => readProvisionedOidcConfig({ clientId: 'c', clientSecret: 's', ...raw })).toThrow();
    });
  });
});
