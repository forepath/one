import { createHash } from 'crypto';

import { LOREM_SENTENCES, SOFTWARE_TOPICS, TICKET_VERBS } from '../core/fixtures';
import { roundMoney, slugify, toDateOnly } from '../core/random';
import { json, SqlRow } from '../core/sql';

import {
  DecabillTenantContext,
  DEMO_PROVIDER,
  DemoCatalog,
  DemoCustomer,
  DemoPlan,
  pickDemoLocation,
  scopedNumber,
  yearlyNumber,
} from './decabill-context';
import { computeLines, isEuCountry, LineInput, resolveTax } from './decabill-tax';

type InvoiceStatus = 'draft' | 'issued' | 'paid' | 'partially_paid' | 'overdue' | 'void';

type SubscriptionStatus =
  | 'active'
  | 'pending_backorder'
  | 'pending_cancel'
  | 'pending_withdrawal'
  | 'pending_instant_cancel'
  | 'pending_config_change'
  | 'canceled';

const OFFER_STATUSES = ['draft', 'archived', 'accepted', 'declined', 'expired', 'revoked'] as const;

type OfferStatus = (typeof OFFER_STATUSES)[number];

const DAY_MS = 24 * 60 * 60 * 1000;
const CANCEL_REQUESTED_STATUSES: readonly SubscriptionStatus[] = [
  'pending_cancel',
  'pending_withdrawal',
  'pending_instant_cancel',
  'canceled',
];

interface InvoiceSpec {
  customer: DemoCustomer;
  status: InvoiceStatus;
  issuedAt: Date;
  lines: LineInput[];
  subscriptionId?: string;
  projectId?: string;
  offerId?: string;
}

interface CreatedInvoice {
  id: string;
  status: InvoiceStatus;
  subtotalNet: number;
  totalGross: number;
  issuedAt: Date;
}

export class DecabillCommerceBuilder {
  private readonly invoiceStatusDeck: () => InvoiceStatus;
  private readonly subscriptionStatusDeck: () => SubscriptionStatus;

  constructor(
    private readonly context: DecabillTenantContext,
    private readonly catalog: DemoCatalog,
    private readonly admins: { userId: string; email: string }[],
  ) {
    const { random } = context;

    this.invoiceStatusDeck = random.deck<InvoiceStatus>([
      'issued',
      'paid',
      'paid',
      'partially_paid',
      'overdue',
      'void',
    ]);
    this.subscriptionStatusDeck = random.deck<SubscriptionStatus>([
      'active',
      'active',
      'active',
      'active',
      'pending_cancel',
      'pending_withdrawal',
      'pending_instant_cancel',
      'pending_config_change',
      'pending_backorder',
      'canceled',
    ]);
  }

  build(customers: DemoCustomer[]): void {
    const { random } = this.context;

    for (const customer of customers) {
      const subscriptionCount = random.int(1, 3);

      for (let i = 0; i < subscriptionCount; i++) {
        this.addSubscription(customer, this.subscriptionStatusDeck());
      }

      if (customer.customerType === 'business' && random.chance(0.7)) {
        this.addProject(customer);
      }

      if (random.chance(0.6)) {
        this.addOffer(customer);
      }

      if (random.chance(0.4)) {
        this.addInvoice({
          customer,
          status: this.invoiceStatusDeck(),
          issuedAt: random.pastDate(90, 1),
          lines: [
            { description: 'Onboarding workshop (half day)', quantity: 1, unitPriceNet: 640 },
            { description: 'Travel expenses', quantity: 1, unitPriceNet: random.decimal(40, 180) },
          ],
        });
      }
    }

    // Always provide every offer status and at least one draft invoice per tenant.
    for (const status of OFFER_STATUSES) {
      this.addOffer(random.pick(customers), status);
    }

    for (let i = 0; i < 2; i++) {
      this.addInvoice({
        customer: random.pick(customers),
        status: 'draft',
        issuedAt: random.now,
        lines: [{ description: 'Custom development (draft)', quantity: random.int(4, 24), unitPriceNet: 110 }],
      });
    }

    this.addBackorders(customers);
  }

  // ---------------------------------------------------------------------------
  // Subscriptions
  // ---------------------------------------------------------------------------

