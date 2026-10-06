import { CITIES, STREETS } from '../core/fixtures';
import { createCompanyName, createVatId } from '../core/people';
import { toDateOnly } from '../core/random';
import { json } from '../core/sql';

import { datevAccountNumber, DecabillTenantContext, scopedNumber, yearlyNumber } from './decabill-context';
import { computeLines, isEuCountry, resolveTax } from './decabill-tax';

const SUPPLIER_SERVICES = [
  { description: 'Cloud infrastructure usage', price: 1240 },
  { description: 'Software licenses (annual)', price: 3600 },
  { description: 'Office rent', price: 2100 },
  { description: 'Freelance design work', price: 1450 },
  { description: 'Telephone and internet', price: 89.9 },
  { description: 'Technical literature', price: 120, reduced: true },
] as const;
const WEBHOOK_EVENTS = [
  'invoice.created',
  'invoice.paid',
  'subscription.created',
  'subscription.provisioned',
  'subscription.canceled',
];
const EMAIL_TEMPLATES = [
  { event: 'invoice.created', template: 'invoice-issued' },
  { event: 'subscription.created', template: 'subscription-created' },
  { event: 'subscription.renewal_reminder', template: 'subscription-renewal-reminder' },
  { event: 'identity.email_confirmation', template: 'email-confirmation' },
];

export function buildSuppliers(context: DecabillTenantContext): void {
  const { random, rows, tenantId, numberScope, encryptor, issuerCountry } = context;
  const statusDeck = random.deck(['draft', 'issued', 'paid', 'paid', 'partially_paid', 'overdue', 'void'] as const);

  for (let s = 0; s < 4; s++) {
    const supplierId = random.id();
    const location = random.pick(CITIES.filter((city) => city.country !== 'US'));
    const vatId = createVatId(random, location);
    const company = createCompanyName(random);
    const createdAt = random.daysAgo(random.int(200, 700));

    rows.add('billing_supplier_profiles', {
      id: supplierId,
      tenant_id: tenantId,
      supplier_number: scopedNumber('SUP', 'billing_supplier_number_sequences', numberScope, 6),
      number_scope: numberScope,
      first_name: null,
      last_name: null,
      company,
      customer_type: 'business',
      vat_id: vatId,
      vat_id_validation_status: vatId ? 'valid' : 'none',
      vat_id_validated_at: vatId ? random.daysAgo(random.int(5, 60)) : null,
      vat_id_validation_source: vatId ? 'vies_sync' : null,
      address_line_1: `${random.pick(STREETS)} ${random.int(1, 99)}`,
      postal_code: location.postalCode,
      city: location.city,
      state: location.state ?? null,
      country: location.country,
      email: `billing@${company.split(' ')[0].toLowerCase()}.example`,
      phone: `${location.phonePrefix} ${random.int(1000000, 9999999)}`,
      custom_data: encryptor.encryptJson({}),
      created_at: createdAt,
      updated_at: createdAt,
    });

    const contractId = random.id();

    rows.add('billing_supplier_contracts', {
      id: contractId,
      supplier_id: supplierId,
      contract_number: `C-${random.int(10000, 99999)}`,
      created_at: createdAt,
    });

    rows.add('billing_datev_creditor_accounts', {
      id: random.id(),
      tenant_id: tenantId,
      supplier_id: supplierId,
      allocation_scope: numberScope,
      creditor_number: datevAccountNumber('creditor', numberScope, context.datevCounters.creditor++),
      created_at: createdAt,
    });

    const tax = resolveTax({ country: location.country, customerType: 'business', vatId }, issuerCountry);
    const count = random.int(2, 4);

    for (let i = 0; i < count; i++) {
      const service = random.pick(SUPPLIER_SERVICES);
      const status = statusDeck();
      const issueDate = status === 'issued' ? random.daysAgo(random.int(0, 7)) : random.daysAgo(random.int(15, 200));
      const totals = computeLines(
        [
          {
            description: service.description,
            quantity: 1,
            unitPriceNet: service.price,
            taxCategory: 'reduced' in service ? 'reduced' : 'standard',
          },
        ],
        tax,
      );
      const invoiceId = random.id();
      const hasDocument = status !== 'draft' && random.chance(0.3);

      rows.add('billing_supplier_invoices', {
        id: invoiceId,
        supplier_id: supplierId,
        contract_id: random.chance(0.6) ? contractId : null,
        invoice_number:
          status === 'draft'
            ? null
            : yearlyNumber(
                'SINV',
                'billing_supplier_invoice_number_sequences',
                numberScope,
                issueDate.getUTCFullYear(),
              ),
        status,
        currency: 'EUR',
        subtotal_net: totals.subtotalNet,
        tax_total: totals.taxTotal,
        total_gross: totals.totalGross,
        balance_due:
          status === 'paid' || status === 'void'
            ? 0
            : status === 'partially_paid'
              ? Math.round(totals.totalGross * 50) / 100
              : totals.totalGross,
        tax_mode: tax.taxMode,
        tax_country_code: tax.taxCountry,
        tax_note: tax.note,
        einvoice_tax_category_code: tax.einvoiceCode,
        resolved_tax_rate: totals.resolvedRate,
        supplier_vat_id: vatId,
        supplier_country: location.country,
        supplier_customer_type: 'business',
        recipient_country: issuerCountry,
        recipient_is_in_eu: isEuCountry(issuerCountry),
        issue_date: toDateOnly(issueDate),
        due_date: toDateOnly(random.addDays(issueDate, 30)),
        issued_at: status === 'draft' ? null : issueDate,
        voided_at: status === 'void' ? random.addDays(issueDate, 2) : null,
        paid_at: status === 'paid' ? random.addDays(issueDate, random.int(3, 25)) : null,
        // Uploaded documents are referenced but not stored; the download shows as unavailable.
        document_storage_key: null,
        document_source: hasDocument ? 'uploaded' : null,
        has_uploaded_document: false,
        created_at: issueDate,
      });

      totals.lines.forEach((line, index) => {
        rows.add('billing_supplier_invoice_line_items', {
          id: random.id(),
          invoice_id: invoiceId,
          position: index,
          description: line.description,
          quantity: line.quantity,
          unit_price_net: line.unitPriceNet,
          tax_category: line.taxCategory,
          tax_rate: line.taxRate,
          line_net: line.lineNet,
          line_tax: line.lineTax,
          line_gross: line.lineGross,
        });
      });
    }
  }
}

