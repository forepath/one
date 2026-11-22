import {
  createSettingsScopedCache,
  normalizeSettingValue,
  type SettingDefinition,
} from '@forepath/shared/backend/util-settings-overrides';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { BILLING_SETTINGS } from '../constants/billing-settings.catalog';
import { DEFAULT_DOCUMENT_BRAND_COLOR, NEUTRAL_DOCUMENT_ACCENT_COLOR } from '../constants/document-branding.constants';

/** Logo and accent color printed on generated documents (invoices, credit notes, offers, reports). */
export interface BillingDocumentBranding {
  /** Base64 `data:` URI of the logo (validated image); absent prints no logo. */
  logoDataUri?: string;
  /** `#rrggbb` accent for rules and table heads. */
  accentColor: string;
}

/** Branding without configuration (also used where no config service is wired, e.g. unit tests). */
export const DEFAULT_DOCUMENT_BRANDING: BillingDocumentBranding = Object.freeze({
  accentColor: DEFAULT_DOCUMENT_BRAND_COLOR,
});

/** Documents issued by a third party (supplier invoice copies): no own logo, neutral accent. */
export const NEUTRAL_DOCUMENT_BRANDING: BillingDocumentBranding = Object.freeze({
  accentColor: NEUTRAL_DOCUMENT_ACCENT_COLOR,
});

const LOGO_KEY = 'BILLING_DOCUMENT_LOGO';
const BRAND_COLOR_KEY = 'BILLING_DOCUMENT_BRAND_COLOR';

/**
 * Document branding (`BILLING_DOCUMENT_LOGO`, `BILLING_DOCUMENT_BRAND_COLOR`). Read inside the tenant context so
 * console overrides apply (tenant override → override for all tenants → environment). Every value is validated
 * again on read: console overrides are validated on write, but environment values are not, and both end up in
 * the document HTML.
 */
@Injectable()
export class BillingDocumentBrandingConfigService implements OnModuleInit {
  private readonly logger = new Logger(BillingDocumentBrandingConfigService.name);
  private readonly branding = createSettingsScopedCache<BillingDocumentBranding>(() => this.read());

  /** Re-reads the configuration (also used by tests after changing the environment). */
  onModuleInit(): void {
    this.branding.clear();
  }

  getBranding(): BillingDocumentBranding {
    return this.branding.get();
  }

  private read(): BillingDocumentBranding {
    const logoDataUri = this.readValidated(LOGO_KEY);
    const accentColor = this.readValidated(BRAND_COLOR_KEY) || DEFAULT_DOCUMENT_BRAND_COLOR;

    return logoDataUri ? { logoDataUri, accentColor } : { accentColor };
  }

  /** Normalized value, `''` when unset, explicitly empty or invalid (invalid values are logged and ignored). */
  private readValidated(key: string): string {
    const raw = process.env[key];

    if (raw === undefined || raw.trim() === '') {
      return '';
    }

    try {
      return normalizeSettingValue(this.definition(key), raw);
    } catch (error) {
      this.logger.warn(`Ignoring ${key}: ${(error as Error).message}`);

      return '';
    }
  }

  private definition(key: string): SettingDefinition {
    const definition = BILLING_SETTINGS.find((setting) => setting.key === key);

    if (!definition) {
      throw new Error(`${key} is missing from the billing settings catalog`);
    }

    return definition;
  }
}
