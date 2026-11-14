import { InvoiceStatus } from '../constants/invoice-status.constants';
import { BillingIntervalType } from '../entities/service-plan.entity';

import {
  CONFIG_CHANGE_ADJUSTMENT_KINDS,
  CONFIG_CHANGE_CREDIT_REASON,
  SubscriptionConfigChangeBillingService,
} from './subscription-config-change-billing.service';

const DAY_MS = 24 * 60 * 60 * 1000;
const CHANGED_AT = new Date('2026-03-15T12:00:00.000Z');
const PERIOD_START = new Date(CHANGED_AT.getTime() - 5 * DAY_MS);
const PERIOD_END = new Date(CHANGED_AT.getTime() + 5 * DAY_MS);

/** Ten-day cycles keep proration exact: five elapsed days are always half a period. */
function buildPlan(billInAdvance: boolean) {
  return {
    id: 'plan-1',
    name: 'Pro',
    billInAdvance,
    billingIntervalType: BillingIntervalType.DAY,
    billingIntervalValue: 10,
    billingDayOfMonth: undefined,
  };
}

function buildChange(
  overrides: { currentPeriodNet?: number; periodDeltaNet?: number; immediateAdjustmentNet?: number } = {},
) {
  const currentPeriodNet = overrides.currentPeriodNet ?? 100;
  const periodDeltaNet = overrides.periodDeltaNet ?? 0;

  return {
    id: 'change-1',
    subscriptionId: 'sub-1',
    billingDisclaimerSnapshot: {
      currentPeriodNet,
      newPeriodNet: currentPeriodNet + periodDeltaNet,
      periodDeltaNet,
      immediateAdjustmentNet: overrides.immediateAdjustmentNet ?? 0,
      currency: 'EUR',
      effectiveAt: CHANGED_AT.toISOString(),
      notes: [],
    },
  };
}

