import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { IntegrationsController, IntegrationTestDto } from './integrations.controller';

const REQUIRE_SCOPES_KEY = 'identity.require_scopes';

describe('IntegrationsController', () => {
  const integrations = {
    status: jest.fn().mockResolvedValue([{ id: 'smtp', label: 'Email (SMTP)', active: false, details: {} }]),
    test: jest.fn().mockResolvedValue({ ok: true, message: 'ok', durationMs: 3 }),
  };
  const controller = new IntegrationsController(integrations as never);

  it('wraps the env status as { env }', async () => {
    await expect(controller.status()).resolves.toEqual({
      env: [{ id: 'smtp', label: 'Email (SMTP)', active: false, details: {} }],
    });
  });

  it('passes kind and name to the tests', async () => {
    await expect(controller.test({ kind: 'BackupTarget', name: 'offsite' }, undefined)).resolves.toMatchObject({
      ok: true,
    });
    expect(integrations.test).toHaveBeenCalledWith(undefined, { kind: 'BackupTarget', name: 'offsite' });
  });

  it('requires cluster:read on both routes (the kind-specific scope is checked by the service)', () => {
    const proto = IntegrationsController.prototype;

    expect(Reflect.getMetadata(REQUIRE_SCOPES_KEY, proto.status)).toEqual(['cluster:read']);
    expect(Reflect.getMetadata(REQUIRE_SCOPES_KEY, proto.test)).toEqual(['cluster:read']);
  });

  it('validates the test body', () => {
    const errors = (body: object) => validateSync(plainToInstance(IntegrationTestDto, body)).length;

    expect(errors({ kind: 'DnsProvider', name: 'cf' })).toBe(0);
    expect(errors({ kind: 'SiemTarget', name: 'splunk-eu' })).toBe(0);
    expect(errors({ kind: 'Secret', name: 'cf' })).toBeGreaterThan(0);
    expect(errors({ kind: 'DnsProvider', name: '../x' })).toBeGreaterThan(0);
    expect(errors({ kind: 'DnsProvider' })).toBeGreaterThan(0);
  });
});
