import { createSettingsScopedCache } from '@forepath/shared/backend/util-settings-overrides';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import {
  EINVOICE_FORMAT_VALUES,
  EINVOICE_FORMATS,
  EInvoiceFormat,
  type EInvoiceFormatDefinition,
} from '../constants/e-invoice-format.constants';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';

import { BillingIssuerConfigService } from './billing-issuer-config.service';

/** Issuer countries where Peppol BIS is the customary B2B default. */
const PEPPOL_DEFAULT_COUNTRIES = new Set(['BE', 'NL', 'LU', 'NO', 'SE', 'DK', 'FI', 'IE']);

/**
 * E-invoice format selection: `BILLING_EINVOICE_FORMAT` (issuer default; derived from the issuer country when
 * unset), overridable per customer profile, snapshotted on each issued invoice.
 */
@Injectable()
export class EInvoiceFormatConfigService implements OnModuleInit {
  private readonly logger = new Logger(EInvoiceFormatConfigService.name);
  private readonly defaultFormat = createSettingsScopedCache<EInvoiceFormat>(() => this.readDefault());

  constructor(private readonly issuerConfig: BillingIssuerConfigService) {}

  /** Re-reads the configuration (also used by tests after changing the environment). */
  onModuleInit(): void {
    this.defaultFormat.clear();
    this.defaultFormat.get();
  }

  private readDefault(): EInvoiceFormat {
    const raw = (process.env.BILLING_EINVOICE_FORMAT ?? '').trim().toLowerCase();

    if (raw && EINVOICE_FORMAT_VALUES.includes(raw as EInvoiceFormat)) {
      return raw as EInvoiceFormat;
    }

    if (raw) {
      this.logger.warn(`Unknown BILLING_EINVOICE_FORMAT "${raw}"; using the issuer-country default`);
    }

    const country = (this.issuerConfig.getConfig()?.country ?? 'DE').toUpperCase();

    return PEPPOL_DEFAULT_COUNTRIES.has(country) ? EInvoiceFormat.PEPPOL_BIS_3 : EInvoiceFormat.FACTUR_X_EN16931;
  }

  getDefault(): EInvoiceFormat {
    return this.defaultFormat.get();
  }

  list(): EInvoiceFormatDefinition[] {
    return Object.values(EINVOICE_FORMATS);
  }

  resolveForBuyer(profile: Pick<CustomerProfileEntity, 'einvoiceFormat'> | null | undefined): EInvoiceFormat {
    const override = profile?.einvoiceFormat?.trim().toLowerCase();

    return override && EINVOICE_FORMAT_VALUES.includes(override as EInvoiceFormat)
      ? (override as EInvoiceFormat)
      : this.getDefault();
  }

  definition(format: string | null | undefined): EInvoiceFormatDefinition {
    const key = (format ?? '').toLowerCase() as EInvoiceFormat;

    return EINVOICE_FORMATS[key] ?? EINVOICE_FORMATS[this.getDefault()];
  }
}
