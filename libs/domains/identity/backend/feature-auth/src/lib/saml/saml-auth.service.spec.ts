import { createHash } from 'node:crypto';

import { UserRole } from '@forepath/identity/backend';
import { getTenantIdOrDefault } from '@forepath/shared/backend';
import { UnauthorizedException } from '@nestjs/common';

import { SamlAuthService, sanitizeSamlRedirectPath } from './saml-auth.service';

const validatePostResponseAsync = jest.fn();
const getAuthorizeUrlAsync = jest.fn();
const samlOptions: Array<Record<string, unknown>> = [];

jest.mock('@node-saml/node-saml', () => {
  const actual = jest.requireActual('@node-saml/node-saml');

  return {
    ...actual,
    SAML: jest.fn().mockImplementation((options: Record<string, unknown>) => {
      samlOptions.push(options);

      return {
        validatePostResponseAsync,
        getAuthorizeUrlAsync: (relayState: string) => getAuthorizeUrlAsync(relayState, options),
        generateServiceProviderMetadata: () => '<EntityDescriptor/>',
      };
    }),
  };
});

const VERIFIER = 'v'.repeat(43);
const CHALLENGE = createHash('sha256').update(VERIFIER, 'ascii').digest('base64url');

interface StoredState {
  kind: string;
  data: Record<string, unknown>;
}