describe('SubscriptionConfigChangeBillingService', () => {
  const openPositionsRepository = {
    create: jest.fn(),
    createUniqueBySourceRef: jest.fn(),
    findBySourceRef: jest.fn(),
    hasUnbilledPeriodChargeForSubscription: jest.fn(),
    findUnbilledBySubscription: jest.fn(),
    findConfigChangeAdjustment: jest.fn(),
  };
  const subscriptionsRepository = { update: jest.fn() };
  const invoicesRepository = {
    findLatestBySubscription: jest.fn(),
    findLatestBillableBySubscription: jest.fn(),
    update: jest.fn(),
    findByIdForUpdate: jest.fn(),
  };
  const invoiceCreditDocumentsRepository = {
    create: jest.fn(),
    createUniqueBySourceRef: jest.fn(),
    findBySourceRef: jest.fn(),
    findConfigChangeCredit: jest.fn(),
    findByIdForUpdate: jest.fn(),
    markSettlementComplete: jest.fn(),
  };
  const customerProfilesRepository = { findByUserId: jest.fn() };
  const taxCalculationService = {
    computeLines: jest.fn((lines: { quantity: number; unitPriceNet: number }[]) => ({
      totalGross: Math.round(lines.reduce((sum, line) => sum + line.quantity * line.unitPriceNet, 0) * 100) / 100,
    })),
  };
  const invoiceTaxContextService = { resolveForUser: jest.fn() };
  const promotionApplicationService = { calculatePromotions: jest.fn() };
  const billingIssuerConfig = { getConfig: jest.fn() };
  const invoicePdfService = { generatePartialCreditDocumentAndStore: jest.fn() };
  const billingEmailPublisher = { publishPartialCreditDocument: jest.fn() };
  const auditLog = { log: jest.fn() };
  const billingNotificationPublisher = { publishInvoice: jest.fn() };
  const managerInvoiceSave = jest.fn(async (entity: unknown) => entity);
  const managerMock = {
    getRepository: jest.fn(() => ({
      save: managerInvoiceSave,
    })),
  };
  const dataSource = {
    transaction: jest.fn(async (callback: (manager: typeof managerMock) => Promise<unknown>) => callback(managerMock)),
  };
  const service = new SubscriptionConfigChangeBillingService(
    openPositionsRepository as never,
    subscriptionsRepository as never,
    invoicesRepository as never,
    invoiceCreditDocumentsRepository as never,
    customerProfilesRepository as never,
    taxCalculationService as never,
    invoiceTaxContextService as never,
    promotionApplicationService as never,
    billingIssuerConfig as never,
    invoicePdfService as never,
    billingEmailPublisher as never,
    auditLog as never,
    dataSource as never,
    billingNotificationPublisher as never,
  );
  const subscription = {
    id: 'sub-1',
    number: 'SUB-1',
    userId: 'user-1',
    planId: 'plan-1',
    currentPeriodStart: PERIOD_START,
    currentPeriodEnd: PERIOD_END,
    createdAt: PERIOD_START,
  };

  beforeEach(() => {
    jest.clearAllMocks();

    openPositionsRepository.findUnbilledBySubscription.mockResolvedValue([]);
    openPositionsRepository.findConfigChangeAdjustment.mockResolvedValue(null);
    openPositionsRepository.findBySourceRef.mockResolvedValue(null);
    openPositionsRepository.hasUnbilledPeriodChargeForSubscription.mockResolvedValue(false);
    openPositionsRepository.createUniqueBySourceRef.mockImplementation(async (dto) => ({
      entity: { id: 'pos-new', ...dto },
      created: true,
    }));
    invoiceCreditDocumentsRepository.findConfigChangeCredit.mockResolvedValue(null);
    invoiceCreditDocumentsRepository.findBySourceRef.mockResolvedValue(null);
    invoiceCreditDocumentsRepository.createUniqueBySourceRef.mockImplementation(async (dto) => ({
      entity: { id: 'credit-new', ...dto },
      created: true,
    }));
    invoicesRepository.findLatestBySubscription.mockResolvedValue(null);
    invoicesRepository.findLatestBillableBySubscription.mockResolvedValue(null);
    invoiceTaxContextService.resolveForUser.mockResolvedValue({
      treatment: undefined,
      forceChargeNonEuIssuerEuB2b: false,
    });
    promotionApplicationService.calculatePromotions.mockResolvedValue({
      rawSubtotalNet: 100,
      adjustedSubtotalNet: 100,
      discountLines: [],
      applications: [],
      redemptionUpdates: [],
    });
    customerProfilesRepository.findByUserId.mockResolvedValue({ firstName: 'Ada', email: 'ada@example.com' });
    billingIssuerConfig.getConfig.mockReturnValue({ name: 'Issuer' });
    invoicePdfService.generatePartialCreditDocumentAndStore.mockResolvedValue({
      storageKey: 'credits/doc.pdf',
      documentNumber: 'INV-1-C1',
    });
    invoiceCreditDocumentsRepository.findByIdForUpdate.mockImplementation(async (_id, _manager) => ({
      id: 'credit-new',
      invoiceId: 'inv-1',
      creditNet: 10,
      creditGross: 10,
      settlementComplete: false,
    }));
    invoicesRepository.findByIdForUpdate.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-1',
      balanceDue: '30.00',
      currency: 'EUR',
      createdAt: PERIOD_START,
      issuedAt: PERIOD_START,
    });
  });

  it('bills the elapsed part of a post-usage period at the old price and moves the anchor', async () => {
    const outcome = await service.apply({
      subscription: subscription as never,
      plan: buildPlan(false) as never,
      change: buildChange({ currentPeriodNet: 100, immediateAdjustmentNet: 50 }) as never,
      changedAt: CHANGED_AT,
    });

    expect(outcome).toBe('charged');
    expect(openPositionsRepository.createUniqueBySourceRef).toHaveBeenCalledWith(
      expect.objectContaining({
        subscriptionId: 'sub-1',
        userId: 'user-1',
        adjustmentNet: '50.0000',
        adjustmentKind: CONFIG_CHANGE_ADJUSTMENT_KINDS.ARREAR,
        billUntil: CHANGED_AT,
        sourceRef: 'config_change:change-1',
      }),
    );
    expect(subscriptionsRepository.update).toHaveBeenCalledWith('sub-1', { currentPeriodStart: CHANGED_AT });
  });

  it('credits the elapsed share of the delta when the advance period is not invoiced yet', async () => {
    openPositionsRepository.hasUnbilledPeriodChargeForSubscription.mockResolvedValue(true);

    const outcome = await service.apply({
      subscription: subscription as never,
      plan: buildPlan(true) as never,
      change: buildChange({
        currentPeriodNet: 100,
        periodDeltaNet: 20,
        immediateAdjustmentNet: -10,
      }) as never,
      changedAt: CHANGED_AT,
    });

    expect(outcome).toBe('credited');
    expect(openPositionsRepository.createUniqueBySourceRef).toHaveBeenCalledWith(
      expect.objectContaining({
        adjustmentNet: '-10.0000',
        adjustmentKind: CONFIG_CHANGE_ADJUSTMENT_KINDS.CREDIT,
        sourceRef: 'config_change:change-1',
      }),
    );
    expect(subscriptionsRepository.update).not.toHaveBeenCalled();
  });

  it('reports no billing outcome when the adjustment rounds away', async () => {
    const outcome = await service.apply({
      subscription: subscription as never,
      plan: buildPlan(false) as never,
      change: buildChange({ currentPeriodNet: 0, immediateAdjustmentNet: 0 }) as never,
      changedAt: CHANGED_AT,
    });

    expect(outcome).toBe('none');
    expect(openPositionsRepository.createUniqueBySourceRef).not.toHaveBeenCalled();
    expect(subscriptionsRepository.update).toHaveBeenCalledWith('sub-1', { currentPeriodStart: CHANGED_AT });
  });

  it('issues a partial credit document when the advance period was already invoiced', async () => {
    openPositionsRepository.hasUnbilledPeriodChargeForSubscription.mockResolvedValue(false);
    invoicesRepository.findLatestBillableBySubscription.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-1',
      balanceDue: '30.00',
      currency: 'EUR',
      createdAt: PERIOD_START,
      issuedAt: PERIOD_START,
    });

    const outcome = await service.apply({
      subscription: subscription as never,
      plan: buildPlan(true) as never,
      change: buildChange({
        currentPeriodNet: 100,
        periodDeltaNet: -20,
        immediateAdjustmentNet: -10,
      }) as never,
      changedAt: CHANGED_AT,
    });

    expect(outcome).toBe('credited');
    expect(invoiceCreditDocumentsRepository.createUniqueBySourceRef).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: 'inv-1',
        creditNet: 10,
        creditGross: 10,
        reason: CONFIG_CHANGE_CREDIT_REASON,
        description: expect.stringContaining('change-1'),
        sourceRef: 'config_change:change-1',
      }),
    );
    expect(dataSource.transaction).toHaveBeenCalled();
    expect(invoiceCreditDocumentsRepository.markSettlementComplete).toHaveBeenCalledWith('credit-new', managerMock);
    expect(managerInvoiceSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv-1', balanceDue: 20 }));
    expect(billingEmailPublisher.publishPartialCreditDocument).toHaveBeenCalled();
    expect(openPositionsRepository.createUniqueBySourceRef).not.toHaveBeenCalled();
    // Balance remains open: no settlement webhook.
    expect(billingNotificationPublisher.publishInvoice).not.toHaveBeenCalled();
  });

  it('publishes invoice.paid after commit when the partial credit settles the remaining balance', async () => {
    openPositionsRepository.hasUnbilledPeriodChargeForSubscription.mockResolvedValue(false);
    invoicesRepository.findLatestBillableBySubscription.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-1',
      balanceDue: '10.00',
      currency: 'EUR',
      createdAt: PERIOD_START,
      issuedAt: PERIOD_START,
    });
    invoicesRepository.findByIdForUpdate.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-1',
      status: InvoiceStatus.ISSUED,
      balanceDue: '10.00',
      currency: 'EUR',
      createdAt: PERIOD_START,
      issuedAt: PERIOD_START,
    });

    let committed = false;

    dataSource.transaction.mockImplementationOnce(async (callback) => {
      const result = await callback(managerMock);

      expect(billingNotificationPublisher.publishInvoice).not.toHaveBeenCalled();
      committed = true;

      return result;
    });

    await service.apply({
      subscription: subscription as never,
      plan: buildPlan(true) as never,
      change: buildChange({
        currentPeriodNet: 100,
        periodDeltaNet: -20,
        immediateAdjustmentNet: -10,
      }) as never,
      changedAt: CHANGED_AT,
    });

    expect(committed).toBe(true);
    expect(billingNotificationPublisher.publishInvoice).toHaveBeenCalledWith(
      'invoice.paid',
      expect.objectContaining({ id: 'inv-1', status: InvoiceStatus.PAID, balanceDue: 0 }),
    );
  });

  it('skips re-settlement when a billed open position already marks the change', async () => {
    openPositionsRepository.findBySourceRef.mockImplementation(async (sourceRef: string) => {
      if (sourceRef === 'config_change:change-1') {
        return {
          id: 'pos-1',
          subscriptionId: 'sub-1',
          adjustmentNet: '50.0000',
          adjustmentKind: CONFIG_CHANGE_ADJUSTMENT_KINDS.ARREAR,
          invoiceRefId: 'inv-old',
          description: 'Configuration change change-1 (SUB-1)',
        };
      }

      return null;
    });

    const outcome = await service.apply({
      subscription: subscription as never,
      plan: buildPlan(false) as never,
      change: buildChange({ currentPeriodNet: 100 }) as never,
      changedAt: CHANGED_AT,
    });

    expect(outcome).toBe('charged');
    expect(openPositionsRepository.createUniqueBySourceRef).not.toHaveBeenCalled();
    expect(subscriptionsRepository.update).toHaveBeenCalledWith('sub-1', { currentPeriodStart: CHANGED_AT });
  });

  it('skips re-settlement when a config-change credit document is already fully settled', async () => {
    invoiceCreditDocumentsRepository.findBySourceRef.mockResolvedValue({
      id: 'credit-1',
      reason: CONFIG_CHANGE_CREDIT_REASON,
      description: 'Configuration change change-1 credit (SUB-1)',
      settlementComplete: true,
    });

    const outcome = await service.apply({
      subscription: subscription as never,
      plan: buildPlan(true) as never,
      change: buildChange({ currentPeriodNet: 100, periodDeltaNet: -20, immediateAdjustmentNet: -10 }) as never,
      changedAt: CHANGED_AT,
    });

    expect(outcome).toBe('credited');
    expect(invoiceCreditDocumentsRepository.createUniqueBySourceRef).not.toHaveBeenCalled();
    expect(invoiceCreditDocumentsRepository.findByIdForUpdate).not.toHaveBeenCalled();
    expect(invoiceCreditDocumentsRepository.markSettlementComplete).not.toHaveBeenCalled();
    expect(openPositionsRepository.createUniqueBySourceRef).not.toHaveBeenCalled();
  });

  it('finishes settlement when an existing credit document is not yet settled', async () => {
    invoiceCreditDocumentsRepository.findBySourceRef.mockResolvedValue({
      id: 'credit-1',
      invoiceId: 'inv-1',
      creditNet: 10,
      creditGross: 10,
      reason: CONFIG_CHANGE_CREDIT_REASON,
      description: 'Configuration change change-1 credit (SUB-1)',
      settlementComplete: false,
    });
    invoiceCreditDocumentsRepository.findByIdForUpdate.mockResolvedValue({
      id: 'credit-1',
      invoiceId: 'inv-1',
      creditNet: 10,
      creditGross: 10,
      settlementComplete: false,
    });

    const outcome = await service.apply({
      subscription: subscription as never,
      plan: buildPlan(true) as never,
      change: buildChange({ currentPeriodNet: 100, periodDeltaNet: -20, immediateAdjustmentNet: -10 }) as never,
      changedAt: CHANGED_AT,
    });

    expect(outcome).toBe('credited');
    expect(invoiceCreditDocumentsRepository.createUniqueBySourceRef).not.toHaveBeenCalled();
    expect(invoiceCreditDocumentsRepository.markSettlementComplete).toHaveBeenCalledWith('credit-1', managerMock);
    expect(managerInvoiceSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv-1', balanceDue: 20 }));
    expect(billingEmailPublisher.publishPartialCreditDocument).not.toHaveBeenCalled();
  });

  it('finalizes settlement when createUniqueBySourceRef reports an existing credit document', async () => {
    openPositionsRepository.hasUnbilledPeriodChargeForSubscription.mockResolvedValue(false);
    invoicesRepository.findLatestBillableBySubscription.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-1',
      balanceDue: '30.00',
      currency: 'EUR',
      createdAt: PERIOD_START,
      issuedAt: PERIOD_START,
    });
    invoiceCreditDocumentsRepository.createUniqueBySourceRef.mockResolvedValue({
      entity: {
        id: 'credit-existing',
        invoiceId: 'inv-1',
        creditNet: 10,
        creditGross: 10,
        settlementComplete: false,
      },
      created: false,
    });
    invoiceCreditDocumentsRepository.findByIdForUpdate.mockResolvedValue({
      id: 'credit-existing',
      invoiceId: 'inv-1',
      creditNet: 10,
      creditGross: 10,
      settlementComplete: false,
    });

    const outcome = await service.apply({
      subscription: subscription as never,
      plan: buildPlan(true) as never,
      change: buildChange({ currentPeriodNet: 100, periodDeltaNet: -20, immediateAdjustmentNet: -10 }) as never,
      changedAt: CHANGED_AT,
    });

    expect(outcome).toBe('credited');
    expect(billingEmailPublisher.publishPartialCreditDocument).not.toHaveBeenCalled();
    expect(invoiceCreditDocumentsRepository.markSettlementComplete).toHaveBeenCalledWith(
      'credit-existing',
      managerMock,
    );
    expect(managerInvoiceSave).toHaveBeenCalledWith(expect.objectContaining({ id: 'inv-1', balanceDue: 20 }));
  });

  it('caps the credit at what the customer pays after promotions', async () => {
    openPositionsRepository.hasUnbilledPeriodChargeForSubscription.mockResolvedValue(false);
    promotionApplicationService.calculatePromotions.mockResolvedValue({
      rawSubtotalNet: 100,
      adjustedSubtotalNet: 50,
      discountLines: [],
      applications: [],
      redemptionUpdates: [],
    });
    invoicesRepository.findLatestBillableBySubscription.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-1',
      balanceDue: '30.00',
      currency: 'EUR',
      createdAt: PERIOD_START,
      issuedAt: PERIOD_START,
    });

    await service.apply({
      subscription: subscription as never,
      plan: buildPlan(true) as never,
      change: buildChange({ currentPeriodNet: 100, periodDeltaNet: -20, immediateAdjustmentNet: -10 }) as never,
      changedAt: CHANGED_AT,
    });

    expect(invoiceCreditDocumentsRepository.createUniqueBySourceRef).toHaveBeenCalledWith(
      expect.objectContaining({ creditNet: 5, creditGross: 5 }),
    );
  });

  it('charges the frozen remaining delta when the advance period was already invoiced', async () => {
    openPositionsRepository.hasUnbilledPeriodChargeForSubscription.mockResolvedValue(false);

    const outcome = await service.apply({
      subscription: subscription as never,
      plan: buildPlan(true) as never,
      change: buildChange({
        currentPeriodNet: 100,
        periodDeltaNet: 20,
        immediateAdjustmentNet: 10,
      }) as never,
      changedAt: CHANGED_AT,
    });

    expect(outcome).toBe('charged');
    expect(openPositionsRepository.createUniqueBySourceRef).toHaveBeenCalledWith(
      expect.objectContaining({
        adjustmentNet: '10.0000',
        adjustmentKind: CONFIG_CHANGE_ADJUSTMENT_KINDS.CHARGE,
      }),
    );
  });

  it('issues a partial credit when the period is invoiced even if an unrelated adjustment OP is open', async () => {
    // Period charge already billed; leftover adjustment OP alone must not take the OP-credit path.
    openPositionsRepository.hasUnbilledPeriodChargeForSubscription.mockResolvedValue(false);
    invoicesRepository.findLatestBillableBySubscription.mockResolvedValue({
      id: 'inv-1',
      invoiceNumber: 'INV-1',
      balanceDue: '30.00',
      currency: 'EUR',
      createdAt: PERIOD_START,
      issuedAt: PERIOD_START,
      // Accumulated invoices may stamp a different subscription_id; resolution is the repository's job.
      subscriptionId: 'sub-other',
    });

    const outcome = await service.apply({
      subscription: subscription as never,
      plan: buildPlan(true) as never,
      change: buildChange({
        currentPeriodNet: 100,
        periodDeltaNet: -20,
        immediateAdjustmentNet: -10,
      }) as never,
      changedAt: CHANGED_AT,
    });

    expect(outcome).toBe('credited');
    expect(invoiceCreditDocumentsRepository.createUniqueBySourceRef).toHaveBeenCalledWith(
      expect.objectContaining({
        invoiceId: 'inv-1',
        creditNet: 10,
        reason: CONFIG_CHANGE_CREDIT_REASON,
        sourceRef: 'config_change:change-1',
      }),
    );
    expect(openPositionsRepository.createUniqueBySourceRef).not.toHaveBeenCalled();
  });

  it('skips billing when the accepted disclaimer snapshot is missing', async () => {
    const outcome = await service.apply({
      subscription: subscription as never,
      plan: buildPlan(false) as never,
      change: { id: 'change-1', subscriptionId: 'sub-1' } as never,
      changedAt: CHANGED_AT,
    });

    expect(outcome).toBe('none');
    expect(openPositionsRepository.createUniqueBySourceRef).not.toHaveBeenCalled();
    expect(subscriptionsRepository.update).not.toHaveBeenCalled();
  });
});