export function buildDatevAndOss(context: DecabillTenantContext): void {
  const { random, rows, tenantId } = context;
  const now = random.now;
  const months = [3, 4, 5].map((offset) => {
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));

    return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
  });

  months.forEach(({ year, month }, index) => {
    const failed = index === 1;
    const startedAt = new Date(Date.UTC(year, month, 1, 0, 5));

    rows.add('billing_datev_exports', {
      id: random.id(),
      scope: 'tenant',
      tenant_id: tenantId,
      period_year: year,
      period_month: month,
      status: failed ? 'failed' : 'completed',
      storage_key: null,
      file_name: failed ? null : `EXTF_Buchungsstapel_${year}${String(month).padStart(2, '0')}.csv`,
      booking_count: failed ? 0 : random.int(20, 140),
      invoice_count: failed ? 0 : random.int(10, 80),
      debtor_count: failed ? 0 : random.int(5, 30),
      included_tenant_ids: null,
      error_message: failed ? 'BILLING_DATEV_CONSULTANT_NUMBER is not configured' : null,
      triggered_by: index === 2 ? 'admin' : 'scheduler',
      started_at: startedAt,
      completed_at: new Date(startedAt.getTime() + random.int(5, 90) * 1000),
      created_at: startedAt,
      updated_at: startedAt,
    });
  });

  rows.add('billing_oss_threshold_ledgers', {
    id: random.id(),
    tenant_id: tenantId,
    calendar_year: now.getUTCFullYear() - 1,
    cross_border_b2c_net_total: random.decimal(2000, 14000),
    threshold_eur: 10000,
    threshold_exceeded_at: random.chance(0.5) ? random.daysAgo(random.int(300, 360)) : null,
    created_at: random.daysAgo(400),
    updated_at: random.daysAgo(300),
  });
}