  private addSubscription(customer: DemoCustomer, status: SubscriptionStatus): void {
    const { random, rows, numberScope, encryptor } = this.context;
    const activePlans = this.catalog.plans.filter((plan) => plan.isActive);
    const activeServerPlans = activePlans.filter((plan) => plan.serviceTypeId);
    // Backorders and config changes only exist for server products.
    const needsServer = status === 'pending_backorder' || status === 'pending_config_change';
    const plan =
      status === 'canceled' && random.chance(0.5)
        ? (this.catalog.plans.find((candidate) => !candidate.isActive) ?? random.pick(activePlans))
        : random.pick(needsServer ? activeServerPlans : activePlans);
    const subscriptionId = random.id();
    const periodMs = this.periodLengthMs(plan);
    const periodStart = new Date(random.now.getTime() - random.next() * periodMs);
    const periodEnd = new Date(periodStart.getTime() + periodMs);
    // A subscription starts on a period boundary at or before the current period.
    const createdAt = new Date(periodStart.getTime() - random.int(0, 4) * periodMs - random.int(1, 3) * DAY_MS);
    const isCanceled = status === 'canceled';
    const cancelRequested = CANCEL_REQUESTED_STATUSES.includes(status);
    const cancelRequestedAt = cancelRequested ? random.daysAgo(random.int(1, 20)) : null;

    rows.add('billing_subscriptions', {
      id: subscriptionId,
      number: scopedNumber('SUB', 'billing_subscription_number_sequences', numberScope, 6),
      number_scope: numberScope,
      plan_id: plan.id,
      user_id: customer.userId,
      status,
      current_period_start: isCanceled ? random.daysAgo(60) : periodStart,
      current_period_end: isCanceled ? random.daysAgo(30) : periodEnd,
      next_billing_at: isCanceled ? null : periodEnd,
      cancel_requested_at: cancelRequestedAt,
      cancel_effective_at: isCanceled ? random.daysAgo(30) : status === 'pending_cancel' ? periodEnd : null,
      resumed_at: status === 'active' && random.chance(0.2) ? random.daysAgo(random.int(5, 30)) : null,
      // Withdrawals are processed once `withdrawn_at` has passed; keep it in the future.
      withdrawn_at: status === 'pending_withdrawal' ? random.daysFromNow(random.int(2, 10)) : null,
      withdraw_phase: status === 'pending_withdrawal' ? 'withdrawal_period' : null,
      statutory_withdrawal_restarted_at: null,
      instant_removal: status === 'pending_instant_cancel',
      instant_canceled_at: null,
      auto_backorder: status === 'pending_backorder',
      created_at: createdAt,
      updated_at: random.daysAgo(random.int(0, 20)),
    });

    const itemId = random.id();
    const location = pickDemoLocation(random);

    if (plan.serviceTypeId) {
      const provisioningStatus = status === 'pending_backorder' ? 'pending' : random.chance(0.12) ? 'failed' : 'active';
      const provisioned = provisioningStatus === 'active';
      const hostname = `${slugify(customer.person.company ?? customer.person.lastName).slice(0, 20)}-${random.hex(6)}`;
      const publicIp = `203.0.113.${random.int(2, 254)}`;
      const providerReference = `${DEMO_PROVIDER}-${random.int(10000000, 99999999)}`;

      rows.add('billing_subscription_items', {
        id: itemId,
        subscription_id: subscriptionId,
        service_type_id: plan.serviceTypeId,
        config_snapshot: encryptor.encryptJson({
          provider: DEMO_PROVIDER,
          serverType: 'demo-standard',
          location: location.location,
          service: 'custom',
        }),
        provisioning_status: provisioningStatus,
        provisioned_at: provisioned ? random.addMinutes(createdAt, random.int(2, 12)) : null,
        provider_reference: provisioned ? providerReference : null,
        hostname: provisioned ? hostname : null,
        display_name: provisioned && random.chance(0.6) ? `${plan.name} – ${customer.person.lastName}` : null,
        server_info_snapshot: provisioned
          ? json({
              serverId: providerReference,
              name: hostname,
              publicIp,
              privateIp: `10.0.${random.int(0, 9)}.${random.int(2, 254)}`,
              status: isCanceled ? 'off' : random.pick(['running', 'running', 'running', 'off']),
              metadata: { provider: DEMO_PROVIDER, ...location },
            })
          : null,
        ssh_private_key: null,
        created_at: createdAt,
        updated_at: createdAt,
      });

      if (provisioned) {
        rows.add('billing_reserved_hostnames', {
          id: random.id(),
          hostname,
          subscription_item_id: itemId,
        });
      }

      this.addSubscriptionAddons(subscriptionId, createdAt);
      this.addConfigChanges(subscriptionId, plan, status);
    } else {
      rows.add('billing_subscription_items', {
        id: itemId,
        subscription_id: subscriptionId,
        service_type_id: null,
        config_snapshot: encryptor.encryptJson({}),
        provisioning_status: 'active',
        provisioned_at: createdAt,
        created_at: createdAt,
        updated_at: createdAt,
      });
    }

    this.addUsage(subscriptionId, plan);
    const redemptionId = this.maybeAddRedemption(customer, subscriptionId, createdAt);
    const invoices = this.addSubscriptionInvoices(customer, subscriptionId, plan, periodStart, createdAt);

    if (redemptionId) {
      const firstPaid = invoices.find((invoice) => invoice.status === 'paid');

      if (firstPaid) {
        rows.add('billing_invoice_promotion_applications', {
          id: random.id(),
          invoice_id: firstPaid.id,
          redemption_id: redemptionId,
          amount_applied_net: roundMoney(Math.min(10, firstPaid.subtotalNet)),
          periods_consumed: 0,
          created_at: firstPaid.issuedAt,
        });
      }
    }

    if (plan.billInAdvance && !isCanceled) {
      this.addOpenPositions(customer, subscriptionId, plan, periodEnd, invoices[invoices.length - 1]);
    }
  }

