import { BadRequestException, Injectable, Logger, OnModuleInit } from '@nestjs/common';

export interface BillingIssuerConfig {
  name: string;
  vatId: string;
  addressLine1: string;
  /** Not configurable via `BILLING_ISSUER_*`; set when a supplier profile is printed as the issuer. */
  addressLine2?: string;
  postalCode: string;
  city: string;
  country: string;
  email?: string;
  bank?: string;
  iban?: string;
  bic?: string;
}

/**
 * Billing issuer (`BILLING_ISSUER_*`). Read per call so console overrides apply, per tenant inside the tenant
 * context (tenant override → override for all tenants → environment).
 */
@Injectable()
export class BillingIssuerConfigService implements OnModuleInit {
  private readonly logger = new Logger(BillingIssuerConfigService.name);

  onModuleInit(): void {
    const { name, vatId, addressLine1, postalCode, city } = this.getConfig();
    const missing = [name, vatId, addressLine1, postalCode, city].some((v) => !v || v.trim() === '');

    if (missing) {
      this.logger.warn(
        'Billing issuer configuration is incomplete. Invoice PDF/e-invoice generation may fail until BILLING_ISSUER_* env vars are set.',
      );
    }
  }

  getConfig(): BillingIssuerConfig {
    return {
      name: process.env.BILLING_ISSUER_NAME ?? '',
      vatId: process.env.BILLING_ISSUER_VAT_ID ?? '',
      addressLine1: process.env.BILLING_ISSUER_ADDRESS_LINE1 ?? '',
      postalCode: process.env.BILLING_ISSUER_POSTAL_CODE ?? '',
      city: process.env.BILLING_ISSUER_CITY ?? '',
      country: process.env.BILLING_ISSUER_COUNTRY ?? 'DE',
      email: process.env.BILLING_ISSUER_EMAIL,
      bank: process.env.BILLING_ISSUER_BANK,
      iban: process.env.BILLING_ISSUER_IBAN,
      bic: process.env.BILLING_ISSUER_BIC,
    };
  }

  assertConfigured(): void {
    const { name, vatId, addressLine1, postalCode, city } = this.getConfig();

    if (!name || !vatId || !addressLine1 || !postalCode || !city) {
      throw new BadRequestException('Billing issuer is not configured');
    }
  }
}
