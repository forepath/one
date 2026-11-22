import { runWithTenantId } from '@forepath/shared/backend/util-http-context';
import {
  GLOBAL_SETTINGS_SCOPE,
  installSettingsOverridesEnv,
  registerSettingDefinitions,
  resetSettingsOverridesRegistryForTests,
  setSettingsOverride,
} from '@forepath/shared/backend/util-settings-overrides';

import { BILLING_SETTINGS } from '../constants/billing-settings.catalog';

import { BillingDocumentBrandingConfigService } from './billing-document-branding-config.service';

const PNG = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString('base64')}`;
const SVG = `data:image/svg+xml;base64,${Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"/>').toString('base64')}`;

describe('BillingDocumentBrandingConfigService', () => {
  const env = { ...process.env };
  let service: BillingDocumentBrandingConfigService;

  beforeAll(() => {
    installSettingsOverridesEnv();
  });

  beforeEach(() => {
    resetSettingsOverridesRegistryForTests();
    registerSettingDefinitions(BILLING_SETTINGS);
    delete process.env.BILLING_DOCUMENT_LOGO;
    delete process.env.BILLING_DOCUMENT_BRAND_COLOR;
    service = new BillingDocumentBrandingConfigService();
    service.onModuleInit();
  });

  afterAll(() => {
    resetSettingsOverridesRegistryForTests();
    process.env = env;
  });

  it('falls back to the Decabill brand color without a logo', () => {
    expect(service.getBranding()).toEqual({ accentColor: '#32a852' });
  });

  it('reads and normalizes environment values', () => {
    process.env.BILLING_DOCUMENT_LOGO = PNG;
    process.env.BILLING_DOCUMENT_BRAND_COLOR = '#ABC';
    service.onModuleInit();

    expect(service.getBranding()).toEqual({ logoDataUri: PNG, accentColor: '#aabbcc' });
  });

  it('ignores invalid environment values instead of printing them', () => {
    process.env.BILLING_DOCUMENT_LOGO = 'https://intranet.example/logo.png';
    process.env.BILLING_DOCUMENT_BRAND_COLOR = 'red;} body { display: none';
    service.onModuleInit();

    expect(service.getBranding()).toEqual({ accentColor: '#32a852' });
  });

  it('applies tenant override, then the override for all tenants, then the environment', () => {
    process.env.BILLING_DOCUMENT_LOGO = PNG;
    process.env.BILLING_DOCUMENT_BRAND_COLOR = '#111111';
    setSettingsOverride(GLOBAL_SETTINGS_SCOPE, 'BILLING_DOCUMENT_BRAND_COLOR', '#222222');
    setSettingsOverride('acme', 'BILLING_DOCUMENT_BRAND_COLOR', '#333333');
    setSettingsOverride('acme', 'BILLING_DOCUMENT_LOGO', SVG);

    expect(runWithTenantId('acme', () => service.getBranding())).toEqual({ logoDataUri: SVG, accentColor: '#333333' });
    expect(runWithTenantId('other', () => service.getBranding())).toEqual({ logoDataUri: PNG, accentColor: '#222222' });
  });

  it('lets a level switch off an inherited logo with an empty override', () => {
    process.env.BILLING_DOCUMENT_LOGO = PNG;
    setSettingsOverride('acme', 'BILLING_DOCUMENT_LOGO', '');

    expect(runWithTenantId('acme', () => service.getBranding()).logoDataUri).toBeUndefined();
    expect(runWithTenantId('other', () => service.getBranding()).logoDataUri).toBe(PNG);
  });
});
