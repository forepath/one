import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

export interface BillingIssuerConfig {
  name: string;
  vatId: string;
  addressLine1: string;
  postalCode: string;
  city: string;
  country: string;
  email?: string;
  bank?: string;
  iban?: string;
  bic?: string;
}

@Injectable()
export class BillingIssuerConfigService implements OnModuleInit {
  private readonly logger = new Logger(BillingIssuerConfigService.name);
  private config!: BillingIssuerConfig;

  onModuleInit(): void {
    this.config = {
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

    const required = [
      this.config.name,
      this.config.vatId,
      this.config.addressLine1,
      this.config.postalCode,
      this.config.city,
    ];
    const missing = required.some((v) => !v || v.trim() === '');

    if (missing) {
      this.logger.warn(
        'Billing issuer configuration is incomplete. Invoice PDF/e-invoice generation may fail until BILLING_ISSUER_* env vars are set.',
      );
    }
  }

  getConfig(): BillingIssuerConfig {
    return this.config;
  }

  assertConfigured(): void {
    const { name, vatId, addressLine1, postalCode, city } = this.config;

    if (!name || !vatId || !addressLine1 || !postalCode || !city) {
      throw new Error('Billing issuer is not configured');
    }
  }
}