  private periodLengthMs(plan: DemoPlan): number {
    const unit = { hour: DAY_MS / 24, day: DAY_MS, month: 30 * DAY_MS, year: 365 * DAY_MS }[plan.intervalType];

    return unit * plan.intervalValue;
  }

  private addSubscriptionAddons(subscriptionId: string, createdAt: Date): void {
    const { random, rows, encryptor } = this.context;
    const statuses = ['active', 'active', 'inactive', 'failed', 'pending', 'tearing_down'];

    for (const addon of random.pickMany(this.catalog.addons, random.int(0, 2))) {
      const status = random.pick(statuses);
      const activatedAt = random.addDays(createdAt, random.int(0, 20));

      rows.add('billing_subscription_addons', {
        id: random.id(),
        subscription_id: subscriptionId,
        addon_id: addon.id,
        status,
        config_snapshot: encryptor.encryptJson({}),
        unit_price_snapshot: addon.price,
        price_interval_type: 'month',
        price_interval_value: 1,
        addon_name_snapshot: addon.name,
        activated_at: status === 'pending' || status === 'failed' ? null : activatedAt,
        deactivated_at: status === 'inactive' ? random.daysAgo(random.int(1, 15)) : null,
        created_at: createdAt,
        updated_at: random.daysAgo(random.int(0, 15)),
      });
    }
  }

  private addConfigChanges(subscriptionId: string, plan: DemoPlan, status: SubscriptionStatus): void {
    const { random, rows, encryptor } = this.context;
    const variants: string[] = status === 'pending_config_change' ? ['pending'] : [];

    if (random.chance(0.35)) {
      variants.push(random.pick(['completed', 'completed', 'failed']));
    }

    for (const changeStatus of variants) {
      const requestedAt = changeStatus === 'pending' ? random.daysAgo(0, 2) : random.daysAgo(random.int(5, 120));
      const done = changeStatus !== 'pending';

      rows.add('billing_subscription_config_changes', {
        id: random.id(),
        subscription_id: subscriptionId,
        status: changeStatus,
        requested_payload: encryptor.encryptJson({ serverType: 'demo-large', previousServerType: 'demo-standard' }),
        billing_disclaimer_snapshot: json({ currentPrice: plan.price, newPrice: roundMoney(plan.price * 1.8) }),
        applied_steps: json(done ? ['resize_server', 'update_billing'] : []),
        billing_outcome: changeStatus === 'completed' ? random.pick(['charged', 'credited', 'deferred']) : null,
        reclaim_count: changeStatus === 'failed' ? random.int(1, 3) : 0,
        error_code: changeStatus === 'failed' ? 'provider_unavailable' : null,
        error_message: changeStatus === 'failed' ? 'Server type temporarily unavailable in this location.' : null,
        requested_at: requestedAt,
        processing_started_at: done ? random.addMinutes(requestedAt, 1) : null,
        processed_at: done ? random.addMinutes(requestedAt, random.int(2, 15)) : null,
        created_at: requestedAt,
        updated_at: requestedAt,
      });
    }
  }

  private addUsage(subscriptionId: string, plan: DemoPlan): void {
    const { random, rows } = this.context;

    for (const meterId of plan.meterIds) {
      for (let day = 14; day >= 1; day--) {
        const periodStart = new Date(Math.floor(random.daysAgo(day).getTime() / DAY_MS) * DAY_MS);

        rows.add('billing_usage_records', {
          id: random.id(),
          subscription_id: subscriptionId,
          period_start: periodStart,
          period_end: new Date(periodStart.getTime() + DAY_MS),
          usage_source: 'demo-data',
          usage_payload: json({ collector: 'demo-data' }),
          meter_id: meterId,
          value: random.decimal(0.5, 120, 3),
          attachment_type: 'plan',
          addon_id: null,
          created_at: new Date(periodStart.getTime() + DAY_MS + 60 * 60 * 1000),
        });
      }
    }
  }

  private maybeAddRedemption(customer: DemoCustomer, subscriptionId: string, createdAt: Date): string | null {
    const { random, rows } = this.context;

    if (!random.chance(0.3)) {
      return null;
    }

    const promotion = random.pick(this.catalog.promotions);
    const status = random.pick(['active', 'active', 'exhausted', 'expired', 'cancelled']);
    const id = random.id();

    rows.add('billing_promotion_redemptions', {
      id,
      promotion_id: promotion.id,
      user_id: customer.userId,
      subscription_id: subscriptionId,
      code_snapshot: promotion.code,
      redemption_context: random.pick(['new', 'existing']),
      status,
      redeemed_at: createdAt,
      benefit_starts_at: createdAt,
      benefit_ends_at: status === 'active' ? random.daysFromNow(random.int(5, 60)) : random.daysAgo(random.int(1, 30)),
      remaining_amount_net:
        promotion.advantageType === 'fixed_amount_net'
          ? status === 'active'
            ? promotion.config.amountNet / 2
            : 0
          : null,
      remaining_billing_periods:
        promotion.advantageType === 'free_billing_periods' ? (status === 'active' ? 1 : 0) : null,
      created_at: createdAt,
    });

    return id;
  }

