import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';

import type { INestApplication } from '@nestjs/common';

import { docker } from './postgres.container';

/**
 * Forced email login 2FA with SMTP configured (M7 gate G6, counterpart of the "no SMTP" case in
 * `workspace-access.integration.spec.ts`): against a MailHog container the password alone answers
 * `LOGIN_2FA_REQUIRED` (method email), the code arrives by mail (through the control plane's queued delivery) and
 * logs the user in; cluster admins see no suspension warning.
 */

/** Same digest-pinned image as docker-compose.yaml. */
const MAILHOG_IMAGE =
  'docker.io/mailhog/mailhog:latest@sha256:8d76a3d4ffa32a3661311944007a415332c4bb855657f4f6c57996405c009bea';
const PASSWORD = 'Sup3r-Secret-Passw0rd!';
const EMAIL = 'ops@example.test';

// Users mode with forced email login 2FA (DISABLE_FORCE_LOGIN_2FA unset); set before the app module is loaded.
Object.assign(process.env, {
  AUTHENTICATION_METHOD: 'users',
  JWT_SECRET: 'email-2fa-smtp-integration-jwt-secret-0123456789',
  EMAIL_FROM: 'loadweaver@example.test',
});
delete process.env['DISABLE_FORCE_LOGIN_2FA'];

describe('Email login 2FA with SMTP (integration, users mode)', () => {
  const mailhog = `lw-cp-it-mailhog-${process.pid}-${randomBytes(3).toString('hex')}`;
  let mailhogApi = '';
  let app: INestApplication | undefined;
  let baseUrl: string;

  const api = async (
    method: string,
    path: string,
    body?: unknown,
    token?: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the test helper returns arbitrary JSON response bodies
  ): Promise<{ status: number; json: any }> => {
    const res = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();

    return { status: res.status, json: text ? JSON.parse(text) : null };
  };

  /** The newest mail to `to` in MailHog (decoded body), waiting for its delivery. */
  const mailTo = async (to: string, timeoutMs = 30_000): Promise<string> => {
    const start = Date.now();

    for (;;) {
      const res = await fetch(`${mailhogApi}/api/v2/search?kind=to&query=${encodeURIComponent(to)}`).catch(() => null);
      const items = res?.ok
        ? ((await res.json()) as { items: { Content: { Body: string; Headers: Record<string, string[]> } }[] }).items
        : [];

      if (items.length > 0) {
        const { Body, Headers } = items[0].Content;
        const encoding = (Headers['Content-Transfer-Encoding'] ?? [''])[0].toLowerCase();

        return encoding === 'quoted-printable'
          ? Body.replace(/=\r?\n/g, '').replace(/=([0-9A-F]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
          : encoding === 'base64'
            ? Buffer.from(Body, 'base64').toString('utf8')
            : Body;
      }

      if (Date.now() - start > timeoutMs) throw new Error(`no mail to ${to} within ${timeoutMs} ms`);

      await new Promise((r) => setTimeout(r, 300));
    }
  };

  beforeAll(async () => {
    docker([
      'run',
      '-d',
      '--rm',
      '--name',
      mailhog,
      '--memory',
      '64m',
      '-p',
      '127.0.0.1::1025',
      '-p',
      '127.0.0.1::8025',
      MAILHOG_IMAGE,
    ]);

    const port = (container: string) => {
      const mapping = docker(['port', mailhog, container]).split('\n')[0];

      return mapping.slice(mapping.lastIndexOf(':') + 1);
    };

    mailhogApi = `http://127.0.0.1:${port('8025/tcp')}`;
    // EmailService reads SMTP_HOST / SMTP_PORT when the app is created.
    Object.assign(process.env, { SMTP_HOST: '127.0.0.1', SMTP_PORT: port('1025/tcp') });

    for (let attempt = 0; ; attempt++) {
      const ready = await fetch(`${mailhogApi}/api/v2/messages`)
        .then((r) => r.ok)
        .catch(() => false);

      if (ready) break;

      if (attempt > 60) throw new Error('MailHog did not become ready');

      await new Promise((r) => setTimeout(r, 250));
    }

    const { createApp } = await import('../bootstrap');

    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  }, 180_000);

  afterAll(async () => {
    await app?.close();

    try {
      docker(['rm', '-f', mailhog]);
    } catch {
      // not started
    }
  });

  it('requires the emailed code after the password and accepts it', async () => {
    expect((await api('POST', '/auth/register', { email: EMAIL, password: PASSWORD })).status).toBe(201);

    const first = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD });

    expect(first.status).toBe(401);
    expect(first.json).toMatchObject({ code: 'LOGIN_2FA_REQUIRED', method: 'email' });
    expect(first.json.access_token).toBeUndefined();

    const body = await mailTo(EMAIL);
    const code = /\b([A-Z0-9]{6})\b/.exec(body.replace(/<[^>]+>/g, ' '))?.[1];

    expect(code).toBeDefined();

    // A wrong code is refused, the mailed one logs in.
    const wrong = await api('POST', '/auth/login', {
      email: EMAIL,
      password: PASSWORD,
      code: code === 'ZZZZZZ' ? 'YYYYYY' : 'ZZZZZZ',
    });

    expect(wrong.status).toBe(401);
    expect(wrong.json.code).not.toBe('LOGIN_2FA_REQUIRED');

    const ok = await api('POST', '/auth/login', { email: EMAIL, password: PASSWORD, code });

    expect(ok.status).toBe(200);
    expect(ok.json.access_token).toEqual(expect.any(String));

    // Delivery works: no suspension warning, the forced policy is in effect.
    expect((await api('GET', '/access/me', undefined, ok.json.access_token)).json).toMatchObject({
      clusterRole: 'cluster-admin',
      emailLogin2faSuspended: false,
    });
    expect((await api('GET', '/auth/2fa', undefined, ok.json.access_token)).json).toMatchObject({
      forceEnabled: true,
    });
  });
});
