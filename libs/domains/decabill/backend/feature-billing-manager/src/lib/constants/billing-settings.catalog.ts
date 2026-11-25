import { SettingDefinition } from '@forepath/shared/backend/util-settings-overrides';

import { DEFAULT_DOCUMENT_BRAND_COLOR } from './document-branding.constants';
import { EINVOICE_FORMAT_VALUES } from './e-invoice-format.constants';
import { DEFAULT_POSTAL_PROVIDER } from './postal-letter.constants';
import {
  PINGEN_DELIVERY_PRODUCTS,
  PINGEN_ENVIRONMENTS,
  PINGEN_PRINT_MODES,
  PINGEN_PRINT_SPECTRUMS,
  POSTAL_ADDRESS_POSITIONS,
} from './postal-provider.constants';

/**
 * Billing manager settings overridable from the console (Administration → Settings).
 *
 * Resolution: tenant override → override for all tenants → environment variable. `scope: 'tenant'` marks
 * settings read per request / job inside the tenant context (or resolved for an explicit tenant); all others
 * are deployment-wide.
 *
 * Deliberately excluded: infrastructure (database, Valkey, OpenSearch, file storage, ports, namespaces),
 * cryptography (`ENCRYPTION_KEY`, `BILLING_FILE_SIGNING_SECRET`), authentication / CORS / rate limits, tenancy
 * (`TENANTS*`, `TENANTS_ALLOW_GLOBAL_VIEWS`), dynamic provider plugins (code loading) and settings managed
 * elsewhere in the console (per service type provider defaults).
 */
export const BILLING_SETTINGS_CATEGORIES = [
  'issuer',
  'documents',
  'tax',
  'withdrawal',
  'payments',
  'email',
  'postal',
  'links',
  'datev',
  'accounting',
  'price_recalc',
  'provisioning',
  'files',
  'background_jobs',
] as const;

export type BillingSettingsCategory = (typeof BILLING_SETTINGS_CATEGORIES)[number];

type Extra = Partial<Omit<SettingDefinition, 'key' | 'category' | 'type' | 'scope'>>;

const g = (category: BillingSettingsCategory, key: string, type: SettingDefinition['type'], extra: Extra = {}) =>
  ({ key, category, type, scope: 'global', ...extra }) as SettingDefinition;
const t = (category: BillingSettingsCategory, key: string, type: SettingDefinition['type'], extra: Extra = {}) =>
  ({ key, category, type, scope: 'tenant', ...extra }) as SettingDefinition;
const restart = { restartRequired: true } as const;
const COUNTRY = { maxLength: 2, pattern: '^[A-Za-z]{2}$' } as const;
const CURRENCY = { maxLength: 3, pattern: '^[A-Za-z]{3}$' } as const;
const UUID_PATTERN = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
const interval = (key: string, defaultValue: string): SettingDefinition =>
  g('background_jobs', key, 'duration', { defaultValue, ...restart });
const batch = (key: string, defaultValue = '100'): SettingDefinition =>
  g('background_jobs', key, 'integer', { min: 1, defaultValue, ...restart });
const DELIVERY_TERMS_CODES = [
  '',
  'EXW',
  'FCA',
  'CPT',
  'CIP',
  'DAP',
  'DPU',
  'DDP',
  'FAS',
  'FOB',
  'CFR',
  'CIF',
  'CUSTOM',
];
const DATEV_ACCOUNT = { maxLength: 9 } as const;
const DATEV_BU_KEY = { maxLength: 4 } as const;