  private addSubscriptionInvoices(
    customer: DemoCustomer,
    subscriptionId: string,
    plan: DemoPlan,
    currentPeriodStart: Date,
    createdAt: Date,
  ): CreatedInvoice[] {
    const { random } = this.context;
    const invoices: CreatedInvoice[] = [];

    if (plan.intervalType === 'hour' || plan.intervalType === 'day') {
      const quantity = plan.intervalType === 'hour' ? random.int(20, 300) : random.int(3, 25);

      invoices.push(
        this.addInvoice({
          customer,
          subscriptionId,
          status: this.invoiceStatusDeck(),
          issuedAt: random.pastDate(25, 1),
          lines: [
            {
              description: `${plan.name} – ${quantity} ${plan.intervalType === 'hour' ? 'hours' : 'days'}`,
              quantity,
              unitPriceNet: plan.price,
              taxCategory: plan.taxCategory,
            },
          ],
        }),
      );

      return invoices;
    }

    const periodMs = this.periodLengthMs(plan);
    const maxPast = Math.floor((currentPeriodStart.getTime() - createdAt.getTime()) / periodMs);
    const pastPeriods = Math.max(0, Math.min(4, maxPast));

    for (let i = pastPeriods; i >= 1; i--) {
      const periodStart = new Date(currentPeriodStart.getTime() - i * periodMs);
      const periodEnd = new Date(periodStart.getTime() + periodMs);
      const issuedAt = plan.billInAdvance ? periodStart : periodEnd;

      invoices.push(
        this.addInvoice({
          customer,
          subscriptionId,
          // Older periods are settled; only the latest invoice shows an interesting state.
          status: i === 1 ? this.invoiceStatusDeck() : 'paid',
          issuedAt: issuedAt.getTime() > random.now.getTime() ? random.daysAgo(1) : issuedAt,
          lines: [
            {
              description: `${plan.name} (${toDateOnly(periodStart)} – ${toDateOnly(periodEnd)})`,
              quantity: 1,
              unitPriceNet: plan.price,
              taxCategory: plan.taxCategory,
            },
          ],
        }),
      );
    }

    return invoices;
  }

  private addOpenPositions(
    customer: DemoCustomer,
    subscriptionId: string,
    plan: DemoPlan,
    periodEnd: Date,
    lastInvoice: CreatedInvoice | undefined,
  ): void {
    const { random, rows } = this.context;

    rows.add('billing_open_positions', {
      id: random.id(),
      subscription_id: subscriptionId,
      user_id: customer.userId,
      description: `${plan.name} – next period`,
      bill_until: periodEnd,
      skip_if_no_billable_amount: true,
      adjustment_net: null,
      adjustment_kind: null,
      source_ref: null,
      created_at: random.daysAgo(random.int(1, 10)),
      invoice_ref_id: null,
    });

    if (random.chance(0.5)) {
      rows.add('billing_open_positions', {
        id: random.id(),
        subscription_id: subscriptionId,
        user_id: customer.userId,
        description: 'Goodwill credit for maintenance window',
        bill_until: periodEnd,
        skip_if_no_billable_amount: false,
        adjustment_net: -roundMoney(plan.price * 0.1),
        adjustment_kind: 'goodwill_credit',
        source_ref: `demo-goodwill-${random.hex(8)}`,
        created_at: random.daysAgo(random.int(1, 10)),
        invoice_ref_id: null,
      });
    }

    if (lastInvoice) {
      rows.add('billing_open_positions', {
        id: random.id(),
        subscription_id: subscriptionId,
        user_id: customer.userId,
        description: `${plan.name} – billed period`,
        bill_until: lastInvoice.issuedAt,
        skip_if_no_billable_amount: true,
        created_at: random.addDays(lastInvoice.issuedAt, -1),
        invoice_ref_id: lastInvoice.id,
      });
    }
  }

