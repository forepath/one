import type { SettingsAdminLabels } from '@forepath/shared/frontend/feature-settings';

/** Localized labels of the backend settings catalog (Administration → Settings). */
export const BILLING_SETTINGS_LABELS: SettingsAdminLabels = {
  categories: {
    issuer: {
      icon: 'building',
      section: $localize`:@@featureBillingSettings-section-company:Company`,
      label: $localize`:@@featureBillingSettings-category-issuer:Issuer`,
    },
    documents: {
      icon: 'file-earmark-text',
      section: $localize`:@@featureBillingSettings-section-company:Company`,
      label: $localize`:@@featureBillingSettings-category-documents:Documents`,
    },
    tax: {
      icon: 'percent',
      section: $localize`:@@featureBillingSettings-section-company:Company`,
      label: $localize`:@@featureBillingSettings-category-tax:Tax`,
    },
    withdrawal: {
      icon: 'arrow-return-left',
      section: $localize`:@@featureBillingSettings-section-company:Company`,
      label: $localize`:@@featureBillingSettings-category-withdrawal:Withdrawal`,
    },
    payments: {
      icon: 'credit-card',
      section: $localize`:@@featureBillingSettings-section-payments:Payments`,
      label: $localize`:@@featureBillingSettings-category-payments:Payments`,
    },
    email: {
      icon: 'envelope',
      section: $localize`:@@featureBillingSettings-section-communication:Communication`,
      label: $localize`:@@featureBillingSettings-category-email:Email`,
    },
    links: {
      icon: 'link-45deg',
      section: $localize`:@@featureBillingSettings-section-communication:Communication`,
      label: $localize`:@@featureBillingSettings-category-links:Console links`,
    },
    datev: {
      icon: 'box-arrow-up-right',
      section: $localize`:@@featureBillingSettings-section-bookkeeping:Bookkeeping`,
      label: $localize`:@@featureBillingSettings-category-datev:DATEV export`,
    },
    accounting: {
      icon: 'journal-bookmark',
      section: $localize`:@@featureBillingSettings-section-bookkeeping:Bookkeeping`,
      label: $localize`:@@featureBillingSettings-category-accounting:Accounting`,
    },
    price_recalc: {
      icon: 'arrow-repeat',
      section: $localize`:@@featureBillingSettings-section-operations:Operations`,
      label: $localize`:@@featureBillingSettings-category-price_recalc:Price recalculation`,
    },
    provisioning: {
      icon: 'server',
      section: $localize`:@@featureBillingSettings-section-operations:Operations`,
      label: $localize`:@@featureBillingSettings-category-provisioning:Provisioning`,
    },
    files: {
      icon: 'folder2-open',
      section: $localize`:@@featureBillingSettings-section-operations:Operations`,
      label: $localize`:@@featureBillingSettings-category-files:Files`,
    },
    background_jobs: {
      icon: 'clock-history',
      section: $localize`:@@featureBillingSettings-section-operations:Operations`,
      label: $localize`:@@featureBillingSettings-category-background_jobs:Background jobs`,
    },
  },
  settings: {
    BILLING_ISSUER_NAME: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ISSUER_NAME:Company name`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ISSUER_NAME:Legal name on invoices, offers and the withdrawal address.`,
    },
    BILLING_ISSUER_VAT_ID: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ISSUER_VAT_ID:VAT ID`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ISSUER_VAT_ID:VAT identification number of the issuer.`,
    },
    BILLING_ISSUER_TAX_NUMBER: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ISSUER_TAX_NUMBER:Tax number`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ISSUER_TAX_NUMBER:National tax number, needed for VAT returns.`,
    },
    BILLING_ISSUER_SIREN: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ISSUER_SIREN:SIREN`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ISSUER_SIREN:French company number (9 digits), needed for FEC.`,
    },
    BILLING_ISSUER_ADDRESS_LINE1: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ISSUER_ADDRESS_LINE1:Address`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ISSUER_ADDRESS_LINE1:Street and number of the issuer.`,
    },
    BILLING_ISSUER_POSTAL_CODE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ISSUER_POSTAL_CODE:Postal code`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ISSUER_POSTAL_CODE:Postal code of the issuer.`,
    },
    BILLING_ISSUER_CITY: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ISSUER_CITY:City`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ISSUER_CITY:City of the issuer.`,
    },
    BILLING_ISSUER_COUNTRY: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ISSUER_COUNTRY:Country`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ISSUER_COUNTRY:ISO country code (e.g. DE); selects tax rules and the accounting profile.`,
    },
    BILLING_ISSUER_EMAIL: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ISSUER_EMAIL:Email`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ISSUER_EMAIL:Contact address on documents.`,
    },
    BILLING_ISSUER_BANK: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ISSUER_BANK:Bank`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ISSUER_BANK:Bank name for transfers.`,
    },
    BILLING_ISSUER_IBAN: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ISSUER_IBAN:IBAN`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ISSUER_IBAN:Account for transfers.`,
    },
    BILLING_ISSUER_BIC: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ISSUER_BIC:BIC`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ISSUER_BIC:Bank code for transfers.`,
    },
    BILLING_DEFAULT_PAYMENT_DUE_DAYS: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DEFAULT_PAYMENT_DUE_DAYS:Payment terms (days)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DEFAULT_PAYMENT_DUE_DAYS:Invoices are payable within this many days unless plans or documents set terms.`,
    },
    BILLING_DEFAULT_DELIVERY_TERMS_CODE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DEFAULT_DELIVERY_TERMS_CODE:Delivery terms`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DEFAULT_DELIVERY_TERMS_CODE:Default Incoterms rule or CUSTOM.`,
    },
    BILLING_DEFAULT_DELIVERY_TERMS_PLACE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DEFAULT_DELIVERY_TERMS_PLACE:Delivery place`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DEFAULT_DELIVERY_TERMS_PLACE:Named place of the Incoterms rule.`,
    },
    BILLING_DEFAULT_DELIVERY_TERMS_TEXT: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DEFAULT_DELIVERY_TERMS_TEXT:Delivery terms text`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DEFAULT_DELIVERY_TERMS_TEXT:Free text; required for CUSTOM.`,
    },
    BILLING_EINVOICE_FORMAT: {
      title: $localize`:@@featureBillingSettings-title-BILLING_EINVOICE_FORMAT:E-invoice format`,
      description: $localize`:@@featureBillingSettings-description-BILLING_EINVOICE_FORMAT:Default format; empty derives it from the issuer country.`,
    },
    BILLING_DEFAULT_CURRENCY: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DEFAULT_CURRENCY:Currency`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DEFAULT_CURRENCY:Currency of new invoices (ISO code).`,
    },
    BILLING_DOCUMENT_LOGO: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DOCUMENT_LOGO:Document logo`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DOCUMENT_LOGO:Printed at the top of invoices, credit notes, offers, time reports and inventory documents (PNG, JPEG, WebP or SVG, up to about 48 KB). Remove it to print no logo at this level.`,
    },
    BILLING_DOCUMENT_BRAND_COLOR: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DOCUMENT_BRAND_COLOR:Document brand color`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DOCUMENT_BRAND_COLOR:Color of the document type (such as Invoice) on generated documents (hex, e.g. #32a852). Everything else stays neutral.`,
    },
    BILLING_TAX_RATE_STANDARD: {
      title: $localize`:@@featureBillingSettings-title-BILLING_TAX_RATE_STANDARD:Standard VAT rate (%)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_TAX_RATE_STANDARD:Used when the EU tax table has no entry for the issuer country.`,
    },
    BILLING_TAX_RATE_REDUCED: {
      title: $localize`:@@featureBillingSettings-title-BILLING_TAX_RATE_REDUCED:Reduced VAT rate (%)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_TAX_RATE_REDUCED:Used when the EU tax table has no entry for the issuer country.`,
    },
    BILLING_OSS_REGISTERED: {
      title: $localize`:@@featureBillingSettings-title-BILLING_OSS_REGISTERED:OSS registered`,
      description: $localize`:@@featureBillingSettings-description-BILLING_OSS_REGISTERED:Always charges destination-country VAT for EU consumers.`,
    },
    BILLING_OSS_THRESHOLD_EUR: {
      title: $localize`:@@featureBillingSettings-title-BILLING_OSS_THRESHOLD_EUR:OSS threshold (EUR)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_OSS_THRESHOLD_EUR:Cross-border EU B2C net threshold.`,
    },
    BILLING_NON_EU_ISSUER_EU_B2B_CHARGE_VAT: {
      title: $localize`:@@featureBillingSettings-title-BILLING_NON_EU_ISSUER_EU_B2B_CHARGE_VAT:Charge VAT to EU businesses`,
      description: $localize`:@@featureBillingSettings-description-BILLING_NON_EU_ISSUER_EU_B2B_CHARGE_VAT:Non-EU issuers charge customer-country VAT to EU businesses.`,
    },
    BILLING_STATUTORY_WITHDRAWAL_PERIOD_DAYS: {
      title: $localize`:@@featureBillingSettings-title-BILLING_STATUTORY_WITHDRAWAL_PERIOD_DAYS:Withdrawal period (days)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_STATUTORY_WITHDRAWAL_PERIOD_DAYS:Days after provisioning during which statutory withdrawal is allowed.`,
    },
    PUBLIC_WITHDRAWAL_CONFIRMATION_TTL_HOURS: {
      title: $localize`:@@featureBillingSettings-title-PUBLIC_WITHDRAWAL_CONFIRMATION_TTL_HOURS:Withdrawal code lifetime (hours)`,
      description: $localize`:@@featureBillingSettings-description-PUBLIC_WITHDRAWAL_CONFIRMATION_TTL_HOURS:Hours until a public withdrawal confirmation code expires.`,
    },
    BILLING_DEFAULT_PAYMENT_PROCESSOR: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DEFAULT_PAYMENT_PROCESSOR:Default payment processor`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DEFAULT_PAYMENT_PROCESSOR:Processor used when an invoice names none.`,
    },
    BILLING_MIN_CHECKOUT_PAYMENT_AMOUNT: {
      title: $localize`:@@featureBillingSettings-title-BILLING_MIN_CHECKOUT_PAYMENT_AMOUNT:Minimum payable amount`,
      description: $localize`:@@featureBillingSettings-description-BILLING_MIN_CHECKOUT_PAYMENT_AMOUNT:Smaller balances are held until the next billing day.`,
    },
    STRIPE_SECRET_KEY: {
      title: $localize`:@@featureBillingSettings-title-STRIPE_SECRET_KEY:Stripe secret key`,
      description: $localize`:@@featureBillingSettings-description-STRIPE_SECRET_KEY:Secret API key of the Stripe account.`,
    },
    STRIPE_WEBHOOK_SECRET: {
      title: $localize`:@@featureBillingSettings-title-STRIPE_WEBHOOK_SECRET:Stripe webhook secret`,
      description: $localize`:@@featureBillingSettings-description-STRIPE_WEBHOOK_SECRET:Signing secret of the Stripe webhook endpoint.`,
    },
    STRIPE_CHECKOUT_SUCCESS_URL: {
      title: $localize`:@@featureBillingSettings-title-STRIPE_CHECKOUT_SUCCESS_URL:Checkout success URL`,
      description: $localize`:@@featureBillingSettings-description-STRIPE_CHECKOUT_SUCCESS_URL:Redirect after a successful checkout.`,
    },
    STRIPE_CHECKOUT_CANCEL_URL: {
      title: $localize`:@@featureBillingSettings-title-STRIPE_CHECKOUT_CANCEL_URL:Checkout cancel URL`,
      description: $localize`:@@featureBillingSettings-description-STRIPE_CHECKOUT_CANCEL_URL:Redirect after a cancelled checkout.`,
    },
    STRIPE_CHECKOUT_FRAUD_PROTECTION_ENABLED: {
      title: $localize`:@@featureBillingSettings-title-STRIPE_CHECKOUT_FRAUD_PROTECTION_ENABLED:Checkout fraud protection`,
      description: $localize`:@@featureBillingSettings-description-STRIPE_CHECKOUT_FRAUD_PROTECTION_ENABLED:Asks Stripe for fraud checks in checkout.`,
    },
    BILLING_AUTO_PAYMENT_RETRY_DELAY_1_MS: {
      title: $localize`:@@featureBillingSettings-title-BILLING_AUTO_PAYMENT_RETRY_DELAY_1_MS:First retry delay (ms)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_AUTO_PAYMENT_RETRY_DELAY_1_MS:Delay after the first failed automatic payment.`,
    },
    BILLING_AUTO_PAYMENT_RETRY_DELAY_2_MS: {
      title: $localize`:@@featureBillingSettings-title-BILLING_AUTO_PAYMENT_RETRY_DELAY_2_MS:Second retry delay (ms)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_AUTO_PAYMENT_RETRY_DELAY_2_MS:Delay after the second failed automatic payment.`,
    },
    BILLING_AUTO_PAYMENT_PENDING_SAFETY_DELAY_MS: {
      title: $localize`:@@featureBillingSettings-title-BILLING_AUTO_PAYMENT_PENDING_SAFETY_DELAY_MS:Pending payment delay (ms)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_AUTO_PAYMENT_PENDING_SAFETY_DELAY_MS:Safety delay for pending or SCA payments.`,
    },
    SMTP_HOST: {
      title: $localize`:@@featureBillingSettings-title-SMTP_HOST:SMTP host`,
      description: $localize`:@@featureBillingSettings-description-SMTP_HOST:Mail server for outgoing email. Empty disables sending.`,
    },
    SMTP_PORT: {
      title: $localize`:@@featureBillingSettings-title-SMTP_PORT:SMTP port`,
      description: $localize`:@@featureBillingSettings-description-SMTP_PORT:Port 465 uses implicit TLS, other ports STARTTLS when available.`,
    },
    SMTP_USER: {
      title: $localize`:@@featureBillingSettings-title-SMTP_USER:SMTP user`,
      description: $localize`:@@featureBillingSettings-description-SMTP_USER:User name for SMTP authentication.`,
    },
    SMTP_PASSWORD: {
      title: $localize`:@@featureBillingSettings-title-SMTP_PASSWORD:SMTP password`,
      description: $localize`:@@featureBillingSettings-description-SMTP_PASSWORD:Password for SMTP authentication.`,
    },
    EMAIL_FROM: {
      title: $localize`:@@featureBillingSettings-title-EMAIL_FROM:Sender address`,
      description: $localize`:@@featureBillingSettings-description-EMAIL_FROM:Envelope From of outgoing email.`,
    },
    EMAIL_COMPANY_NAME: {
      title: $localize`:@@featureBillingSettings-title-EMAIL_COMPANY_NAME:Brand name`,
      description: $localize`:@@featureBillingSettings-description-EMAIL_COMPANY_NAME:Company name in the email header and footer.`,
    },
    EMAIL_COMPANY_ADDRESS_LINE1: {
      title: $localize`:@@featureBillingSettings-title-EMAIL_COMPANY_ADDRESS_LINE1:Footer address`,
      description: $localize`:@@featureBillingSettings-description-EMAIL_COMPANY_ADDRESS_LINE1:Street and number in the email footer.`,
    },
    EMAIL_COMPANY_POSTAL_CODE: {
      title: $localize`:@@featureBillingSettings-title-EMAIL_COMPANY_POSTAL_CODE:Footer postal code`,
      description: $localize`:@@featureBillingSettings-description-EMAIL_COMPANY_POSTAL_CODE:Postal code in the email footer.`,
    },
    EMAIL_COMPANY_CITY: {
      title: $localize`:@@featureBillingSettings-title-EMAIL_COMPANY_CITY:Footer city`,
      description: $localize`:@@featureBillingSettings-description-EMAIL_COMPANY_CITY:City in the email footer.`,
    },
    EMAIL_COMPANY_COUNTRY: {
      title: $localize`:@@featureBillingSettings-title-EMAIL_COMPANY_COUNTRY:Footer country`,
      description: $localize`:@@featureBillingSettings-description-EMAIL_COMPANY_COUNTRY:ISO country code (e.g. DE) in the email footer.`,
    },
    EMAIL_COMPANY_VAT_ID: {
      title: $localize`:@@featureBillingSettings-title-EMAIL_COMPANY_VAT_ID:Footer VAT ID`,
      description: $localize`:@@featureBillingSettings-description-EMAIL_COMPANY_VAT_ID:VAT ID in the email footer.`,
    },
    EMAIL_COMPANY_EMAIL: {
      title: $localize`:@@featureBillingSettings-title-EMAIL_COMPANY_EMAIL:Footer contact email`,
      description: $localize`:@@featureBillingSettings-description-EMAIL_COMPANY_EMAIL:Contact address in the email footer.`,
    },
    BILLING_FRONTEND_URL: {
      title: $localize`:@@featureBillingSettings-title-BILLING_FRONTEND_URL:Console URL`,
      description: $localize`:@@featureBillingSettings-description-BILLING_FRONTEND_URL:Billing console URL of the default tenant (redirects and links).`,
    },
    TENANT_FRONTEND_URLS: {
      title: $localize`:@@featureBillingSettings-title-TENANT_FRONTEND_URLS:Tenant console URLs`,
      description: $localize`:@@featureBillingSettings-description-TENANT_FRONTEND_URLS:Comma-separated tenant=https://… pairs.`,
    },
    BILLING_DATEV_EXPORT_ENABLED: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_EXPORT_ENABLED:DATEV export`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_EXPORT_ENABLED:Enables monthly DATEV exports.`,
    },
    BILLING_DATEV_EXPORT_CRON: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_EXPORT_CRON:Export schedule`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_EXPORT_CRON:Cron expression of the monthly export.`,
    },
    BILLING_DATEV_EXPORT_TIMEZONE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_EXPORT_TIMEZONE:Export time zone`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_EXPORT_TIMEZONE:Time zone for the schedule and the export period.`,
    },
    BILLING_DATEV_UNIFIED_EXPORT_ENABLED: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_UNIFIED_EXPORT_ENABLED:Consolidated export`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_UNIFIED_EXPORT_ENABLED:Monthly export across all tenants.`,
    },
    BILLING_DATEV_TENANT_CONFIG: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_TENANT_CONFIG:Per-tenant JSON configuration`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_TENANT_CONFIG:Legacy JSON map of per-tenant DATEV values; tenant settings here take precedence.`,
    },
    BILLING_DATEV_CONSULTANT_NUMBER: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_CONSULTANT_NUMBER:Consultant number`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_CONSULTANT_NUMBER:DATEV Beraternummer (required for exports).`,
    },
    BILLING_DATEV_CLIENT_NUMBER: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_CLIENT_NUMBER:Client number`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_CLIENT_NUMBER:DATEV Mandantennummer (required for exports).`,
    },
    BILLING_DATEV_CHART_OF_ACCOUNTS: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_CHART_OF_ACCOUNTS:Chart of accounts`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_CHART_OF_ACCOUNTS:SKR03 or SKR04.`,
    },
    BILLING_DATEV_ACCOUNT_LENGTH: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_ACCOUNT_LENGTH:Account length`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_ACCOUNT_LENGTH:Sachkontenlänge in the export header.`,
    },
    BILLING_DATEV_FISCAL_YEAR_START_MONTH: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_FISCAL_YEAR_START_MONTH:Fiscal year start month`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_FISCAL_YEAR_START_MONTH:First month of the fiscal year (1 to 12).`,
    },
    BILLING_DATEV_EXPORT_DICTATION_ABBR: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_EXPORT_DICTATION_ABBR:Dictation abbreviation`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_EXPORT_DICTATION_ABBR:Diktatkürzel in the export header.`,
    },
    BILLING_DATEV_EXPORT_INCLUDE_DOCUMENTS: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_EXPORT_INCLUDE_DOCUMENTS:Include documents`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_EXPORT_INCLUDE_DOCUMENTS:Adds the PDF bundle and document links.`,
    },
    BILLING_DATEV_EXPORT_INCLUDE_BANK_POSTINGS: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_EXPORT_INCLUDE_BANK_POSTINGS:Include bank postings`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_EXPORT_INCLUDE_BANK_POSTINGS:Adds bookings from bank statement lines.`,
    },
    BILLING_DATEV_REVENUE_ACCOUNT_STANDARD: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_REVENUE_ACCOUNT_STANDARD:Revenue account (standard rate)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_REVENUE_ACCOUNT_STANDARD:Empty uses the chart default.`,
    },
    BILLING_DATEV_REVENUE_ACCOUNT_REDUCED: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_REVENUE_ACCOUNT_REDUCED:Revenue account (reduced rate)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_REVENUE_ACCOUNT_REDUCED:Empty uses the chart default.`,
    },
    BILLING_DATEV_REVENUE_ACCOUNT_REVERSE_CHARGE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_REVENUE_ACCOUNT_REVERSE_CHARGE:Revenue account (reverse charge)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_REVENUE_ACCOUNT_REVERSE_CHARGE:Empty uses the chart default.`,
    },
    BILLING_DATEV_REVENUE_ACCOUNT_OSS: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_REVENUE_ACCOUNT_OSS:Revenue account (OSS)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_REVENUE_ACCOUNT_OSS:Empty uses the chart default.`,
    },
    BILLING_DATEV_REVENUE_ACCOUNT_THIRD_COUNTRY: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_REVENUE_ACCOUNT_THIRD_COUNTRY:Revenue account (third country)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_REVENUE_ACCOUNT_THIRD_COUNTRY:Empty uses the chart default.`,
    },
    BILLING_DATEV_DEBTOR_ACCOUNT_START: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_DEBTOR_ACCOUNT_START:First debtor account`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_DEBTOR_ACCOUNT_START:Start of the debtor number range.`,
    },
    BILLING_DATEV_DEBTOR_ACCOUNT_END: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_DEBTOR_ACCOUNT_END:Last debtor account`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_DEBTOR_ACCOUNT_END:End of the debtor number range.`,
    },
    BILLING_DATEV_CREDITOR_ACCOUNT_START: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_CREDITOR_ACCOUNT_START:First creditor account`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_CREDITOR_ACCOUNT_START:Start of the creditor number range.`,
    },
    BILLING_DATEV_CREDITOR_ACCOUNT_END: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_CREDITOR_ACCOUNT_END:Last creditor account`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_CREDITOR_ACCOUNT_END:End of the creditor number range.`,
    },
    BILLING_DATEV_EXPENSE_ACCOUNT_STANDARD: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_EXPENSE_ACCOUNT_STANDARD:Expense account (standard rate)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_EXPENSE_ACCOUNT_STANDARD:Empty uses the chart default.`,
    },
    BILLING_DATEV_EXPENSE_ACCOUNT_REDUCED: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_EXPENSE_ACCOUNT_REDUCED:Expense account (reduced rate)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_EXPENSE_ACCOUNT_REDUCED:Empty uses the chart default.`,
    },
    BILLING_DATEV_EXPENSE_ACCOUNT_REVERSE_CHARGE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_EXPENSE_ACCOUNT_REVERSE_CHARGE:Expense account (reverse charge)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_EXPENSE_ACCOUNT_REVERSE_CHARGE:Empty uses the chart default.`,
    },
    BILLING_DATEV_EXPENSE_ACCOUNT_OSS: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_EXPENSE_ACCOUNT_OSS:Expense account (OSS)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_EXPENSE_ACCOUNT_OSS:Empty uses the chart default.`,
    },
    BILLING_DATEV_EXPENSE_ACCOUNT_THIRD_COUNTRY: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_EXPENSE_ACCOUNT_THIRD_COUNTRY:Expense account (third country)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_EXPENSE_ACCOUNT_THIRD_COUNTRY:Empty uses the chart default.`,
    },
    BILLING_DATEV_BU_KEY_STANDARD: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_BU_KEY_STANDARD:Tax key (standard rate)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_BU_KEY_STANDARD:BU-Schlüssel; empty for automatic accounts.`,
    },
    BILLING_DATEV_BU_KEY_REDUCED: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_BU_KEY_REDUCED:Tax key (reduced rate)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_BU_KEY_REDUCED:BU-Schlüssel; empty for automatic accounts.`,
    },
    BILLING_DATEV_BU_KEY_REVERSE_CHARGE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_BU_KEY_REVERSE_CHARGE:Tax key (reverse charge)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_BU_KEY_REVERSE_CHARGE:BU-Schlüssel for reverse charge revenue.`,
    },
    BILLING_DATEV_BU_KEY_OSS: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_BU_KEY_OSS:Tax key (OSS)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_BU_KEY_OSS:BU-Schlüssel for OSS revenue.`,
    },
    BILLING_DATEV_BU_KEY_THIRD_COUNTRY: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_BU_KEY_THIRD_COUNTRY:Tax key (third country)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_BU_KEY_THIRD_COUNTRY:BU-Schlüssel for third-country revenue.`,
    },
    BILLING_DATEV_EXPENSE_BU_KEY_STANDARD: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_EXPENSE_BU_KEY_STANDARD:Expense tax key (standard rate)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_EXPENSE_BU_KEY_STANDARD:BU-Schlüssel for expenses.`,
    },
    BILLING_DATEV_EXPENSE_BU_KEY_REDUCED: {
      title: $localize`:@@featureBillingSettings-title-BILLING_DATEV_EXPENSE_BU_KEY_REDUCED:Expense tax key (reduced rate)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_DATEV_EXPENSE_BU_KEY_REDUCED:BU-Schlüssel for expenses.`,
    },
    BILLING_ACCOUNTING_ENABLED: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_ENABLED:Accounting`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_ENABLED:Enables double-entry bookkeeping (needs a complete issuer).`,
    },
    BILLING_ACCOUNTING_COUNTRY: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_COUNTRY:Accounting country`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_COUNTRY:Country profile; empty uses the issuer country.`,
    },
    BILLING_ACCOUNTING_CHART_TEMPLATE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_CHART_TEMPLATE:Chart template`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_CHART_TEMPLATE:Template of the first chart (e.g. DE-SKR04).`,
    },
    BILLING_ACCOUNTING_METHOD: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_METHOD:Accounting method`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_METHOD:Accrual or cash basis.`,
    },
    BILLING_ACCOUNTING_VAT_BASIS: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_VAT_BASIS:VAT basis`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_VAT_BASIS:Invoice (Soll) or payment (Ist).`,
    },
    BILLING_ACCOUNTING_FISCAL_YEAR_START_MONTH: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_FISCAL_YEAR_START_MONTH:Fiscal year start month`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_FISCAL_YEAR_START_MONTH:First month of the fiscal year (1 to 12).`,
    },
    BILLING_ACCOUNTING_START_DATE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_START_DATE:Bookkeeping start`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_START_DATE:Date (YYYY-MM-DD); earlier open items become opening balances.`,
    },
    BILLING_ACCOUNTING_FUNCTIONAL_CURRENCY: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_FUNCTIONAL_CURRENCY:Ledger currency`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_FUNCTIONAL_CURRENCY:Currency of the ledger (ISO code).`,
    },
    BILLING_ACCOUNTING_TIMEZONE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_TIMEZONE:Booking time zone`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_TIMEZONE:Turns timestamps into booking dates.`,
    },
    BILLING_ACCOUNTING_VAT_RETURN_PERIOD: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_VAT_RETURN_PERIOD:VAT return period`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_VAT_RETURN_PERIOD:Default period of VAT returns in the console.`,
    },
    BILLING_ACCOUNTING_AUTO_MATCH_THRESHOLD: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_AUTO_MATCH_THRESHOLD:Auto-match threshold`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_AUTO_MATCH_THRESHOLD:Minimum score (0 to 1) for automatic reconciliation.`,
    },
    BILLING_ACCOUNTING_ASSET_GWG_LIMIT: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_ASSET_GWG_LIMIT:Low-value asset limit`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_ASSET_GWG_LIMIT:Assets up to this value are written off immediately.`,
    },
    BILLING_ACCOUNTING_ASSET_POOL_ENABLED: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_ASSET_POOL_ENABLED:Asset pool`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_ASSET_POOL_ENABLED:German pool depreciation (Sammelposten).`,
    },
    BILLING_ACCOUNTING_ASSET_POOL_LOWER: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_ASSET_POOL_LOWER:Asset pool lower limit`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_ASSET_POOL_LOWER:Lower value limit of the pool.`,
    },
    BILLING_ACCOUNTING_ASSET_POOL_UPPER: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_ASSET_POOL_UPPER:Asset pool upper limit`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_ASSET_POOL_UPPER:Upper value limit of the pool.`,
    },
    BILLING_ACCOUNTING_BANK_IMPORT_MAX_BYTES: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_BANK_IMPORT_MAX_BYTES:Statement upload limit (bytes)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_BANK_IMPORT_MAX_BYTES:Largest bank statement file accepted.`,
    },
    BILLING_ACCOUNTING_FX_SOURCE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_FX_SOURCE:Exchange rate source`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_FX_SOURCE:ECB reference rates or manual rates.`,
    },
    BILLING_ACCOUNTING_ECB_RATES_URL: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_ECB_RATES_URL:ECB rates URL`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_ECB_RATES_URL:HTTPS URL of the ECB daily feed.`,
    },
    BILLING_ACCOUNTING_FX_CRON: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_FX_CRON:Rate fetch schedule`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_FX_CRON:Cron expression of the rate fetch.`,
    },
    BILLING_ACCOUNTING_PROCESSOR_SYNC_CRON: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_PROCESSOR_SYNC_CRON:Processor sync schedule`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_PROCESSOR_SYNC_CRON:Cron expression of the payment processor balance sync.`,
    },
    BILLING_ACCOUNTING_CATCH_UP_INTERVAL_MS: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ACCOUNTING_CATCH_UP_INTERVAL_MS:Posting catch-up interval`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ACCOUNTING_CATCH_UP_INTERVAL_MS:Backfill and retry of failed postings.`,
    },
    BILLING_PRICE_RECALC_ENABLED: {
      title: $localize`:@@featureBillingSettings-title-BILLING_PRICE_RECALC_ENABLED:Daily price recalculation`,
      description: $localize`:@@featureBillingSettings-description-BILLING_PRICE_RECALC_ENABLED:Refreshes opted-in catalog prices from the provider nightly.`,
    },
    BILLING_PRICE_RECALC_CRON: {
      title: $localize`:@@featureBillingSettings-title-BILLING_PRICE_RECALC_CRON:Recalculation schedule`,
      description: $localize`:@@featureBillingSettings-description-BILLING_PRICE_RECALC_CRON:Cron expression of the recalculation.`,
    },
    BILLING_PRICE_RECALC_TIMEZONE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_PRICE_RECALC_TIMEZONE:Recalculation time zone`,
      description: $localize`:@@featureBillingSettings-description-BILLING_PRICE_RECALC_TIMEZONE:Time zone of the schedule and run date.`,
    },
    HETZNER_API_TOKEN: {
      title: $localize`:@@featureBillingSettings-title-HETZNER_API_TOKEN:Hetzner API token`,
      description: $localize`:@@featureBillingSettings-description-HETZNER_API_TOKEN:Default Hetzner Cloud token for server provisioning.`,
    },
    DIGITALOCEAN_API_TOKEN: {
      title: $localize`:@@featureBillingSettings-title-DIGITALOCEAN_API_TOKEN:DigitalOcean API token`,
      description: $localize`:@@featureBillingSettings-description-DIGITALOCEAN_API_TOKEN:Default DigitalOcean token for server provisioning.`,
    },
    CLOUDFLARE_API_TOKEN: {
      title: $localize`:@@featureBillingSettings-title-CLOUDFLARE_API_TOKEN:Cloudflare API token`,
      description: $localize`:@@featureBillingSettings-description-CLOUDFLARE_API_TOKEN:Token for DNS records of provisioned servers.`,
    },
    CLOUDFLARE_ZONE_ID: {
      title: $localize`:@@featureBillingSettings-title-CLOUDFLARE_ZONE_ID:Cloudflare zone`,
      description: $localize`:@@featureBillingSettings-description-CLOUDFLARE_ZONE_ID:Zone ID for DNS records.`,
    },
    DNS_BASE_DOMAIN: {
      title: $localize`:@@featureBillingSettings-title-DNS_BASE_DOMAIN:Base domain`,
      description: $localize`:@@featureBillingSettings-description-DNS_BASE_DOMAIN:Base domain of provisioned host names.`,
    },
    LETS_ENCRYPT_EMAIL: {
      title: $localize`:@@featureBillingSettings-title-LETS_ENCRYPT_EMAIL:Let’s Encrypt email`,
      description: $localize`:@@featureBillingSettings-description-LETS_ENCRYPT_EMAIL:Contact address for certificates of provisioned servers.`,
    },
    BILLING_ADDON_SSH_COMMAND_TIMEOUT_MS: {
      title: $localize`:@@featureBillingSettings-title-BILLING_ADDON_SSH_COMMAND_TIMEOUT_MS:Add-on script timeout (ms)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_ADDON_SSH_COMMAND_TIMEOUT_MS:Timeout of add-on SSH scripts on servers.`,
    },
    BILLING_SKIP_FILE_CACHE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_SKIP_FILE_CACHE:Skip file cache`,
      description: $localize`:@@featureBillingSettings-description-BILLING_SKIP_FILE_CACHE:Regenerates PDFs instead of using stored files.`,
    },
    DECABILL_TICKET_ATTACHMENT_MAX_BYTES: {
      title: $localize`:@@featureBillingSettings-title-DECABILL_TICKET_ATTACHMENT_MAX_BYTES:Ticket attachment limit (bytes)`,
      description: $localize`:@@featureBillingSettings-description-DECABILL_TICKET_ATTACHMENT_MAX_BYTES:Largest file accepted as a ticket attachment.`,
    },
    CONFIG_CHANGE_PROCESSING_TIMEOUT_MS: {
      title: $localize`:@@featureBillingSettings-title-CONFIG_CHANGE_PROCESSING_TIMEOUT_MS:Configuration change timeout (ms)`,
      description: $localize`:@@featureBillingSettings-description-CONFIG_CHANGE_PROCESSING_TIMEOUT_MS:Stuck configuration changes are reclaimed after this time.`,
    },
    REMINDER_DAYS: {
      title: $localize`:@@featureBillingSettings-title-REMINDER_DAYS:Renewal reminder (days)`,
      description: $localize`:@@featureBillingSettings-description-REMINDER_DAYS:Days before renewal to send a reminder.`,
    },
    BILLING_METER_COLLECT_ENABLED: {
      title: $localize`:@@featureBillingSettings-title-BILLING_METER_COLLECT_ENABLED:Meter collection`,
      description: $localize`:@@featureBillingSettings-description-BILLING_METER_COLLECT_ENABLED:Collects usage meters of subscriptions.`,
    },
    BILLING_CONTRIBUTOR_COLLECT_ENABLED: {
      title: $localize`:@@featureBillingSettings-title-BILLING_CONTRIBUTOR_COLLECT_ENABLED:Contributor collection`,
      description: $localize`:@@featureBillingSettings-description-BILLING_CONTRIBUTOR_COLLECT_ENABLED:Collects usage from integrated products.`,
    },
    BILLING_CONTAINER_MANAGER_COLLECT_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-BILLING_CONTAINER_MANAGER_COLLECT_INTERVAL:Container usage interval (ms)`,
      description: $localize`:@@featureBillingSettings-description-BILLING_CONTAINER_MANAGER_COLLECT_INTERVAL:How often container usage is collected.`,
    },
    BILLING_CONTAINER_MANAGER_COLLECT_CONCURRENCY: {
      title: $localize`:@@featureBillingSettings-title-BILLING_CONTAINER_MANAGER_COLLECT_CONCURRENCY:Container usage concurrency`,
      description: $localize`:@@featureBillingSettings-description-BILLING_CONTAINER_MANAGER_COLLECT_CONCURRENCY:Parallel container usage requests.`,
    },
    STATUS_POLL_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-STATUS_POLL_INTERVAL:Dashboard status interval (ms)`,
      description: $localize`:@@featureBillingSettings-description-STATUS_POLL_INTERVAL:How often the dashboard status is pushed.`,
    },
    INVENTORY_REQUESTS_POLL_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-INVENTORY_REQUESTS_POLL_INTERVAL:Inventory request interval (ms)`,
      description: $localize`:@@featureBillingSettings-description-INVENTORY_REQUESTS_POLL_INTERVAL:How often new inventory requests are announced.`,
    },
    UPDATE_CHECK_CRON: {
      title: $localize`:@@featureBillingSettings-title-UPDATE_CHECK_CRON:Update check schedule`,
      description: $localize`:@@featureBillingSettings-description-UPDATE_CHECK_CRON:Cron expression of the release check.`,
    },
    UPDATE_CHECK_TIMEZONE: {
      title: $localize`:@@featureBillingSettings-title-UPDATE_CHECK_TIMEZONE:Update check time zone`,
      description: $localize`:@@featureBillingSettings-description-UPDATE_CHECK_TIMEZONE:Time zone of the update check schedule.`,
    },
    BILLING_SCHEDULER_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-BILLING_SCHEDULER_INTERVAL:Subscription billing: interval`,
      description: $localize`:@@featureBillingSettings-description-BILLING_SCHEDULER_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    BILLING_SCHEDULER_BATCH_SIZE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_SCHEDULER_BATCH_SIZE:Subscription billing: batch size`,
      description: $localize`:@@featureBillingSettings-description-BILLING_SCHEDULER_BATCH_SIZE:Items processed per run.`,
    },
    EXPIRATION_SCHEDULER_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-EXPIRATION_SCHEDULER_INTERVAL:Subscription expiration: interval`,
      description: $localize`:@@featureBillingSettings-description-EXPIRATION_SCHEDULER_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    EXPIRATION_SCHEDULER_BATCH_SIZE: {
      title: $localize`:@@featureBillingSettings-title-EXPIRATION_SCHEDULER_BATCH_SIZE:Subscription expiration: batch size`,
      description: $localize`:@@featureBillingSettings-description-EXPIRATION_SCHEDULER_BATCH_SIZE:Items processed per run.`,
    },
    WITHDRAWAL_SCHEDULER_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-WITHDRAWAL_SCHEDULER_INTERVAL:Withdrawal teardown: interval`,
      description: $localize`:@@featureBillingSettings-description-WITHDRAWAL_SCHEDULER_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    WITHDRAWAL_SCHEDULER_BATCH_SIZE: {
      title: $localize`:@@featureBillingSettings-title-WITHDRAWAL_SCHEDULER_BATCH_SIZE:Withdrawal teardown: batch size`,
      description: $localize`:@@featureBillingSettings-description-WITHDRAWAL_SCHEDULER_BATCH_SIZE:Items processed per run.`,
    },
    INSTANT_CANCEL_SCHEDULER_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-INSTANT_CANCEL_SCHEDULER_INTERVAL:Instant cancellation: interval`,
      description: $localize`:@@featureBillingSettings-description-INSTANT_CANCEL_SCHEDULER_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    INSTANT_CANCEL_SCHEDULER_BATCH_SIZE: {
      title: $localize`:@@featureBillingSettings-title-INSTANT_CANCEL_SCHEDULER_BATCH_SIZE:Instant cancellation: batch size`,
      description: $localize`:@@featureBillingSettings-description-INSTANT_CANCEL_SCHEDULER_BATCH_SIZE:Items processed per run.`,
    },
    PROVISIONING_SCHEDULER_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-PROVISIONING_SCHEDULER_INTERVAL:Server provisioning: interval`,
      description: $localize`:@@featureBillingSettings-description-PROVISIONING_SCHEDULER_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    PROVISIONING_SCHEDULER_BATCH_SIZE: {
      title: $localize`:@@featureBillingSettings-title-PROVISIONING_SCHEDULER_BATCH_SIZE:Server provisioning: batch size`,
      description: $localize`:@@featureBillingSettings-description-PROVISIONING_SCHEDULER_BATCH_SIZE:Items processed per run.`,
    },
    CONFIG_CHANGE_SCHEDULER_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-CONFIG_CHANGE_SCHEDULER_INTERVAL:Configuration changes: interval`,
      description: $localize`:@@featureBillingSettings-description-CONFIG_CHANGE_SCHEDULER_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    CONFIG_CHANGE_SCHEDULER_BATCH_SIZE: {
      title: $localize`:@@featureBillingSettings-title-CONFIG_CHANGE_SCHEDULER_BATCH_SIZE:Configuration changes: batch size`,
      description: $localize`:@@featureBillingSettings-description-CONFIG_CHANGE_SCHEDULER_BATCH_SIZE:Items processed per run.`,
    },
    REMINDER_SCHEDULER_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-REMINDER_SCHEDULER_INTERVAL:Renewal reminders: interval`,
      description: $localize`:@@featureBillingSettings-description-REMINDER_SCHEDULER_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    REMINDER_SCHEDULER_BATCH_SIZE: {
      title: $localize`:@@featureBillingSettings-title-REMINDER_SCHEDULER_BATCH_SIZE:Renewal reminders: batch size`,
      description: $localize`:@@featureBillingSettings-description-REMINDER_SCHEDULER_BATCH_SIZE:Items processed per run.`,
    },
    BACKORDER_RETRY_INTERVAL_MS: {
      title: $localize`:@@featureBillingSettings-title-BACKORDER_RETRY_INTERVAL_MS:Backorder retries: interval`,
      description: $localize`:@@featureBillingSettings-description-BACKORDER_RETRY_INTERVAL_MS:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    BACKORDER_RETRY_BATCH_SIZE: {
      title: $localize`:@@featureBillingSettings-title-BACKORDER_RETRY_BATCH_SIZE:Backorder retries: batch size`,
      description: $localize`:@@featureBillingSettings-description-BACKORDER_RETRY_BATCH_SIZE:Items processed per run.`,
    },
    INVOICE_OVERDUE_SCHEDULER_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-INVOICE_OVERDUE_SCHEDULER_INTERVAL:Overdue invoices: interval`,
      description: $localize`:@@featureBillingSettings-description-INVOICE_OVERDUE_SCHEDULER_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    INVOICE_OVERDUE_SCHEDULER_BATCH_SIZE: {
      title: $localize`:@@featureBillingSettings-title-INVOICE_OVERDUE_SCHEDULER_BATCH_SIZE:Overdue invoices: batch size`,
      description: $localize`:@@featureBillingSettings-description-INVOICE_OVERDUE_SCHEDULER_BATCH_SIZE:Items processed per run.`,
    },
    INVOICE_AUTO_PAYMENT_SCHEDULER_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-INVOICE_AUTO_PAYMENT_SCHEDULER_INTERVAL:Automatic payments: interval`,
      description: $localize`:@@featureBillingSettings-description-INVOICE_AUTO_PAYMENT_SCHEDULER_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    INVOICE_AUTO_PAYMENT_SCHEDULER_BATCH_SIZE: {
      title: $localize`:@@featureBillingSettings-title-INVOICE_AUTO_PAYMENT_SCHEDULER_BATCH_SIZE:Automatic payments: batch size`,
      description: $localize`:@@featureBillingSettings-description-INVOICE_AUTO_PAYMENT_SCHEDULER_BATCH_SIZE:Items processed per run.`,
    },
    OPEN_POSITION_INVOICE_SCHEDULER_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-OPEN_POSITION_INVOICE_SCHEDULER_INTERVAL:Open position invoicing: interval`,
      description: $localize`:@@featureBillingSettings-description-OPEN_POSITION_INVOICE_SCHEDULER_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    SUBSCRIPTION_UPDATE_SCHEDULER_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-SUBSCRIPTION_UPDATE_SCHEDULER_INTERVAL:Subscription updates: interval`,
      description: $localize`:@@featureBillingSettings-description-SUBSCRIPTION_UPDATE_SCHEDULER_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    OFFER_EXPIRATION_SCHEDULER_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-OFFER_EXPIRATION_SCHEDULER_INTERVAL:Offer expiration: interval`,
      description: $localize`:@@featureBillingSettings-description-OFFER_EXPIRATION_SCHEDULER_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    OFFER_FULFILLMENT_SCHEDULER_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-OFFER_FULFILLMENT_SCHEDULER_INTERVAL:Offer fulfillment: interval`,
      description: $localize`:@@featureBillingSettings-description-OFFER_FULFILLMENT_SCHEDULER_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    BILLING_METER_COLLECT_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-BILLING_METER_COLLECT_INTERVAL:Meter collection: interval`,
      description: $localize`:@@featureBillingSettings-description-BILLING_METER_COLLECT_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    BILLING_METER_COLLECT_BATCH_SIZE: {
      title: $localize`:@@featureBillingSettings-title-BILLING_METER_COLLECT_BATCH_SIZE:Meter collection: batch size`,
      description: $localize`:@@featureBillingSettings-description-BILLING_METER_COLLECT_BATCH_SIZE:Items processed per run.`,
    },
    BILLING_CONTRIBUTOR_COLLECT_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-BILLING_CONTRIBUTOR_COLLECT_INTERVAL:Contributor collection: interval`,
      description: $localize`:@@featureBillingSettings-description-BILLING_CONTRIBUTOR_COLLECT_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    STORED_FILES_BACKFILL_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-STORED_FILES_BACKFILL_INTERVAL:Stored file backfill: interval`,
      description: $localize`:@@featureBillingSettings-description-STORED_FILES_BACKFILL_INTERVAL:How often the coordinator runs (e.g. 60000 or 1m).`,
    },
    SEARCH_REINDEX_INTERVAL: {
      title: $localize`:@@featureBillingSettings-title-SEARCH_REINDEX_INTERVAL:Search reindex interval`,
      description: $localize`:@@featureBillingSettings-description-SEARCH_REINDEX_INTERVAL:Interval of the periodic search index rebuild (e.g. 15m).`,
    },
  },
};
