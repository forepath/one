import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';

import { BillingIssuerConfigService } from '../../services/billing-issuer-config.service';
import { parseBooleanEnv } from '../../utils/datev-format.util';
import { AccountingMethod, VatBasis } from '../constants/accounting.constants';
import type { AccountingCountryProfile } from '../profiles/accounting-profile.types';
import { EINVOICE_MANDATE_COUNTRIES, resolveAccountingProfile } from '../profiles/accounting-profiles.registry';

export type VatReturnPeriodicity = 'month' | 'quarter' | 'year';

export interface AccountingConfig {
  enabled: boolean;
  country: string;
  profile: AccountingCountryProfile;
  defaultChartTemplate: string;
  method: AccountingMethod;
  vatBasis: VatBasis;
  fiscalYearStartMonth: number;
  /** ISO date; documents dated before it are taken over as opening items instead of being posted. */
  startDate: string;
  functionalCurrency: string;
  vatReturnPeriod: VatReturnPeriodicity;
  fxSource: 'ecb' | 'manual';
  ecbRatesUrl: string;
  bankImportMaxBytes: number;
  autoMatchThreshold: number;
  gwgLimit: number;
  assetPoolEnabled: boolean;
  assetPoolLower: number;
  assetPoolUpper: number;
}

export interface AccountingFeatureAvailability {
  /** VAT return definition key or export kind. */
  key: string;
  available: boolean;
  /** Env vars that are missing for this feature. */
  missing: string[];
}

const DEFAULT_ECB_URL = 'https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml';

function envInt(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];

  if (raw === undefined || raw.trim() === '') {
    return fallback;
  }

  const parsed = Number.parseInt(raw, 10);

  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