describe('SamlAuthService', () => {
  const envBackup = { ...process.env };
  let store: Map<string, StoredState>;
  let states: Record<string, jest.Mock>;
  let resolveUser: jest.Mock;
  let findById: jest.Mock;
  let issueExternalSessionToken: jest.Mock;
  let service: SamlAuthService;

  beforeEach(() => {
    process.env = {
      ...envBackup,
      SAML_IDP_SSO_URL: 'https://idp.example.com/sso',
      SAML_IDP_CERT: 'MIIB'.padEnd(80, 'A'),
      SAML_SP_ACS_URL: 'https://console.example.com/api/auth/saml/acs',
      SAML_FRONTEND_CALLBACK_URL: 'https://console.example.com/login/saml/callback',
    };
    samlOptions.length = 0;
    validatePostResponseAsync.mockReset();
    getAuthorizeUrlAsync.mockReset().mockImplementation(async (relayState: string) => {
      return `https://idp.example.com/sso?RelayState=${relayState}`;
    });
    store = new Map();
    states = {
      save: jest.fn(async (kind: string, key: string, _expiresAt: Date, data: Record<string, unknown> = {}) => {
        store.set(`${kind}:${key}`, { kind, data: { ...data, tenantId: getTenantIdOrDefault() } });
      }),
      consumeForAnyTenant: jest.fn(async (kind: string, key: string) => {
        const entry = store.get(`${kind}:${key}`);

        store.delete(`${kind}:${key}`);

        return entry ? { ...entry.data } : null;
      }),
      consume: jest.fn(async (kind: string, key: string) => {
        const entry = store.get(`${kind}:${key}`);

        store.delete(`${kind}:${key}`);

        return entry ? { ...entry.data } : null;
      }),
      peek: jest.fn(),
      saveIfAbsent: jest.fn(),
    };
    resolveUser = jest.fn().mockResolvedValue({ id: 'user-1' });
    findById = jest.fn().mockResolvedValue({
      id: 'user-1',
      tenantId: 'default',
      role: UserRole.USER,
      externalProvider: 'saml',
      lockedAt: null,
    });
    issueExternalSessionToken = jest.fn().mockReturnValue('session.jwt');
    service = new SamlAuthService(
      states as never,
      { resolveUser } as never,
      { findById } as never,
      { issueExternalSessionToken } as never,
    );
  });

  afterAll(() => {
    process.env = envBackup;
  });

  async function startLogin(redirect: unknown = '/clients?x=1'): Promise<{ relayState: string; requestId: string }> {
    await service.createLoginRedirect(CHALLENGE, redirect);

    const relayState = getAuthorizeUrlAsync.mock.calls.at(-1)![0] as string;
    const options = getAuthorizeUrlAsync.mock.calls.at(-1)![1] as { generateUniqueId: () => string };

    return { relayState, requestId: options.generateUniqueId() };
  }

  function codeFrom(location: string): string {
    return new URL(location).searchParams.get('code')!;
  }

  it('configures node-saml securely', async () => {
    await startLogin();

    expect(samlOptions[0]).toMatchObject({
      wantAssertionsSigned: true,
      wantAuthnResponseSigned: true,
      validateInResponseTo: 'always',
      rejectReplayedAssertions: true,
      audience: 'https://console.example.com',
      signatureAlgorithm: 'sha256',
    });
  });

  it('requires a PKCE S256 challenge', async () => {
    await expect(service.createLoginRedirect(undefined, '/')).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.createLoginRedirect('short', '/')).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('completes the flow: ACS → one-time code → session JWT', async () => {
    const { relayState, requestId } = await startLogin();

    validatePostResponseAsync.mockResolvedValue({
      loggedOut: false,
      profile: {
        nameID: 'persistent-id',
        nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:persistent',
        inResponseTo: requestId,
        email: 'u@example.com',
      },
    });

    const location = await service.handleAssertionConsumerService({ SAMLResponse: 'PHNhbWw+', RelayState: relayState });
    const url = new URL(location);

    expect(url.origin + url.pathname).toBe('https://console.example.com/login/saml/callback');
    expect(url.searchParams.get('redirect')).toBe('/clients?x=1');
    expect(resolveUser).toHaveBeenCalledWith({ provider: 'saml', subject: 'persistent-id', email: 'u@example.com' });

    await expect(service.exchangeCode(codeFrom(location), VERIFIER)).resolves.toEqual({ access_token: 'session.jwt' });
    expect(issueExternalSessionToken).toHaveBeenCalledWith(expect.objectContaining({ id: 'user-1' }), 'saml');

    // single use
    await expect(service.exchangeCode(codeFrom(location), VERIFIER)).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects the code with a wrong PKCE verifier (login CSRF / interception)', async () => {
    const { relayState, requestId } = await startLogin();

    validatePostResponseAsync.mockResolvedValue({
      loggedOut: false,
      profile: { nameID: 'p', nameIDFormat: 'persistent', inResponseTo: requestId },
    });

    const location = await service.handleAssertionConsumerService({ SAMLResponse: 'x', RelayState: relayState });

    await expect(service.exchangeCode(codeFrom(location), 'w'.repeat(43))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it.each([
    ['IdP-initiated responses (no RelayState)', () => ({ SAMLResponse: 'x' })],
    ['unknown RelayState', () => ({ SAMLResponse: 'x', RelayState: 'forged' })],
    ['missing SAMLResponse', () => ({ RelayState: 'r' })],
  ])('redirects with an error for %s', async (_label, body) => {
    const location = await service.handleAssertionConsumerService(body() as never);

    expect(new URL(location).searchParams.get('error')).toBe('saml_failed');
    expect(new URL(location).searchParams.get('code')).toBeNull();
    expect(resolveUser).not.toHaveBeenCalled();
  });

  it('rejects responses that answer another request than the one bound to RelayState', async () => {
    const { relayState } = await startLogin();

    validatePostResponseAsync.mockResolvedValue({
      loggedOut: false,
      profile: { nameID: 'p', nameIDFormat: 'persistent', inResponseTo: '_other-request' },
    });

    const location = await service.handleAssertionConsumerService({ SAMLResponse: 'x', RelayState: relayState });

    expect(new URL(location).searchParams.get('error')).toBe('saml_failed');
    expect(resolveUser).not.toHaveBeenCalled();
  });

  it('rejects invalid signatures / assertions reported by node-saml', async () => {
    const { relayState } = await startLogin();

    validatePostResponseAsync.mockRejectedValue(new Error('Invalid signature'));

    const location = await service.handleAssertionConsumerService({ SAMLResponse: 'x', RelayState: relayState });

    expect(new URL(location).searchParams.get('error')).toBe('saml_failed');
  });

  it('rejects transient NameIDs', async () => {
    const { relayState, requestId } = await startLogin();

    validatePostResponseAsync.mockResolvedValue({
      loggedOut: false,
      profile: {
        nameID: 'random',
        nameIDFormat: 'urn:oasis:names:tc:SAML:2.0:nameid-format:transient',
        inResponseTo: requestId,
      },
    });

    const location = await service.handleAssertionConsumerService({ SAMLResponse: 'x', RelayState: relayState });

    expect(new URL(location).searchParams.get('error')).toBe('saml_failed');
  });

  it('refuses codes for locked users or users of another provider', async () => {
    const { relayState, requestId } = await startLogin();

    validatePostResponseAsync.mockResolvedValue({
      loggedOut: false,
      profile: { nameID: 'p', nameIDFormat: 'persistent', inResponseTo: requestId },
    });

    const location = await service.handleAssertionConsumerService({ SAMLResponse: 'x', RelayState: relayState });

    findById.mockResolvedValue({ id: 'user-1', tenantId: 'default', externalProvider: 'saml', lockedAt: new Date() });
    await expect(service.exchangeCode(codeFrom(location), VERIFIER)).rejects.toThrow(/locked/);
  });

  describe('tenants (browser redirects carry no X-Tenant header)', () => {
    beforeEach(() => {
      process.env.TENANTS = 'acme,globex';
    });

    afterEach(() => {
      delete process.env.TENANTS;
      delete process.env.TENANTS_ALLOW_DEFAULT;
    });

    it('binds the requested tenant to the relay state and resolves the user in that tenant at the ACS', async () => {
      await service.createLoginRedirect(CHALLENGE, '/', 'acme');

      const relayState = getAuthorizeUrlAsync.mock.calls.at(-1)![0] as string;
      const requestId = (
        getAuthorizeUrlAsync.mock.calls.at(-1)![1] as { generateUniqueId: () => string }
      ).generateUniqueId();

      expect(store.get(`saml_relay:${relayState}`)?.data.tenantId).toBe('acme');

      let tenantDuringResolve: string | undefined;

      resolveUser.mockImplementation(async () => {
        tenantDuringResolve = getTenantIdOrDefault();

        return { id: 'user-1' };
      });
      validatePostResponseAsync.mockResolvedValue({
        loggedOut: false,
        profile: { nameID: 'p', nameIDFormat: 'persistent', inResponseTo: requestId },
      });

      const location = await service.handleAssertionConsumerService({ SAMLResponse: 'x', RelayState: relayState });
      const code = new URL(location).searchParams.get('code')!;

      expect(tenantDuringResolve).toBe('acme');
      expect(store.get(`saml_code:${code}`)?.data.tenantId).toBe('acme');
    });

    it('rejects unknown tenants and a missing tenant when the default tenant is disabled', async () => {
      await expect(service.createLoginRedirect(CHALLENGE, '/', 'evil')).rejects.toThrow(/tenant/);
      await expect(service.createLoginRedirect(CHALLENGE, '/', '../acme')).rejects.toThrow(/tenant/);

      process.env.TENANTS_ALLOW_DEFAULT = 'false';
      await expect(service.createLoginRedirect(CHALLENGE, '/')).rejects.toThrow(/tenant/);
      expect(states.save).not.toHaveBeenCalled();
    });
  });

  it('rejects malformed codes without touching the store', async () => {
    await expect(service.exchangeCode('fp_apc_x', VERIFIER)).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(service.exchangeCode(42, VERIFIER)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(states.consume).not.toHaveBeenCalled();
  });
});

describe('sanitizeSamlRedirectPath', () => {
  it.each([
    ['/clients', '/clients'],
    ['/a?b=c#d', '/a?b=c#d'],
    ['https://evil.com', '/'],
    ['//evil.com', '/'],
    ['/\\evil.com', '/'],
    ['/a\nb', '/'],
    ['', '/'],
    [undefined, '/'],
    ['/' + 'x'.repeat(5000), '/'],
  ])('%s → %s', (input, expected) => {
    expect(sanitizeSamlRedirectPath(input)).toBe(expected);
  });
});