export const BILLING_SETTINGS: readonly SettingDefinition[] = [
  // Issuer (legal entity on invoices, offers, withdrawal address, email footer fallback)
  t('issuer', 'BILLING_ISSUER_NAME', 'string'),
  t('issuer', 'BILLING_ISSUER_VAT_ID', 'string', { maxLength: 32 }),
  t('issuer', 'BILLING_ISSUER_TAX_NUMBER', 'string', { maxLength: 64 }),
  t('issuer', 'BILLING_ISSUER_SIREN', 'string', { maxLength: 16, pattern: '^[0-9 ]+$' }),
  t('issuer', 'BILLING_ISSUER_ADDRESS_LINE1', 'string'),
  t('issuer', 'BILLING_ISSUER_POSTAL_CODE', 'string', { maxLength: 32 }),
  t('issuer', 'BILLING_ISSUER_CITY', 'string'),
  t('issuer', 'BILLING_ISSUER_COUNTRY', 'string', { ...COUNTRY, defaultValue: 'DE' }),
  t('issuer', 'BILLING_ISSUER_EMAIL', 'email'),
  t('issuer', 'BILLING_ISSUER_BANK', 'string'),
  t('issuer', 'BILLING_ISSUER_IBAN', 'string', { maxLength: 34 }),
  t('issuer', 'BILLING_ISSUER_BIC', 'string', { maxLength: 11 }),

  // Documents (terms and formats)
  t('documents', 'BILLING_DEFAULT_PAYMENT_DUE_DAYS', 'integer', { min: 0, max: 365, defaultValue: '14' }),
  t('documents', 'BILLING_DEFAULT_DELIVERY_TERMS_CODE', 'enum', { options: DELIVERY_TERMS_CODES }),
  t('documents', 'BILLING_DEFAULT_DELIVERY_TERMS_PLACE', 'string'),
  t('documents', 'BILLING_DEFAULT_DELIVERY_TERMS_TEXT', 'text', { maxLength: 2000 }),
  t('documents', 'BILLING_EINVOICE_FORMAT', 'enum', { options: ['', ...EINVOICE_FORMAT_VALUES] }),
  t('documents', 'BILLING_DEFAULT_CURRENCY', 'string', { ...CURRENCY, defaultValue: 'EUR' }),
  t('documents', 'BILLING_DOCUMENT_LOGO', 'image', { maxLength: 65536 }),
  t('documents', 'BILLING_DOCUMENT_BRAND_COLOR', 'color', { maxLength: 7, defaultValue: DEFAULT_DOCUMENT_BRAND_COLOR }),

  // Tax
  t('tax', 'BILLING_TAX_RATE_STANDARD', 'number', { min: 0, max: 100, defaultValue: '19' }),
  t('tax', 'BILLING_TAX_RATE_REDUCED', 'number', { min: 0, max: 100, defaultValue: '7' }),
  t('tax', 'BILLING_OSS_REGISTERED', 'boolean', { defaultValue: 'false' }),
  t('tax', 'BILLING_OSS_THRESHOLD_EUR', 'number', { min: 0, defaultValue: '10000' }),
  t('tax', 'BILLING_NON_EU_ISSUER_EU_B2B_CHARGE_VAT', 'boolean', { defaultValue: 'false' }),

  // Withdrawal
  t('withdrawal', 'BILLING_STATUTORY_WITHDRAWAL_PERIOD_DAYS', 'integer', { min: 0, max: 365, defaultValue: '14' }),
  t('withdrawal', 'PUBLIC_WITHDRAWAL_CONFIRMATION_TTL_HOURS', 'integer', { min: 1, max: 720, defaultValue: '48' }),

  // Payments
  g('payments', 'BILLING_DEFAULT_PAYMENT_PROCESSOR', 'string', { maxLength: 64, defaultValue: 'stripe' }),
  t('payments', 'BILLING_MIN_CHECKOUT_PAYMENT_AMOUNT', 'number', { min: 0, defaultValue: '1' }),
  g('payments', 'STRIPE_SECRET_KEY', 'secret', restart),
  g('payments', 'STRIPE_WEBHOOK_SECRET', 'secret', restart),
  g('payments', 'STRIPE_CHECKOUT_SUCCESS_URL', 'url'),
  g('payments', 'STRIPE_CHECKOUT_CANCEL_URL', 'url'),
  g('payments', 'STRIPE_CHECKOUT_FRAUD_PROTECTION_ENABLED', 'boolean', { defaultValue: 'true' }),
  g('payments', 'BILLING_AUTO_PAYMENT_RETRY_DELAY_1_MS', 'integer', { min: 0, defaultValue: '86400000' }),
  g('payments', 'BILLING_AUTO_PAYMENT_RETRY_DELAY_2_MS', 'integer', { min: 0, defaultValue: '259200000' }),
  g('payments', 'BILLING_AUTO_PAYMENT_PENDING_SAFETY_DELAY_MS', 'integer', { min: 0, defaultValue: '900000' }),

  // Email (SMTP and brand block)
  t('email', 'SMTP_HOST', 'string', { maxLength: 253 }),
  t('email', 'SMTP_PORT', 'integer', { min: 1, max: 65535, defaultValue: '1025' }),
  t('email', 'SMTP_USER', 'string'),
  t('email', 'SMTP_PASSWORD', 'secret'),
  t('email', 'EMAIL_FROM', 'string', { defaultValue: 'noreply@localhost' }),
  t('email', 'EMAIL_COMPANY_NAME', 'string'),
  t('email', 'EMAIL_COMPANY_ADDRESS_LINE1', 'string'),
  t('email', 'EMAIL_COMPANY_POSTAL_CODE', 'string', { maxLength: 32 }),
  t('email', 'EMAIL_COMPANY_CITY', 'string'),
  t('email', 'EMAIL_COMPANY_COUNTRY', 'string', COUNTRY),
  t('email', 'EMAIL_COMPANY_VAT_ID', 'string', { maxLength: 32 }),
  t('email', 'EMAIL_COMPANY_EMAIL', 'email'),

  // Postal delivery (documents sent as physical letters through a postal provider; Pingen is built in)
  t('postal', 'BILLING_DEFAULT_POSTAL_PROVIDER', 'string', { maxLength: 64, defaultValue: DEFAULT_POSTAL_PROVIDER }),
  t('postal', 'BILLING_POSTAL_COVER_PAGE', 'boolean', { defaultValue: 'true' }),
  t('postal', 'BILLING_POSTAL_ADDRESS_POSITION', 'enum', { options: POSTAL_ADDRESS_POSITIONS, defaultValue: 'left' }),
  t('postal', 'PINGEN_ENVIRONMENT', 'enum', { options: PINGEN_ENVIRONMENTS, defaultValue: 'production' }),
  t('postal', 'PINGEN_CLIENT_ID', 'string', { maxLength: 255 }),
  t('postal', 'PINGEN_CLIENT_SECRET', 'secret', { maxLength: 255 }),
  t('postal', 'PINGEN_ORGANISATION_ID', 'string', { maxLength: 36, pattern: UUID_PATTERN }),
  t('postal', 'PINGEN_WEBHOOK_SIGNING_KEY', 'secret', { maxLength: 32, pattern: '^[A-Za-z0-9]{20,32}$' }),
  t('postal', 'PINGEN_DELIVERY_PRODUCT', 'enum', { options: PINGEN_DELIVERY_PRODUCTS, defaultValue: 'cheap' }),
  t('postal', 'PINGEN_PRINT_MODE', 'enum', { options: PINGEN_PRINT_MODES, defaultValue: 'simplex' }),
  t('postal', 'PINGEN_PRINT_SPECTRUM', 'enum', { options: PINGEN_PRINT_SPECTRUMS, defaultValue: 'grayscale' }),

  // Console links (Stripe returns, email links)
  g('links', 'BILLING_FRONTEND_URL', 'url'),
  g('links', 'TENANT_FRONTEND_URLS', 'list', { maxLength: 8192 }),

  // DATEV export
  g('datev', 'BILLING_DATEV_EXPORT_ENABLED', 'boolean', { defaultValue: 'true', ...restart }),
  g('datev', 'BILLING_DATEV_EXPORT_CRON', 'cron', { defaultValue: '0 0 1 * *', ...restart }),
  g('datev', 'BILLING_DATEV_EXPORT_TIMEZONE', 'timezone', { defaultValue: 'Europe/Berlin', ...restart }),
  g('datev', 'BILLING_DATEV_UNIFIED_EXPORT_ENABLED', 'boolean', { defaultValue: 'false' }),
  g('datev', 'BILLING_DATEV_TENANT_CONFIG', 'text', { maxLength: 65536, ...restart }),
  t('datev', 'BILLING_DATEV_CONSULTANT_NUMBER', 'string', { maxLength: 16 }),
  t('datev', 'BILLING_DATEV_CLIENT_NUMBER', 'string', { maxLength: 16 }),
  t('datev', 'BILLING_DATEV_CHART_OF_ACCOUNTS', 'enum', { options: ['SKR03', 'SKR04'], defaultValue: 'SKR03' }),
  t('datev', 'BILLING_DATEV_ACCOUNT_LENGTH', 'integer', { min: 4, max: 8, defaultValue: '4' }),
  t('datev', 'BILLING_DATEV_FISCAL_YEAR_START_MONTH', 'integer', { min: 1, max: 12, defaultValue: '1' }),
  t('datev', 'BILLING_DATEV_EXPORT_DICTATION_ABBR', 'string', { maxLength: 2, defaultValue: 'DEC' }),
  t('datev', 'BILLING_DATEV_EXPORT_INCLUDE_DOCUMENTS', 'boolean', { defaultValue: 'true' }),
  t('datev', 'BILLING_DATEV_EXPORT_INCLUDE_BANK_POSTINGS', 'boolean', { defaultValue: 'true' }),
  t('datev', 'BILLING_DATEV_REVENUE_ACCOUNT_STANDARD', 'string', DATEV_ACCOUNT),
  t('datev', 'BILLING_DATEV_REVENUE_ACCOUNT_REDUCED', 'string', DATEV_ACCOUNT),
  t('datev', 'BILLING_DATEV_REVENUE_ACCOUNT_REVERSE_CHARGE', 'string', DATEV_ACCOUNT),
  t('datev', 'BILLING_DATEV_REVENUE_ACCOUNT_OSS', 'string', DATEV_ACCOUNT),
  t('datev', 'BILLING_DATEV_REVENUE_ACCOUNT_THIRD_COUNTRY', 'string', DATEV_ACCOUNT),
  g('datev', 'BILLING_DATEV_DEBTOR_ACCOUNT_START', 'integer', { min: 1, max: 999999999, defaultValue: '10000' }),
  g('datev', 'BILLING_DATEV_DEBTOR_ACCOUNT_END', 'integer', { min: 1, max: 999999999, defaultValue: '69999' }),
  g('datev', 'BILLING_DATEV_CREDITOR_ACCOUNT_START', 'integer', { min: 1, max: 999999999, defaultValue: '70000' }),
  g('datev', 'BILLING_DATEV_CREDITOR_ACCOUNT_END', 'integer', { min: 1, max: 999999999, defaultValue: '99999' }),
  t('datev', 'BILLING_DATEV_EXPENSE_ACCOUNT_STANDARD', 'string', DATEV_ACCOUNT),
  t('datev', 'BILLING_DATEV_EXPENSE_ACCOUNT_REDUCED', 'string', DATEV_ACCOUNT),
  t('datev', 'BILLING_DATEV_EXPENSE_ACCOUNT_REVERSE_CHARGE', 'string', DATEV_ACCOUNT),
  t('datev', 'BILLING_DATEV_EXPENSE_ACCOUNT_OSS', 'string', DATEV_ACCOUNT),
  t('datev', 'BILLING_DATEV_EXPENSE_ACCOUNT_THIRD_COUNTRY', 'string', DATEV_ACCOUNT),
  t('datev', 'BILLING_DATEV_BU_KEY_STANDARD', 'string', DATEV_BU_KEY),
  t('datev', 'BILLING_DATEV_BU_KEY_REDUCED', 'string', DATEV_BU_KEY),
  t('datev', 'BILLING_DATEV_BU_KEY_REVERSE_CHARGE', 'string', DATEV_BU_KEY),
  t('datev', 'BILLING_DATEV_BU_KEY_OSS', 'string', DATEV_BU_KEY),
  t('datev', 'BILLING_DATEV_BU_KEY_THIRD_COUNTRY', 'string', DATEV_BU_KEY),
  t('datev', 'BILLING_DATEV_EXPENSE_BU_KEY_STANDARD', 'string', DATEV_BU_KEY),
  t('datev', 'BILLING_DATEV_EXPENSE_BU_KEY_REDUCED', 'string', DATEV_BU_KEY),

  // Accounting
  g('accounting', 'BILLING_ACCOUNTING_ENABLED', 'boolean', { defaultValue: 'false', ...restart }),
  t('accounting', 'BILLING_ACCOUNTING_COUNTRY', 'string', COUNTRY),
  t('accounting', 'BILLING_ACCOUNTING_CHART_TEMPLATE', 'string', { maxLength: 64 }),
  t('accounting', 'BILLING_ACCOUNTING_METHOD', 'enum', { options: ['accrual', 'cash'], defaultValue: 'accrual' }),
  t('accounting', 'BILLING_ACCOUNTING_VAT_BASIS', 'enum', { options: ['invoice', 'payment'], defaultValue: 'invoice' }),
  t('accounting', 'BILLING_ACCOUNTING_FISCAL_YEAR_START_MONTH', 'integer', { min: 1, max: 12 }),
  t('accounting', 'BILLING_ACCOUNTING_START_DATE', 'string', { maxLength: 10, pattern: '^\\d{4}-\\d{2}-\\d{2}$' }),
  t('accounting', 'BILLING_ACCOUNTING_FUNCTIONAL_CURRENCY', 'string', { ...CURRENCY, defaultValue: 'EUR' }),
  t('accounting', 'BILLING_ACCOUNTING_TIMEZONE', 'timezone'),
  t('accounting', 'BILLING_ACCOUNTING_VAT_RETURN_PERIOD', 'enum', {
    options: ['month', 'quarter', 'year'],
    defaultValue: 'month',
  }),
  t('accounting', 'BILLING_ACCOUNTING_AUTO_MATCH_THRESHOLD', 'number', { min: 0, max: 1, defaultValue: '0.9' }),
  t('accounting', 'BILLING_ACCOUNTING_ASSET_GWG_LIMIT', 'number', { min: 0, defaultValue: '800' }),
  t('accounting', 'BILLING_ACCOUNTING_ASSET_POOL_ENABLED', 'boolean', { defaultValue: 'false' }),
  t('accounting', 'BILLING_ACCOUNTING_ASSET_POOL_LOWER', 'number', { min: 0, defaultValue: '250' }),
  t('accounting', 'BILLING_ACCOUNTING_ASSET_POOL_UPPER', 'number', { min: 0, defaultValue: '1000' }),
  t('accounting', 'BILLING_ACCOUNTING_BANK_IMPORT_MAX_BYTES', 'integer', {
    min: 1024,
    max: 209715200,
    defaultValue: '52428800',
  }),
  g('accounting', 'BILLING_ACCOUNTING_FX_SOURCE', 'enum', { options: ['ecb', 'manual'], defaultValue: 'ecb' }),
  g('accounting', 'BILLING_ACCOUNTING_ECB_RATES_URL', 'url', { httpsOnly: true }),
  g('accounting', 'BILLING_ACCOUNTING_FX_CRON', 'cron', { defaultValue: '30 16 * * 1-5', ...restart }),
  g('accounting', 'BILLING_ACCOUNTING_PROCESSOR_SYNC_CRON', 'cron', { defaultValue: '15 * * * *', ...restart }),
  g('accounting', 'BILLING_ACCOUNTING_CATCH_UP_INTERVAL_MS', 'duration', { defaultValue: '900000', ...restart }),

  // Automatic daily price recalculation
  g('price_recalc', 'BILLING_PRICE_RECALC_ENABLED', 'boolean', { defaultValue: 'true', ...restart }),
  g('price_recalc', 'BILLING_PRICE_RECALC_CRON', 'cron', { defaultValue: '0 0 * * *', ...restart }),
  g('price_recalc', 'BILLING_PRICE_RECALC_TIMEZONE', 'timezone', { defaultValue: 'Europe/Berlin', ...restart }),

  // Provisioning and DNS
  g('provisioning', 'HETZNER_API_TOKEN', 'secret'),
  g('provisioning', 'DIGITALOCEAN_API_TOKEN', 'secret'),
  g('provisioning', 'CLOUDFLARE_API_TOKEN', 'secret', restart),
  g('provisioning', 'CLOUDFLARE_ZONE_ID', 'string', { maxLength: 64, ...restart }),
  g('provisioning', 'DNS_BASE_DOMAIN', 'string', { maxLength: 253, ...restart }),
  g('provisioning', 'LETS_ENCRYPT_EMAIL', 'email'),
  g('provisioning', 'BILLING_ADDON_SSH_COMMAND_TIMEOUT_MS', 'integer', { min: 1000, defaultValue: '120000' }),

  // Files
  g('files', 'BILLING_SKIP_FILE_CACHE', 'boolean', { defaultValue: 'false' }),
  g('files', 'BILLING_SPOOLER_RETENTION_DAYS', 'integer', { min: 1, max: 365, defaultValue: '7' }),
  g('files', 'DECABILL_TICKET_ATTACHMENT_MAX_BYTES', 'integer', { min: 1024, defaultValue: '26214400', ...restart }),

  // Background jobs (coordinator intervals and batch sizes)
  interval('BILLING_SCHEDULER_INTERVAL', '60000'),
  batch('BILLING_SCHEDULER_BATCH_SIZE'),
  interval('EXPIRATION_SCHEDULER_INTERVAL', '60000'),
  batch('EXPIRATION_SCHEDULER_BATCH_SIZE'),
  interval('WITHDRAWAL_SCHEDULER_INTERVAL', '60000'),
  batch('WITHDRAWAL_SCHEDULER_BATCH_SIZE'),
  interval('INSTANT_CANCEL_SCHEDULER_INTERVAL', '60000'),
  batch('INSTANT_CANCEL_SCHEDULER_BATCH_SIZE'),
  interval('PROVISIONING_SCHEDULER_INTERVAL', '30000'),
  batch('PROVISIONING_SCHEDULER_BATCH_SIZE'),
  interval('CONFIG_CHANGE_SCHEDULER_INTERVAL', '30000'),
  batch('CONFIG_CHANGE_SCHEDULER_BATCH_SIZE'),
  g('background_jobs', 'CONFIG_CHANGE_PROCESSING_TIMEOUT_MS', 'integer', { min: 60000, defaultValue: '900000' }),
  interval('REMINDER_SCHEDULER_INTERVAL', '3600000'),
  batch('REMINDER_SCHEDULER_BATCH_SIZE'),
  g('background_jobs', 'REMINDER_DAYS', 'integer', { min: 1, max: 365, defaultValue: '3', ...restart }),
  interval('BACKORDER_RETRY_INTERVAL_MS', '60000'),
  batch('BACKORDER_RETRY_BATCH_SIZE'),
  interval('INVOICE_OVERDUE_SCHEDULER_INTERVAL', '86400000'),
  batch('INVOICE_OVERDUE_SCHEDULER_BATCH_SIZE'),
  interval('INVOICE_AUTO_PAYMENT_SCHEDULER_INTERVAL', '60000'),
  batch('INVOICE_AUTO_PAYMENT_SCHEDULER_BATCH_SIZE'),
  interval('OPEN_POSITION_INVOICE_SCHEDULER_INTERVAL', '86400000'),
  interval('SUBSCRIPTION_UPDATE_SCHEDULER_INTERVAL', '86400000'),
  interval('OFFER_EXPIRATION_SCHEDULER_INTERVAL', '3600000'),
  interval('OFFER_FULFILLMENT_SCHEDULER_INTERVAL', '60000'),
  interval('SPOOLER_COORDINATOR_INTERVAL', '60000'),
  g('background_jobs', 'BILLING_METER_COLLECT_ENABLED', 'boolean', { defaultValue: 'true', ...restart }),
  interval('BILLING_METER_COLLECT_INTERVAL', '60000'),
  batch('BILLING_METER_COLLECT_BATCH_SIZE', '500'),
  g('background_jobs', 'BILLING_CONTRIBUTOR_COLLECT_ENABLED', 'boolean', { defaultValue: 'true', ...restart }),
  interval('BILLING_CONTRIBUTOR_COLLECT_INTERVAL', '30000'),
  g('background_jobs', 'BILLING_CONTAINER_MANAGER_COLLECT_INTERVAL', 'integer', { min: 1000, ...restart }),
  g('background_jobs', 'BILLING_CONTAINER_MANAGER_COLLECT_CONCURRENCY', 'integer', { min: 1, max: 64 }),
  interval('STORED_FILES_BACKFILL_INTERVAL', '300000'),
  interval('SEARCH_REINDEX_INTERVAL', '15m'),
  g('background_jobs', 'STATUS_POLL_INTERVAL', 'integer', { min: 1000, defaultValue: '15000', ...restart }),
  g('background_jobs', 'INVENTORY_REQUESTS_POLL_INTERVAL', 'integer', {
    min: 5000,
    max: 120000,
    defaultValue: '15000',
    ...restart,
  }),
  g('background_jobs', 'UPDATE_CHECK_CRON', 'cron', restart),
  g('background_jobs', 'UPDATE_CHECK_TIMEZONE', 'timezone', { defaultValue: 'Europe/Berlin', ...restart }),
];