function envNumber(name: string, fallback: number): number {
  const raw = process.env[name];
  const parsed = raw !== undefined && raw.trim() !== '' ? Number(raw) : Number.NaN;

  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function envEnum<T extends string>(name: string, allowed: readonly T[], fallback: T): T {
  const raw = (process.env[name] ?? '').trim().toLowerCase() as T;

  return allowed.includes(raw) ? raw : fallback;
}

/**
 * Accounting configuration (env). The whole feature is gated by `BILLING_ACCOUNTING_ENABLED` plus a complete
 * billing issuer (`BILLING_ISSUER_*`, including the country that selects the national profile). Country-specific
 * outputs additionally need their identifiers (profile prerequisites); outputs with missing prerequisites are
 * reported as unavailable with the missing variables named.
 */
@Injectable()
export class AccountingConfigService implements OnModuleInit {
  private readonly logger = new Logger(AccountingConfigService.name);
  private config!: AccountingConfig;
  private missingCore: string[] = [];

  constructor(private readonly issuerConfig: BillingIssuerConfigService) {}

  onModuleInit(): void {
    this.reload();
  }

  /** Re-reads the environment (tests and config reloads). */
  reload(): void {
    const issuer = this.issuerConfig.getConfig() ?? ({} as ReturnType<BillingIssuerConfigService['getConfig']>);
    const country = (process.env.BILLING_ACCOUNTING_COUNTRY ?? issuer.country ?? 'DE').trim().toUpperCase() || 'DE';
    const profile = resolveAccountingProfile(country);
    const fiscalYearStartMonth = envInt(
      'BILLING_ACCOUNTING_FISCAL_YEAR_START_MONTH',
      envInt('BILLING_DATEV_FISCAL_YEAR_START_MONTH', 1, 1, 12),
      1,
      12,
    );
    const template = (process.env.BILLING_ACCOUNTING_CHART_TEMPLATE ?? '').trim();

    this.missingCore = [];

    if (!parseBooleanEnv('BILLING_ACCOUNTING_ENABLED', false)) {
      this.missingCore.push('BILLING_ACCOUNTING_ENABLED');
    }

    for (const [env, value] of [
      ['BILLING_ISSUER_NAME', issuer.name],
      ['BILLING_ISSUER_ADDRESS_LINE1', issuer.addressLine1],
      ['BILLING_ISSUER_POSTAL_CODE', issuer.postalCode],
      ['BILLING_ISSUER_CITY', issuer.city],
      ['BILLING_ISSUER_COUNTRY', process.env.BILLING_ISSUER_COUNTRY],
    ] as const) {
      if (!value || String(value).trim() === '') {
        this.missingCore.push(env);
      }
    }

    this.config = {
      enabled: this.missingCore.length === 0,
      country,
      profile,
      defaultChartTemplate: template && profile.templates.includes(template) ? template : profile.defaultTemplate,
      method: envEnum(
        'BILLING_ACCOUNTING_METHOD',
        [AccountingMethod.ACCRUAL, AccountingMethod.CASH],
        AccountingMethod.ACCRUAL,
      ),
      vatBasis: envEnum('BILLING_ACCOUNTING_VAT_BASIS', [VatBasis.INVOICE, VatBasis.PAYMENT], VatBasis.INVOICE),
      fiscalYearStartMonth,
      startDate: this.resolveStartDate(fiscalYearStartMonth),
      functionalCurrency: (process.env.BILLING_ACCOUNTING_FUNCTIONAL_CURRENCY ?? 'EUR').trim().toUpperCase() || 'EUR',
      vatReturnPeriod: envEnum('BILLING_ACCOUNTING_VAT_RETURN_PERIOD', ['month', 'quarter', 'year'] as const, 'month'),
      fxSource: envEnum('BILLING_ACCOUNTING_FX_SOURCE', ['ecb', 'manual'] as const, 'ecb'),
      ecbRatesUrl: this.resolveEcbUrl(),
      bankImportMaxBytes: envInt('BILLING_ACCOUNTING_BANK_IMPORT_MAX_BYTES', 50 * 1024 * 1024, 1024, 200 * 1024 * 1024),
      autoMatchThreshold: Math.min(1, envNumber('BILLING_ACCOUNTING_AUTO_MATCH_THRESHOLD', 0.9)),
      gwgLimit: envNumber('BILLING_ACCOUNTING_ASSET_GWG_LIMIT', 800),
      assetPoolEnabled: parseBooleanEnv('BILLING_ACCOUNTING_ASSET_POOL_ENABLED', false),
      assetPoolLower: envNumber('BILLING_ACCOUNTING_ASSET_POOL_LOWER', 250),
      assetPoolUpper: envNumber('BILLING_ACCOUNTING_ASSET_POOL_UPPER', 1000),
    };

    if (parseBooleanEnv('BILLING_ACCOUNTING_ENABLED', false) && !this.config.enabled) {
      this.logger.warn(`Accounting is enabled but prerequisites are missing: ${this.missingCore.join(', ')}`);
    }

    if (this.config.enabled && EINVOICE_MANDATE_COUNTRIES[country]) {
      this.logger.warn(`Accounting country ${country}: ${EINVOICE_MANDATE_COUNTRIES[country]}`);
    }
  }

  isEnabled(): boolean {
    return this.config.enabled;
  }

  /** Throws 404 (feature hidden) when accounting is disabled. */
  assertEnabled(): void {
    if (!this.config.enabled) {
      throw new NotFoundException('Accounting is not enabled');
    }
  }

  getConfig(): AccountingConfig {
    return this.config;
  }

  getMissingCorePrerequisites(): string[] {
    return [...this.missingCore];
  }

  /** Availability of every VAT return and export of the active profile (env prerequisites). */
  getFeatureAvailability(): AccountingFeatureAvailability[] {
    const profile = this.config.profile;
    const keys = [...profile.vatReturns.map((r) => r.key), ...profile.exports];

    return keys.map((key) => {
      const missing = profile.prerequisites
        .filter((p) => p.requiredFor.includes(key))
        .filter((p) => !(process.env[p.env] ?? '').trim())
        .map((p) => p.env);

      return { key, available: this.config.enabled && missing.length === 0, missing };
    });
  }

  isFeatureAvailable(key: string): boolean {
    return this.getFeatureAvailability().some((f) => f.key === key && f.available);
  }

  /** Start of the fiscal year that contains `date` (ISO). */
  fiscalYearStartFor(date: string): string {
    const [year, month] = date.split('-').map(Number);
    const startMonth = this.config.fiscalYearStartMonth;
    const startYear = month >= startMonth ? year : year - 1;

    return `${startYear}-${String(startMonth).padStart(2, '0')}-01`;
  }

  private resolveStartDate(fiscalYearStartMonth: number): string {
    const raw = (process.env.BILLING_ACCOUNTING_START_DATE ?? '').trim();

    if (/^\d{4}-\d{2}-\d{2}$/.test(raw) && !Number.isNaN(Date.parse(`${raw}T00:00:00Z`))) {
      return raw;
    }

    const now = new Date();
    const year = now.getUTCMonth() + 1 >= fiscalYearStartMonth ? now.getUTCFullYear() : now.getUTCFullYear() - 1;

    return `${year}-${String(fiscalYearStartMonth).padStart(2, '0')}-01`;
  }

  private resolveEcbUrl(): string {
    const raw = (process.env.BILLING_ACCOUNTING_ECB_RATES_URL ?? '').trim();

    // Only HTTPS ECB-hosted feeds (or explicit overrides for tests) — the job fetches it server-side.
    if (raw && /^https:\/\/[a-z0-9.-]+(:\d+)?\//i.test(raw)) {
      return raw;
    }

    return DEFAULT_ECB_URL;
  }
}
