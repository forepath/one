import { generateKeyPairSync, verify } from 'node:crypto';

import type { PlatformCredentialsService } from '../services/platform-credentials.service';
import {
  githubAppJwt,
  GitHubAppTokens,
  linkedInstanceApiBase,
  sameApiBase,
  type GitBotConfigService,
} from './github-app';
import * as providers from './providers';

jest.mock('./providers', () => ({ ...jest.requireActual('./providers'), providerRequest: jest.fn() }));

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = privateKey.export({ type: 'pkcs1', format: 'pem' }) as string;

describe('GitHub App (3.30)', () => {
  it('signs an RS256 app JWT valid for 9 minutes, issued 60 s back', () => {
    const now = Date.parse('2026-10-18T10:00:00Z');
    const jwt = githubAppJwt(12345, pem, now);
    const [header, payload, signature] = jwt.split('.');

    expect(JSON.parse(Buffer.from(header, 'base64url').toString())).toEqual({ alg: 'RS256', typ: 'JWT' });
    expect(JSON.parse(Buffer.from(payload, 'base64url').toString())).toEqual({
      iat: now / 1000 - 60,
      exp: now / 1000 - 60 + 540,
      iss: '12345',
    });
    expect(
      verify('RSA-SHA256', Buffer.from(`${header}.${payload}`), publicKey, Buffer.from(signature, 'base64url')),
    ).toBe(true);

    const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' }).privateKey.export({
      type: 'pkcs8',
      format: 'pem',
    }) as string;

    expect(() => githubAppJwt(1, ec)).toThrow('must be an RSA key');
  });

  it('gets installation tokens (installation of the repository, then a token) and caches them', async () => {
    const request = providers.providerRequest as jest.Mock;
    const config = {
      config: async () => ({
        github: {
          appId: 7,
          privateKey: 'secret://ops/app-key',
          webUrl: 'https://github.com',
          apiUrl: 'https://api.github.com/',
          caCertificate: 'CLUSTER-CA',
        },
      }),
    } as unknown as GitBotConfigService;
    const credentials = {
      providerConfig: jest.fn(async () => ({ apiToken: pem })),
    } as unknown as PlatformCredentialsService;
    const tokens = new GitHubAppTokens(config, credentials);

    request.mockResolvedValueOnce({ status: 200, json: { id: 99 } }).mockResolvedValueOnce({
      status: 201,
      json: { token: 'ghs_installation', expires_at: new Date(Date.now() + 3_600_000).toISOString() },
    });

    // Always the cluster's configured GitHub API and CA (L6), whatever a connection says.
    expect(await tokens.installationToken('acme/infra')).toBe('ghs_installation');
    expect(request.mock.calls[0][0]).toMatchObject({ caCertificate: 'CLUSTER-CA' });
    expect(request.mock.calls[0].slice(1, 3)).toEqual(['GET', 'https://api.github.com/repos/acme/infra/installation']);
    expect(request.mock.calls[0][3].authorization).toMatch(/^Bearer [\w-]+\.[\w-]+\.[\w-]+$/);
    expect(request.mock.calls[1].slice(1, 3)).toEqual([
      'POST',
      'https://api.github.com/app/installations/99/access_tokens',
    ]);
    expect(request.mock.calls[1][4]).toEqual({ repositories: ['infra'] });

    // Cached until shortly before it expires.
    expect(await tokens.installationToken('acme/infra')).toBe('ghs_installation');
    expect(request).toHaveBeenCalledTimes(2);

    request.mockResolvedValueOnce({ status: 404, json: { message: 'Not Found' } });
    await expect(tokens.installationToken('acme/other')).rejects.toThrow(
      'GitHub App installation for acme/other: HTTP 404 (Not Found)',
    );
    expect(await tokens.configured()).toBe(true);
    expect(await tokens.appInstance()).toEqual({
      apiBase: 'https://api.github.com',
      hosts: ['api.github.com', 'github.com'],
    });
  });

  it('is off without an app', async () => {
    const tokens = new GitHubAppTokens(
      { config: async () => ({}) } as unknown as GitBotConfigService,
      {} as PlatformCredentialsService,
    );

    expect(await tokens.installationToken('a/b')).toBeNull();
    expect(await tokens.configured()).toBe(false);
    expect(await tokens.appInstance()).toBeNull();
  });

  it('knows the instance Git accounts are linked on', () => {
    expect(linkedInstanceApiBase('github', {})).toBe('https://api.github.com');
    expect(
      linkedInstanceApiBase('github', {
        github: { webUrl: 'https://ghe.example.com', apiUrl: 'https://GHE.example.com/api/v3/' },
      }),
    ).toBe('https://ghe.example.com/api/v3');
    expect(linkedInstanceApiBase('gitlab', { gitlab: { url: 'https://gitlab.example.com/' } })).toBe(
      'https://gitlab.example.com/api/v4',
    );
    expect(sameApiBase('https://gitlab.example.com/api/v4/', 'https://GITLAB.example.com/api/v4')).toBe(true);
    expect(sameApiBase('https://gitlab.example.com:8443/api/v4', 'https://gitlab.example.com/api/v4')).toBe(false);
    expect(sameApiBase('https://evil.example.com/api/v4', 'https://gitlab.example.com/api/v4')).toBe(false);
    expect(sameApiBase(null, 'https://gitlab.example.com/api/v4')).toBe(false);
  });
});
