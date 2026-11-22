import { BILLING_SETTINGS, BILLING_SETTINGS_CATEGORIES } from './billing-settings.catalog';

describe('BILLING_SETTINGS', () => {
  it('uses unique keys and known categories', () => {
    expect(new Set(BILLING_SETTINGS.map((setting) => setting.key)).size).toBe(BILLING_SETTINGS.length);

    for (const setting of BILLING_SETTINGS) {
      expect(BILLING_SETTINGS_CATEGORIES).toContain(setting.category);
    }
  });

  it('does not expose infrastructure, cryptography, authentication or tenancy settings', () => {
    const keys = BILLING_SETTINGS.map((setting) => setting.key);

    for (const excluded of [
      'ENCRYPTION_KEY',
      'BILLING_FILE_SIGNING_SECRET',
      'JWT_SECRET',
      'STATIC_API_KEY',
      'STATIC_API_KEY_TENANT_ID',
      'DB_PASSWORD',
      'VALKEY_PASSWORD',
      'CORS_ORIGIN',
      'TENANTS',
      'TENANTS_ALLOW_DEFAULT',
      'TENANTS_ALLOW_GLOBAL_VIEWS',
      'TENANTS_SHARED_NUMBERS',
      'DYNAMIC_PAYMENT_PROCESSORS',
      'FILE_STORAGE_S3_SECRET_ACCESS_KEY',
    ]) {
      expect(keys).not.toContain(excluded);
    }
  });

  it('keeps scheduler registration and process-wide clients deployment-wide', () => {
    const byKey = new Map(BILLING_SETTINGS.map((setting) => [setting.key, setting]));

    for (const key of [
      'STRIPE_SECRET_KEY',
      'STRIPE_WEBHOOK_SECRET',
      'BILLING_ACCOUNTING_ENABLED',
      'BILLING_SCHEDULER_INTERVAL',
    ]) {
      expect(byKey.get(key)?.scope).toBe('global');
    }

    for (const setting of BILLING_SETTINGS.filter((entry) => entry.category === 'background_jobs')) {
      expect(setting.scope).toBe('global');
    }
  });
});
