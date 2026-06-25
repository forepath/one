import { DEFAULT_TENANT } from '@forepath/shared/backend';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { parseBooleanEnv, parseCsvTenantIds } from '../utils/datev-format.util';

export interface DatevTenantExportConfig {
  consultantNumber: string;
  clientNumber: string;
  chartOfAccounts: 'SKR03' | 'SKR04';
  accountLength: number;
  revenueAccountStandard: string;
  revenueAccountReduced: string;
  debtorAccountStart: number;
  debtorAccountEnd: number;
  buKeyStandard: string;
  buKeyReduced: string;
  includeDocuments: boolean;
  dictationAbbr: string;
  fiscalYearStartMonth: number;
}

interface DatevTenantConfigOverrides {
  consultantNumber?: string;
  clientNumber?: string;
  chartOfAccounts?: 'SKR03' | 'SKR04';
  accountLength?: number;
  revenueAccountStandard?: string;
  revenueAccountReduced?: string;
  debtorAccountStart?: number;
  debtorAccountEnd?: number;
  buKeyStandard?: string;
  buKeyReduced?: string;
  includeDocuments?: boolean;
  dictationAbbr?: string;
  fiscalYearStartMonth?: number;
}

@Injectable()
export class DatevExportConfigService implements OnModuleInit {
  private readonly logger = new Logger(DatevExportConfigService.name);
  private tenantOverrides: Record<string, DatevTenantConfigOverrides> = {};
  private unifiedExportAllowedTenants: readonly string[] = [DEFAULT_TENANT];

  onModuleInit(): void {
    this.tenantOverrides = this.parseTenantConfigJson(process.env.BILLING_DATEV_TENANT_CONFIG);
    this.unifiedExportAllowedTenants = parseCsvTenantIds('BILLING_DATEV_UNIFIED_EXPORT_ALLOWED_TENANTS', [
      DEFAULT_TENANT,
    ]);
    this.validateDebtorRanges();
  }

  isEnabled(): boolean {
    return parseBooleanEnv('BILLING_DATEV_EXPORT_ENABLED', true);
  }

  isUnifiedExportEnabled(): boolean {
    return this.isEnabled() && parseBooleanEnv('BILLING_DATEV_UNIFIED_EXPORT_ENABLED', false);
  }

  getUnifiedExportAllowedTenants(): readonly string[] {
    return this.unifiedExportAllowedTenants;
  }

  isUnifiedExportAllowedForTenant(tenantId: string): boolean {
    return this.isUnifiedExportEnabled() && this.unifiedExportAllowedTenants.includes(tenantId);
  }

  getExportTimezone(): string {
    return process.env.BILLING_DATEV_EXPORT_TIMEZONE ?? 'Europe/Berlin';
  }

  getExportCronPattern(): string {
    return process.env.BILLING_DATEV_EXPORT_CRON ?? '0 0 1 * *';
  }

  resolveForTenant(tenantId: string): DatevTenantExportConfig | null {
    if (!this.isEnabled()) {
      return null;
    }

    const chartOfAccounts = this.resolveChartOfAccounts(tenantId);
    const config: DatevTenantExportConfig = {
      consultantNumber: this.resolveString(tenantId, 'consultantNumber', 'BILLING_DATEV_CONSULTANT_NUMBER'),
      clientNumber: this.resolveString(tenantId, 'clientNumber', 'BILLING_DATEV_CLIENT_NUMBER'),
      chartOfAccounts,
      accountLength: this.resolveNumber(tenantId, 'accountLength', 'BILLING_DATEV_ACCOUNT_LENGTH', 4),
      revenueAccountStandard: this.resolveString(
        tenantId,
        'revenueAccountStandard',
        chartOfAccounts === 'SKR04'
          ? 'BILLING_DATEV_REVENUE_ACCOUNT_STANDARD'
          : 'BILLING_DATEV_REVENUE_ACCOUNT_STANDARD',
        chartOfAccounts === 'SKR04' ? '4400' : '8400',
      ),
      revenueAccountReduced: this.resolveString(
        tenantId,
        'revenueAccountReduced',
        'BILLING_DATEV_REVENUE_ACCOUNT_REDUCED',
        chartOfAccounts === 'SKR04' ? '4300' : '8300',
      ),
      debtorAccountStart: this.resolveNumber(
        tenantId,
        'debtorAccountStart',
        'BILLING_DATEV_DEBTOR_ACCOUNT_START',
        10_000,
      ),
      debtorAccountEnd: this.resolveNumber(tenantId, 'debtorAccountEnd', 'BILLING_DATEV_DEBTOR_ACCOUNT_END', 69_999),
      buKeyStandard: this.resolveString(tenantId, 'buKeyStandard', 'BILLING_DATEV_BU_KEY_STANDARD', ''),
      buKeyReduced: this.resolveString(tenantId, 'buKeyReduced', 'BILLING_DATEV_BU_KEY_REDUCED', ''),
      includeDocuments: this.resolveBoolean(
        tenantId,
        'includeDocuments',
        'BILLING_DATEV_EXPORT_INCLUDE_DOCUMENTS',
        true,
      ),
      dictationAbbr: this.resolveString(tenantId, 'dictationAbbr', 'BILLING_DATEV_EXPORT_DICTATION_ABBR', 'DEC'),
      fiscalYearStartMonth: this.resolveNumber(
        tenantId,
        'fiscalYearStartMonth',
        'BILLING_DATEV_FISCAL_YEAR_START_MONTH',
        1,
      ),
    };

    if (!config.consultantNumber || !config.clientNumber) {
      return null;
    }

    return config;
  }