export function buildNotifications(context: DecabillTenantContext, recipientEmails: string[]): void {
  const { random, rows, tenantId, encryptor } = context;
  const endpoints = [
    { name: 'ERP sync', url: 'https://erp.example.com/hooks', auth: 'authorization', enabled: true, failures: 0 },
    { name: 'Finance chat', url: 'https://chat.example.com/hooks/finance', auth: 'none', enabled: true, failures: 2 },
    { name: 'Legacy CRM', url: 'https://crm.example.org/webhook', auth: 'custom_header', enabled: false, failures: 25 },
  ];

  for (const endpoint of endpoints) {
    const endpointId = random.id();
    const createdAt = random.daysAgo(random.int(60, 300));

    rows.add('webhook_endpoints', {
      id: endpointId,
      scope_key: tenantId,
      client_id: null,
      name: endpoint.name,
      url: endpoint.url,
      http_method: 'POST',
      subscribed_events: json(random.pickMany(WEBHOOK_EVENTS, random.int(2, WEBHOOK_EVENTS.length))),
      enabled: endpoint.enabled,
      auth_type: endpoint.auth,
      auth_header_name: endpoint.auth === 'custom_header' ? 'X-Api-Key' : null,
      auth_value: endpoint.auth === 'none' ? null : encryptor.encrypt(`demo-${random.alphanumeric(24)}`),
      signing_secret: encryptor.encrypt(`whsec_${random.alphanumeric(32)}`),
      consecutive_failures: endpoint.failures,
      disabled_reason: endpoint.enabled ? null : 'Disabled after 25 consecutive failures',
      delivery_log_retention_days: 30,
      delivery_log_max_entries: 500,
      created_at: createdAt,
      updated_at: createdAt,
    });

    const count = random.int(4, 10);

    for (let i = 0; i < count; i++) {
      const success = endpoint.enabled && random.chance(endpoint.failures > 0 ? 0.5 : 0.95);

      rows.add('webhook_deliveries', {
        id: random.id(),
        endpoint_id: endpointId,
        event_id: random.id(),
        event_type: random.pick(WEBHOOK_EVENTS),
        payload: json({ demo: true, tenantId }),
        http_status: success ? 200 : random.pick([401, 500, 502, 504]),
        response_body: success ? '{"ok":true}' : 'Upstream error',
        success,
        attempt: success ? 1 : random.int(1, 5),
        error_message: success ? null : 'Request failed with non-2xx status',
        created_at: random.pastDate(30, 0),
      });
    }
  }

  for (let i = 0; i < 25; i++) {
    const template = random.pick(EMAIL_TEMPLATES);
    const success = random.chance(0.9);

    rows.add('email_deliveries', {
      id: random.id(),
      event_id: random.id(),
      event_type: template.event,
      scope_key: tenantId,
      template_key: template.template,
      recipient: encryptor.encrypt(random.pick(recipientEmails)),
      template_context: encryptor.encryptJson({ demo: true }),
      success,
      attempt: success ? 1 : random.int(2, 4),
      error_message: success ? null : encryptor.encrypt('SMTP connection timed out'),
      created_at: random.pastDate(60, 0),
    });
  }
}

export function buildGlobalSnapshots(context: DecabillTenantContext): void {
  const { random, rows } = context;

  for (const serverType of ['demo-standard', 'demo-large']) {
    rows.add('billing_provider_price_snapshots', {
      id: random.id(),
      provider: 'demo',
      provider_product_id: serverType,
      raw_price_payload: json({ monthly: serverType === 'demo-standard' ? 4.51 : 15.59 }),
      resolved_base_price: serverType === 'demo-standard' ? 4.51 : 15.59,
      currency: 'EUR',
      created_at: random.daysAgo(1),
    });

    for (const region of ['fsn1', 'nbg1', 'hel1']) {
      rows.add('billing_availability_snapshots', {
        id: random.id(),
        provider: 'demo',
        region,
        server_type: serverType,
        is_available: !(region === 'hel1' && serverType === 'demo-large'),
        raw_response: json({ source: 'demo-data' }),
        captured_at: random.daysAgo(0, 6),
      });
    }
  }
}
