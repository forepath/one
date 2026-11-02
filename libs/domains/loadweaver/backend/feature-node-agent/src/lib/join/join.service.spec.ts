import { createHash } from 'node:crypto';

import {
  adminClaimTokenSha256,
  assertSafeServerUrl,
  bootstrapEmailEnvironment,
  caHash,
  JoinService,
  normalizeBootstrapPublicUrl,
  publicUrlEnvironment,
  randomJoinToken,
} from './join.service';

describe('join safety', () => {
  it('only sends tokens over https, or plain http to the local control plane', () => {
    expect(assertSafeServerUrl('https://cp.example.com').origin).toBe('https://cp.example.com');
    expect(assertSafeServerUrl('http://127.0.0.1:3400').port).toBe('3400');
    expect(() => assertSafeServerUrl('http://cp.example.com')).toThrow('must use https');
    expect(() => assertSafeServerUrl('ftp://cp.example.com')).toThrow();
  });

  it('hashes the CA certificate DER for pinning', () => {
    const pem = `-----BEGIN CERTIFICATE-----\n${Buffer.from('hello').toString('base64')}\n-----END CERTIFICATE-----\n`;

    expect(caHash(pem)).toBe('sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('generates tokens in the control plane format', () => {
    expect(randomJoinToken()).toMatch(/^lwj_[a-z0-9]{12}\.[A-Za-z0-9_-]{43}$/);
  });

  it('accepts only a plain https origin as the bootstrap public URL', () => {
    expect(normalizeBootstrapPublicUrl('https://lw-1.example.com/')).toBe('https://lw-1.example.com');
    expect(normalizeBootstrapPublicUrl('https://lw.example.com:8443')).toBe('https://lw.example.com:8443');
    expect(() => normalizeBootstrapPublicUrl('http://lw.example.com')).toThrow('--public-url');
    expect(() => normalizeBootstrapPublicUrl('https://lw.example.com/api')).toThrow('--public-url');
    expect(() => normalizeBootstrapPublicUrl('https://lw.example.com"; rm -rf /')).toThrow('--public-url');
  });

  it('trusts the loopback proxy only when bootstrapped with a public URL', () => {
    expect(publicUrlEnvironment(undefined)).toEqual({});
    expect(publicUrlEnvironment('https://lw.example.com')).toEqual({
      LOADWEAVER_PUBLIC_URL: 'https://lw.example.com',
      CORS_ORIGIN: 'https://lw.example.com',
      LOADWEAVER_TRUST_PROXY: 'loopback',
    });
  });

  it('keeps only the SHA-256 of a valid admin claim token', () => {
    const token = `lwc_${'a'.repeat(43)}`;

    expect(adminClaimTokenSha256(`${token}\n`)).toBe(createHash('sha256').update(token).digest('hex'));
    expect(() => adminClaimTokenSha256('short')).toThrow('admin claim token');
    expect(() => adminClaimTokenSha256(`${'a'.repeat(40)}'; rm -rf /`)).toThrow('admin claim token');
  });

  it('turns the bootstrap email settings into control-plane environment', () => {
    expect(bootstrapEmailEnvironment(undefined)).toEqual({});
    expect(bootstrapEmailEnvironment({ SMTP_HOST: '  ', SMTP_PORT: '' })).toEqual({});
    expect(bootstrapEmailEnvironment({ SMTP_HOST: ' smtp.example.com ' })).toEqual({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
    });
    expect(
      bootstrapEmailEnvironment({
        SMTP_HOST: '192.0.2.10',
        SMTP_PORT: '465',
        SMTP_USER: 'lw',
        SMTP_PASSWORD: ' pass with spaces ',
        EMAIL_FROM: 'Loadweaver <noreply@example.com>',
        EMAIL_COMPANY_EMAIL: 'info@example.com',
      }),
    ).toEqual({
      SMTP_HOST: '192.0.2.10',
      SMTP_PORT: '465',
      SMTP_USER: 'lw',
      SMTP_PASSWORD: ' pass with spaces ',
      EMAIL_FROM: 'Loadweaver <noreply@example.com>',
      EMAIL_COMPANY_EMAIL: 'info@example.com',
    });
  });

  it('refuses incomplete or malformed email settings', () => {
    expect(() => bootstrapEmailEnvironment({ EMAIL_FROM: 'a@example.com' })).toThrow('--smtp-host');
    expect(() => bootstrapEmailEnvironment({ SMTP_PASSWORD: 'p' })).toThrow('--smtp-host');
    expect(() => bootstrapEmailEnvironment({ SMTP_HOST: 'smtp.example.com; rm -rf /' })).toThrow('--smtp-host');
    expect(() => bootstrapEmailEnvironment({ SMTP_HOST: 'smtp.example.com', SMTP_PORT: '70000' })).toThrow(
      '--smtp-port',
    );
    expect(() => bootstrapEmailEnvironment({ SMTP_HOST: 'smtp.example.com', SMTP_USER: 'lw' })).toThrow(
      'both --smtp-user',
    );
    expect(() => bootstrapEmailEnvironment({ SMTP_HOST: 'smtp.example.com', SMTP_PASSWORD: 'p' })).toThrow(
      'both --smtp-user',
    );
    expect(() => bootstrapEmailEnvironment({ SMTP_HOST: 'smtp.example.com', EMAIL_FROM: 'nobody' })).toThrow(
      '--email-from',
    );
    expect(() =>
      bootstrapEmailEnvironment({ SMTP_HOST: 'smtp.example.com', EMAIL_FROM: 'a@example.com\nBcc: x@example.com' }),
    ).toThrow('invalid EMAIL_FROM');
    expect(() =>
      bootstrapEmailEnvironment({ SMTP_HOST: 'smtp.example.com', EMAIL_COMPANY_EMAIL: 'not an address' }),
    ).toThrow('--email-company-email');
  });
});

describe('JoinService.bootstrap admin claim', () => {
  function setup() {
    const state = { credentials: jest.fn().mockResolvedValue(null) };
    const controlPlane = { apply: jest.fn().mockResolvedValue(undefined) };
    const service = new JoinService(state as never, {} as never, controlPlane as never);

    // Stop after the control plane was configured (no API in a unit test).
    jest
      .spyOn(service as unknown as { waitForApi: () => Promise<void> }, 'waitForApi')
      .mockRejectedValue(new Error('stop'));

    return { service, controlPlane };
  }

  it('passes only the token hash to the control-plane environment', async () => {
    const { service, controlPlane } = setup();
    const token = `lwc_${'b'.repeat(43)}`;

    await expect(
      service.bootstrap({ nodeName: 'n1', publicHost: 'lw.example.com', adminClaimToken: token }),
    ).rejects.toThrow('stop');

    const environment = controlPlane.apply.mock.calls[0][2].environment as Record<string, string>;

    expect(environment['ADMIN_CLAIM_TOKEN_SHA256']).toBe(createHash('sha256').update(token).digest('hex'));
    expect(JSON.stringify(environment)).not.toContain(token);
  });

  it('sets no claim without a token (unchanged default)', async () => {
    const { service, controlPlane } = setup();

    await expect(service.bootstrap({ nodeName: 'n1', publicHost: 'lw.example.com' })).rejects.toThrow('stop');
    expect(controlPlane.apply.mock.calls[0][2].environment).not.toHaveProperty('ADMIN_CLAIM_TOKEN_SHA256');
  });
});

describe('JoinService.bootstrap email settings', () => {
  function setup() {
    const state = { credentials: jest.fn().mockResolvedValue(null) };
    const controlPlane = { apply: jest.fn().mockResolvedValue(undefined) };
    const service = new JoinService(state as never, {} as never, controlPlane as never);

    jest
      .spyOn(service as unknown as { waitForApi: () => Promise<void> }, 'waitForApi')
      .mockRejectedValue(new Error('stop'));

    return { service, controlPlane };
  }

  it('puts SMTP into the control-plane environment', async () => {
    const { service, controlPlane } = setup();

    await expect(
      service.bootstrap({
        nodeName: 'n1',
        publicHost: 'lw.example.com',
        email: { SMTP_HOST: 'smtp.example.com', SMTP_USER: 'lw', SMTP_PASSWORD: 'p', EMAIL_FROM: 'lw@example.com' },
      }),
    ).rejects.toThrow('stop');
    expect(controlPlane.apply.mock.calls[0][2].environment).toMatchObject({
      SMTP_HOST: 'smtp.example.com',
      SMTP_PORT: '587',
      SMTP_USER: 'lw',
      SMTP_PASSWORD: 'p',
      EMAIL_FROM: 'lw@example.com',
    });
  });

  it('sets no SMTP without settings and refuses invalid ones before starting anything', async () => {
    const { service, controlPlane } = setup();

    await expect(service.bootstrap({ nodeName: 'n1', publicHost: 'lw.example.com' })).rejects.toThrow('stop');
    expect(controlPlane.apply.mock.calls[0][2].environment).not.toHaveProperty('SMTP_HOST');

    controlPlane.apply.mockClear();
    await expect(
      service.bootstrap({ nodeName: 'n1', publicHost: 'lw.example.com', email: { SMTP_USER: 'lw' } }),
    ).rejects.toThrow('--smtp-host');
    expect(controlPlane.apply).not.toHaveBeenCalled();
  });
});