  resolveUnified(): DatevTenantExportConfig | null {
    return this.resolveForTenant('unified');
  }

  private resolveChartOfAccounts(tenantId: string): 'SKR03' | 'SKR04' {
    const override = this.tenantOverrides[tenantId]?.chartOfAccounts;
    const global = (process.env.BILLING_DATEV_CHART_OF_ACCOUNTS ?? 'SKR03').toUpperCase();

    if (override) {
      return override;
    }

    return global === 'SKR04' ? 'SKR04' : 'SKR03';
  }

  private resolveString(
    tenantId: string,
    key: keyof DatevTenantConfigOverrides,
    envKey: string,
    fallback = '',
  ): string {
    const override = this.tenantOverrides[tenantId]?.[key];

    if (typeof override === 'string') {
      return override;
    }

    return process.env[envKey] ?? fallback;
  }

  private resolveNumber(
    tenantId: string,
    key: keyof DatevTenantConfigOverrides,
    envKey: string,
    fallback: number,
  ): number {
    const override = this.tenantOverrides[tenantId]?.[key];

    if (typeof override === 'number') {
      return override;
    }

    const parsed = parseInt(process.env[envKey] ?? String(fallback), 10);

    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private resolveBoolean(
    tenantId: string,
    key: keyof DatevTenantConfigOverrides,
    envKey: string,
    fallback: boolean,
  ): boolean {
    const override = this.tenantOverrides[tenantId]?.[key];

    if (typeof override === 'boolean') {
      return override;
    }

    return parseBooleanEnv(envKey, fallback);
  }

  private parseTenantConfigJson(raw: string | undefined): Record<string, DatevTenantConfigOverrides> {
    if (!raw?.trim()) {
      return {};
    }

    try {
      const parsed = JSON.parse(raw) as Record<string, DatevTenantConfigOverrides>;

      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
      this.logger.warn('Failed to parse BILLING_DATEV_TENANT_CONFIG JSON', error);

      return {};
    }
  }

  private validateDebtorRanges(): void {
    const ranges = new Map<string, { start: number; end: number }>();

    for (const [tenantId, config] of Object.entries(this.tenantOverrides)) {
      if (tenantId === 'unified') {
        continue;
      }

      if (config.debtorAccountStart != null && config.debtorAccountEnd != null) {
        ranges.set(tenantId, { start: config.debtorAccountStart, end: config.debtorAccountEnd });
      }
    }

    const defaultConfig = this.resolveForTenant(DEFAULT_TENANT);

    if (defaultConfig) {
      ranges.set(DEFAULT_TENANT, {
        start: defaultConfig.debtorAccountStart,
        end: defaultConfig.debtorAccountEnd,
      });
    }

    const entries = [...ranges.entries()];

    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const [tenantA, rangeA] = entries[i];
        const [tenantB, rangeB] = entries[j];

        if (rangeA.start <= rangeB.end && rangeB.start <= rangeA.end) {
          this.logger.warn(
            `DATEV debtor account ranges overlap between tenants ${tenantA} and ${tenantB}. Unified exports may collide.`,
          );
        }
      }
    }
  }
}
