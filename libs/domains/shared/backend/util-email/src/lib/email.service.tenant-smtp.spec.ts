import { runWithTenantId } from '@forepath/shared/backend/util-http-context';
import {
  GLOBAL_SETTINGS_SCOPE,
  registerSettingDefinitions,
  resetSettingsOverridesRegistryForTests,
  setSettingsOverride,
  type SettingDefinition,
} from '@forepath/shared/backend/util-settings-overrides';
import * as nodemailer from 'nodemailer';

import { EmailService } from './email.service';

const lookupMock = jest.fn();

jest.mock('nodemailer', () => ({ createTransport: jest.fn() }));
jest.mock('node:dns/promises', () => ({ lookup: (...args: unknown[]) => lookupMock(...args) }));

const createTransport = nodemailer.createTransport as jest.MockedFunction<typeof nodemailer.createTransport>;
const tenantSetting = (key: string): SettingDefinition => ({ key, category: 'email', type: 'string', scope: 'tenant' });

describe('EmailService with console SMTP overrides', () => {
  const originalEnv = process.env;
  const sendMail = jest.fn().mockResolvedValue({});
  const mail = { to: 'a@b.de', subject: 's', text: 't' };
  const lastTransportOptions = () => createTransport.mock.calls.at(-1)?.[0] as unknown as Record<string, unknown>;

  beforeEach(() => {
    jest.clearAllMocks();
    resetSettingsOverridesRegistryForTests();
    registerSettingDefinitions(
      ['SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM'].map(tenantSetting),
    );
    process.env = {
      ...originalEnv,
      SMTP_HOST: 'smtp.operator.example',
      SMTP_PORT: '587',
      SMTP_USER: 'operator',
      SMTP_PASSWORD: 'operator-secret',
      EMAIL_FROM: 'billing@operator.example',
    };
    createTransport.mockReturnValue({ sendMail } as unknown as ReturnType<typeof createTransport>);
  });

  afterAll(() => {
    process.env = originalEnv;
    resetSettingsOverridesRegistryForTests();
  });

  it('never sends deployment credentials to a tenant-chosen server', async () => {
    setSettingsOverride('acme', 'SMTP_HOST', 'smtp.attacker.example');
    lookupMock.mockResolvedValue([{ address: '203.0.113.10', family: 4 }]);

    await runWithTenantId('acme', () => new EmailService().sendOrThrow(mail));

    const options = lastTransportOptions();

    expect(options).toMatchObject({ host: '203.0.113.10', port: 587, tls: { servername: 'smtp.attacker.example' } });
    expect(options['auth']).toBeUndefined();
    expect(JSON.stringify(createTransport.mock.calls.at(-1))).not.toContain('operator-secret');
  });

  it('uses the tenant credentials and sender with the tenant server', async () => {
    setSettingsOverride('acme', 'SMTP_HOST', 'smtp.acme.example');
    setSettingsOverride('acme', 'SMTP_PORT', '465');
    setSettingsOverride('acme', 'SMTP_USER', 'acme');
    setSettingsOverride('acme', 'SMTP_PASSWORD', 'acme-secret');
    setSettingsOverride('acme', 'EMAIL_FROM', 'billing@acme.example');
    lookupMock.mockResolvedValue([{ address: '203.0.113.20', family: 4 }]);

    await runWithTenantId('acme', () => new EmailService().sendOrThrow(mail));

    expect(lastTransportOptions()).toMatchObject({
      port: 465,
      secure: true,
      auth: { user: 'acme', pass: 'acme-secret' },
    });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'billing@acme.example' }));
  });

  it('ignores tenant sender and SMTP overrides without a tenant server', async () => {
    setSettingsOverride('acme', 'EMAIL_FROM', 'ceo@operator.example');
    setSettingsOverride('acme', 'SMTP_PORT', '25');

    await runWithTenantId('acme', () => new EmailService().sendOrThrow(mail));

    expect(lastTransportOptions()).toMatchObject({ host: 'smtp.operator.example', port: 587 });
    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'billing@operator.example' }));
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('applies the override for all tenants to every tenant', async () => {
    setSettingsOverride(GLOBAL_SETTINGS_SCOPE, 'EMAIL_FROM', 'noreply@all.example');

    await runWithTenantId('acme', () => new EmailService().sendOrThrow(mail));

    expect(sendMail).toHaveBeenCalledWith(expect.objectContaining({ from: 'noreply@all.example' }));
  });

  it('rejects tenant servers on private or loopback addresses, also outside production', async () => {
    process.env.NODE_ENV = 'development';
    setSettingsOverride('acme', 'SMTP_HOST', 'internal.example');
    lookupMock.mockResolvedValue([{ address: '10.0.0.5', family: 4 }]);

    await expect(runWithTenantId('acme', () => new EmailService().sendOrThrow(mail))).rejects.toThrow(
      'private or loopback',
    );

    setSettingsOverride('acme', 'SMTP_HOST', '169.254.169.254');
    await expect(runWithTenantId('acme', () => new EmailService().sendOrThrow(mail))).rejects.toThrow(
      'private or loopback',
    );
    expect(sendMail).not.toHaveBeenCalled();
  });

  it('rejects non-SMTP ports for tenant servers', async () => {
    setSettingsOverride('acme', 'SMTP_HOST', 'smtp.acme.example');
    setSettingsOverride('acme', 'SMTP_PORT', '6379');

    await expect(runWithTenantId('acme', () => new EmailService().sendOrThrow(mail))).rejects.toThrow('SMTP port');
    expect(lookupMock).not.toHaveBeenCalled();
  });

  it('re-reads the deployment settings per send', async () => {
    const service = new EmailService();

    await service.sendOrThrow(mail);
    setSettingsOverride(GLOBAL_SETTINGS_SCOPE, 'SMTP_HOST', 'smtp.changed.example');
    await service.sendOrThrow(mail);

    expect(lastTransportOptions()).toMatchObject({ host: 'smtp.changed.example' });
  });
});