  private addBackorders(customers: DemoCustomer[]): void {
    const { random, rows, encryptor } = this.context;
    const serverPlans = this.catalog.plans.filter((plan) => plan.serviceTypeId && plan.isActive);

    for (const status of ['pending', 'retrying', 'failed', 'cancelled', 'fulfilled']) {
      const plan = random.pick(serverPlans);
      const createdAt = random.daysAgo(random.int(1, 40));

      rows.add('billing_backorders', {
        id: random.id(),
        user_id: random.pick(customers).userId,
        service_type_id: plan.serviceTypeId,
        plan_id: plan.id,
        requested_config_snapshot: encryptor.encryptJson({
          provider: DEMO_PROVIDER,
          serverType: 'demo-large',
          location: 'hel1',
        }),
        status,
        failure_reason: status === 'failed' || status === 'retrying' ? 'Server type sold out in hel1' : null,
        provider_errors: json(status === 'fulfilled' ? {} : { [DEMO_PROVIDER]: 'resource_unavailable' }),
        preferred_alternatives: json({ locations: ['fsn1', 'nbg1'] }),
        // Keeps the retry job from picking open backorders up immediately.
        retry_after: status === 'pending' || status === 'retrying' ? random.daysFromNow(random.int(7, 30)) : null,
        created_at: createdAt,
        updated_at: random.addDays(createdAt, 1),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Invoices and payments
  // ---------------------------------------------------------------------------

  addInvoice(spec: InvoiceSpec): CreatedInvoice {
    const { random, rows, numberScope, issuerCountry } = this.context;
    const { customer, status } = spec;
    const tax = resolveTax(customer, issuerCountry);
    const totals = computeLines(spec.lines, tax);
    const id = random.id();
    const isDraft = status === 'draft';
    const issuedAt = isDraft ? null : spec.issuedAt;
    // Issued invoices must still be within the payment term, otherwise the overdue job flips them.
    const effectiveIssuedAt =
      status === 'issued'
        ? random.daysAgo(random.int(0, 8))
        : status === 'overdue'
          ? random.daysAgo(random.int(20, 60))
          : issuedAt;
    const dueDate = effectiveIssuedAt ? random.addDays(effectiveIssuedAt, 14) : null;
    const paidAt = status === 'paid' && effectiveIssuedAt ? random.addDays(effectiveIssuedAt, random.int(0, 12)) : null;
    const balanceDue =
      status === 'paid' || status === 'void'
        ? 0
        : status === 'partially_paid'
          ? roundMoney(totals.totalGross / 2)
          : totals.totalGross;
    const year = (effectiveIssuedAt ?? random.now).getUTCFullYear();
    const viaStripe = customer.autoBilling || random.chance(0.3);

    rows.add('billing_invoices', {
      id,
      subscription_id: spec.subscriptionId ?? null,
      user_id: customer.userId,
      project_id: spec.projectId ?? null,
      offer_id: spec.offerId ?? null,
      invoice_number: isDraft ? null : yearlyNumber('INV', 'billing_invoice_number_sequences', numberScope, year),
      status,
      currency: 'EUR',
      subtotal_net: totals.subtotalNet,
      tax_total: totals.taxTotal,
      total_gross: totals.totalGross,
      balance_due: balanceDue,
      tax_mode: tax.taxMode,
      tax_country_code: tax.taxCountry,
      tax_note: tax.note,
      einvoice_tax_category_code: tax.einvoiceCode,
      resolved_tax_rate: totals.resolvedRate,
      buyer_vat_id: customer.vatId,
      buyer_country: customer.country,
      buyer_customer_type: customer.customerType,
      issuer_country: issuerCountry,
      issuer_is_in_eu: isEuCountry(issuerCountry),
      issued_at: effectiveIssuedAt,
      due_date: dueDate ? toDateOnly(dueDate) : null,
      voided_at: status === 'void' && effectiveIssuedAt ? random.addDays(effectiveIssuedAt, random.int(1, 5)) : null,
      paid_at: paidAt,
      // PDFs are generated on first download (requires BILLING_ISSUER_* to be configured).
      pdf_storage_key: null,
      payment_processor: viaStripe && (status === 'paid' || status === 'partially_paid') ? 'stripe' : null,
      external_payment_id: viaStripe && status === 'paid' ? `pi_demo${random.alphanumeric(16)}` : null,
      auto_payment_status: this.autoPaymentStatus(customer, status),
      auto_payment_attempt_count: this.autoPaymentStatus(customer, status) === 'idle' ? 0 : random.int(1, 3),
      auto_payment_next_retry_at: null,
      created_at: effectiveIssuedAt ?? random.daysAgo(random.int(0, 3)),
    });

    totals.lines.forEach((line, index) => {
      rows.add('billing_invoice_line_items', {
        id: random.id(),
        invoice_id: id,
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

    if (effectiveIssuedAt) {
      this.addPayments(id, status, totals.totalGross, effectiveIssuedAt, viaStripe);
      this.addAuditLog(id, customer.userId, 'invoice-issue', 'info', 'Invoice issued', effectiveIssuedAt);
    }

    return {
      id,
      status,
      subtotalNet: totals.subtotalNet,
      totalGross: totals.totalGross,
      issuedAt: effectiveIssuedAt ?? random.now,
    };
  }

  private autoPaymentStatus(customer: DemoCustomer, status: InvoiceStatus): string {
    if (!customer.autoBilling) {
      return 'idle';
    }

    switch (status) {
      case 'paid':
        return 'succeeded';
      case 'overdue':
        return 'exhausted';
      case 'void':
        return 'canceled';
      default:
        return 'idle';
    }
  }

  private addPayments(
    invoiceId: string,
    status: InvoiceStatus,
    total: number,
    issuedAt: Date,
    viaStripe: boolean,
  ): void {
    const { random, rows } = this.context;
    const attempt = (attemptStatus: string, amount: number, offsetDays: number, metadata: object = {}): void => {
      const createdAt = random.addDays(issuedAt, offsetDays);
      const id = random.id();

      rows.add('billing_payment_attempts', {
        id,
        invoice_id: invoiceId,
        processor: 'stripe',
        external_id: `pi_demo${random.alphanumeric(16)}`,
        status: attemptStatus,
        amount,
        currency: 'EUR',
        idempotency_key: `demo-${id}`,
        metadata: json(metadata),
        created_at: createdAt,
        updated_at: random.addMinutes(createdAt, 3),
      });
    };

    if (!viaStripe) {
      return;
    }

    switch (status) {
      case 'paid':
        if (random.chance(0.3)) {
          attempt('failed', total, 1, { failureCode: 'card_declined' });
        }

        attempt('succeeded', total, 2);

        if (random.chance(0.1)) {
          rows.add('billing_payment_refunds', {
            id: random.id(),
            invoice_id: invoiceId,
            amount: roundMoney(total / 4),
            currency: 'EUR',
            processor: 'stripe',
            external_refund_id: `re_demo${random.alphanumeric(16)}`,
            status: random.pick(['succeeded', 'pending', 'failed']),
            reason: 'goodwill',
            created_at: random.addDays(issuedAt, 10),
            updated_at: random.addDays(issuedAt, 10),
          });
        }

        break;
      case 'partially_paid':
        attempt('succeeded', roundMoney(total / 2), 2);
        break;
      case 'overdue':
        attempt('failed', total, 1, { failureCode: 'insufficient_funds' });
        attempt('failed', total, 4, { failureCode: 'insufficient_funds' });
        this.addAuditLog(invoiceId, null, 'auto-payment', 'warn', 'Automatic payment attempts exhausted', issuedAt);
        break;
      case 'issued':
        attempt('pending', total, 0);
        break;
      case 'void':
        attempt('canceled', total, 0);
        break;
      default:
        break;
    }
  }

  private addAuditLog(
    invoiceId: string | null,
    userId: string | null,
    process: string,
    level: 'info' | 'warn' | 'error',
    message: string,
    createdAt: Date,
    offerId: string | null = null,
  ): void {
    const { random, rows, tenantId } = this.context;

    rows.add('billing_audit_logs', {
      id: random.id(),
      correlation_id: random.hex(16),
      process,
      invoice_id: invoiceId,
      offer_id: offerId,
      user_id: userId,
      tenant_id: tenantId,
      level,
      message,
      context: json({ source: 'demo-data' }),
      created_at: createdAt,
    });
  }

  // ---------------------------------------------------------------------------
  // Offers
  // ---------------------------------------------------------------------------

  private addOffer(customer: DemoCustomer, status: OfferStatus = this.context.random.pick(OFFER_STATUSES)): void {
    const { random, rows, numberScope, issuerCountry } = this.context;
    const tax = resolveTax(customer, issuerCountry);
    const plan = random.pick(this.catalog.plans.filter((candidate) => candidate.isActive));
    const lines: (LineInput & { lineType: string })[] = [
      { lineType: 'standard', description: 'Requirements workshop', quantity: 1, unitPriceNet: 980, unitLabel: 'day' },
      {
        lineType: 'standard',
        description: `Implementation: ${random.pick(SOFTWARE_TOPICS)}`,
        quantity: random.int(16, 120),
        unitPriceNet: 115,
        unitLabel: 'h',
      },
      { lineType: 'plan_template', description: plan.name, quantity: 1, unitPriceNet: plan.price, unitLabel: 'period' },
    ];
    const totals = computeLines(lines, tax);
    const offerId = random.id();
    const createdAt = random.daysAgo(random.int(5, 120));
    const sentAt = random.addDays(createdAt, 1);
    const decidedAt = random.addDays(sentAt, random.int(2, 10));

    rows.add('billing_offers', {
      id: offerId,
      user_id: customer.userId,
      // Numbers are assigned when an offer is archived (sent); drafts have none yet.
      offer_number:
        status === 'draft'
          ? null
          : yearlyNumber('OFF', 'billing_offer_number_sequences', numberScope, sentAt.getUTCFullYear()),
      number_scope: numberScope,
      status,
      currency: 'EUR',
      subtotal_net: totals.subtotalNet,
      tax_total: totals.taxTotal,
      total_gross: totals.totalGross,
      tax_mode: tax.taxMode,
      tax_country_code: tax.taxCountry,
      tax_note: tax.note,
      einvoice_tax_category_code: tax.einvoiceCode,
      resolved_tax_rate: totals.resolvedRate,
      buyer_vat_id: customer.vatId,
      buyer_country: customer.country,
      buyer_customer_type: customer.customerType,
      issuer_country: issuerCountry,
      issuer_is_in_eu: isEuCountry(issuerCountry),
      // The expiration job only acts on archived offers whose expiry has passed.
      expires_at: status === 'expired' ? random.daysAgo(random.int(1, 20)) : random.daysFromNow(random.int(10, 45)),
      archived_at: status === 'draft' ? null : sentAt,
      accepted_at: status === 'accepted' ? decidedAt : null,
      declined_at: status === 'declined' ? decidedAt : null,
      expired_at: status === 'expired' ? random.daysAgo(random.int(0, 5)) : null,
      revoked_at: status === 'revoked' ? decidedAt : null,
      bill_to_open_positions: random.chance(0.3),
      pdf_storage_key: null,
      created_at: createdAt,
      updated_at: status === 'draft' ? createdAt : decidedAt,
    });

    totals.lines.forEach((line, index) => {
      const accepted = status === 'accepted';

      rows.add('billing_offer_line_items', {
        id: random.id(),
        offer_id: offerId,
        position: index,
        line_type: lines[index].lineType,
        description: line.description,
        quantity: line.quantity,
        unit_label: line.unitLabel ?? null,
        unit_price_net: line.unitPriceNet,
        tax_category: line.taxCategory,
        tax_rate: line.taxRate,
        line_net: line.lineNet,
        line_tax: line.lineTax,
        line_gross: line.lineGross,
        // Accepted offers are already fulfilled so the fulfillment job leaves them alone.
        fulfillment_status: accepted ? 'completed' : 'pending',
        scheduled_at: accepted ? decidedAt : null,
        fulfilled_at: accepted ? random.addMinutes(decidedAt, 5) : null,
        plan_id: lines[index].lineType === 'plan_template' ? plan.id : null,
        plan_name_snapshot: lines[index].lineType === 'plan_template' ? plan.name : null,
        pricing_snapshot: lines[index].lineType === 'plan_template' ? json({ basePrice: plan.price }) : null,
        auto_backorder: false,
      });
    });

    this.addAuditLog(null, customer.userId, 'offer', 'info', `Offer ${status}`, createdAt, offerId);

    if (status === 'accepted') {
      this.addInvoice({
        customer,
        offerId,
        status: random.pick(['paid', 'issued'] as const),
        issuedAt: random.addDays(decidedAt, 1),
        lines: toLineInputs(totals.lines.slice(0, 2)),
      });
    }
  }

  // ---------------------------------------------------------------------------
  // Projects
  // ---------------------------------------------------------------------------

  private addProject(customer: DemoCustomer): void {
    const { random, rows } = this.context;
    const projectId = random.id();
    const status = random.chance(0.75) ? 'active' : 'archived';
    const createdAt = random.daysAgo(random.int(30, 300));
    const hourlyRate = random.pick([95, 110, 125, 145]);
    const topic = random.pick(SOFTWARE_TOPICS);
    const staff = this.admins[0];

    rows.add('billing_projects', {
      id: projectId,
      user_id: customer.userId,
      name: `${customer.person.company ?? customer.person.lastName}: ${topic}`,
      description: `Delivery project covering the ${topic} for ${customer.person.company ?? customer.person.fullName}.`,
      status,
      hourly_rate_net: hourlyRate,
      target_hours: random.pick([40, 80, 120, null]),
      currency: 'EUR',
      created_at: createdAt,
      updated_at: random.daysAgo(random.int(0, 20)),
    });

    const milestoneIds = ['Discovery', 'Implementation', 'Rollout', 'Hypercare']
      .slice(0, random.int(2, 4))
      .map((name, index) => {
        const id = random.id();

        rows.add('billing_project_milestones', {
          id,
          project_id: projectId,
          name,
          description: `${name} phase`,
          target_date: toDateOnly(random.addDays(createdAt, 30 * (index + 1))),
          sort_order: index,
          locked_at: index === 0 || status === 'archived' ? random.addDays(createdAt, 30 * (index + 1)) : null,
          created_at: createdAt,
          updated_at: createdAt,
        });

        return id;
      });
    const statusDeck = random.deck(['draft', 'todo', 'in_progress', 'prototype', 'done', 'closed']);
    const priorityDeck = random.deck(['low', 'medium', 'high', 'critical']);
    const ticketIds: string[] = [];
    const count = random.int(6, 12);

    for (let i = 0; i < count; i++) {
      const id = random.id();
      const ticketStatus = status === 'archived' ? 'closed' : statusDeck();
      const ticketCreatedAt = random.addDays(createdAt, random.int(0, 25));
      const parentId = ticketIds.length > 2 && random.chance(0.25) ? random.pick(ticketIds) : null;

      ticketIds.push(id);
      rows.add('billing_project_tickets', {
        id,
        project_id: projectId,
        milestone_id: random.chance(0.8) ? random.pick(milestoneIds) : null,
        parent_id: parentId,
        title: `${random.pick(TICKET_VERBS)} ${random.pick(SOFTWARE_TOPICS)}`,
        content: [
          '## Context',
          random.pick(LOREM_SENTENCES),
          '',
          '## Acceptance criteria',
          ...random.pickMany(LOREM_SENTENCES, 2).map((sentence) => `- ${sentence}`),
        ].join('\n'),
        long_sha: createHash('sha1').update(id).digest('hex'),
        priority: priorityDeck(),
        status: ticketStatus,
        locked: ticketStatus === 'closed' && random.chance(0.5),
        created_by_user_id: random.chance(0.5) ? customer.userId : staff.userId,
        created_at: ticketCreatedAt,
        updated_at: random.addDays(ticketCreatedAt, random.int(0, 10)),
      });
      this.addTicketHistory(id, ticketStatus, ticketCreatedAt, customer.userId, staff.userId);
    }

    this.addTimeEntries(customer, projectId, ticketIds, hourlyRate, createdAt, staff.userId);
  }

  private addTicketHistory(
    ticketId: string,
    status: string,
    createdAt: Date,
    customerId: string,
    staffId: string,
  ): void {
    const { random, rows } = this.context;

    rows.add('billing_project_ticket_activities', {
      id: random.id(),
      ticket_id: ticketId,
      occurred_at: createdAt,
      actor_type: 'human',
      actor_user_id: staffId,
      action_type: 'CREATED',
      payload: json({}),
    });

    if (status !== 'draft') {
      rows.add('billing_project_ticket_activities', {
        id: random.id(),
        ticket_id: ticketId,
        occurred_at: random.addDays(createdAt, 1),
        actor_type: random.pick(['human', 'human', 'system']),
        actor_user_id: staffId,
        action_type: 'STATUS_CHANGED',
        payload: json({ fields: { status: { old: 'draft', new: status } } }),
      });
    }

    const count = random.int(0, 3);

    for (let i = 0; i < count; i++) {
      const commentId = random.id();
      const author = random.chance(0.5) ? customerId : staffId;
      const commentedAt = random.addDays(createdAt, i + 1);

      rows.add('billing_project_ticket_comments', {
        id: commentId,
        ticket_id: ticketId,
        user_id: author,
        body: random.pick(LOREM_SENTENCES),
        created_at: commentedAt,
      });
      rows.add('billing_project_ticket_activities', {
        id: random.id(),
        ticket_id: ticketId,
        occurred_at: commentedAt,
        actor_type: 'human',
        actor_user_id: author,
        action_type: 'COMMENT_ADDED',
        payload: json({ commentId }),
      });
    }
  }

  private addTimeEntries(
    customer: DemoCustomer,
    projectId: string,
    ticketIds: string[],
    hourlyRate: number,
    projectCreatedAt: Date,
    staffId: string,
  ): void {
    const { random, rows } = this.context;
    const entries: { row: SqlRow; minutes: number }[] = [];
    const count = random.int(6, 18);

    for (let i = 0; i < count; i++) {
      const startedAt = random.pastDate(Math.max(1, (random.now.getTime() - projectCreatedAt.getTime()) / DAY_MS), 0);
      const minutes = random.pick([30, 45, 60, 90, 120, 180, 240]);
      const row = rows.add('billing_project_time_entries', {
        id: random.id(),
        project_id: projectId,
        ticket_id: random.chance(0.8) ? random.pick(ticketIds) : null,
        recorded_by_user_id: staffId,
        duration_minutes: minutes,
        description: random.pick(LOREM_SENTENCES),
        started_at: startedAt,
        ended_at: random.addMinutes(startedAt, minutes),
        recorded_at: random.addMinutes(startedAt, minutes + 5),
        invoice_id: null,
        billed_at: null,
        created_at: random.addMinutes(startedAt, minutes + 5),
      });

      entries.push({ row, minutes });
    }

    // Bill roughly the older half of the entries through a project invoice.
    const billed = entries
      .sort((a, b) => (a.row.started_at as Date).getTime() - (b.row.started_at as Date).getTime())
      .slice(0, Math.floor(entries.length / 2));

    if (billed.length === 0) {
      return;
    }

    const hours = roundMoney(billed.reduce((sum, entry) => sum + entry.minutes, 0) / 60);
    const invoice = this.addInvoice({
      customer,
      projectId,
      status: random.pick(['paid', 'issued', 'partially_paid'] as const),
      issuedAt: random.daysAgo(random.int(3, 25)),
      lines: [{ description: `Consulting services (${hours} h)`, quantity: hours, unitPriceNet: hourlyRate }],
    });

    for (const entry of billed) {
      entry.row.invoice_id = invoice.id;
      entry.row.billed_at = invoice.issuedAt;
    }
  }
}

function toLineInputs(lines: LineInput[]): LineInput[] {
  return lines.map(({ description, quantity, unitPriceNet, taxCategory }) => ({
    description,
    quantity,
    unitPriceNet,
    taxCategory,
  }));
}
