import { DatePipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  AdminBillingFacade,
  AdminBillingService,
  AdminInvoiceManagerFacade,
  AdminSupplierInvoiceManagerFacade,
  AdminSupplierInvoicesService,
  AdminSupplierProfilesService,
  BillingCapabilitiesFacade,
  InvoicesFacade,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { AuthenticationFacade } from '@forepath/identity/frontend';
import { of, throwError } from 'rxjs';

import { AdminBillingPageComponent } from './admin-billing-page.component';

jest.mock('../billing-country-options', () => ({
  BILLING_COUNTRY_OPTIONS: [],
  DEFAULT_BILLING_COUNTRY_CODE: 'DE',
  getCountryDisplayName: (code: string) => code,
}));
jest.mock('ng-apexcharts', () => {
  const { NgModule } = jest.requireActual('@angular/core');

  @NgModule({})
  class NgApexchartsModule {}

  return { NgApexchartsModule };
});

/** Facade / service stub: unknown members are spies returning `of([])` that can also be subscribed to. */
function stub(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return new Proxy(overrides, {
    get: (target, key) => {
      if (typeof key !== 'string' || key === 'then') return undefined;

      if (!(key in target)) {
        const fn = jest.fn(() => of([]));

        Object.assign(fn, {
          subscribe: (...args: unknown[]) => (of([]).subscribe as (...a: unknown[]) => unknown)(...args),
          pipe: (...ops: unknown[]) => (of([]).pipe as (...o: unknown[]) => unknown)(...ops),
        });
        target[key] = fn;
      }

      return target[key];
    },
  });
}

const invoice = (id: string, status: string) => ({ id, invoiceNumber: `INV-${id}`, status });

describe('AdminBillingPageComponent (bulk actions)', () => {
  let billingService: Record<string, jest.Mock>;
  let supplierService: Record<string, jest.Mock>;
  let billingFacade: Record<string, unknown>;
  let component: AdminBillingPageComponent;

  beforeEach(() => {
    billingService = { markPaid: jest.fn(), voidInvoice: jest.fn(), deleteManualInvoice: jest.fn() };
    supplierService = { markPaid: jest.fn(), delete: jest.fn(), listAuditLogs: jest.fn() };
    billingFacade = stub({ loadAuditLogs: jest.fn(), auditLogsTotalByInvoice$: of({ i1: 60 }) });
    TestBed.configureTestingModule({
      providers: [
        DatePipe,
        { provide: AdminBillingService, useValue: stub(billingService) },
        { provide: AdminSupplierInvoicesService, useValue: stub(supplierService) },
        { provide: AdminSupplierProfilesService, useValue: stub() },
        { provide: AdminBillingFacade, useValue: billingFacade },
        {
          provide: AdminInvoiceManagerFacade,
          useValue: stub({
            invoices$: of([
              invoice('d1', 'draft'),
              invoice('d2', 'draft'),
              invoice('i1', 'issued'),
              invoice('i2', 'overdue'),
              invoice('p1', 'paid'),
            ]),
            total$: of(5),
            error$: of(null),
          }),
        },
        {
          provide: AdminSupplierInvoiceManagerFacade,
          useValue: stub({
            invoices$: of([invoice('sd1', 'draft'), invoice('si1', 'issued'), invoice('si2', 'issued')]),
            total$: of(3),
            error$: of(null),
          }),
        },
        { provide: InvoicesFacade, useValue: stub() },
        { provide: BillingCapabilitiesFacade, useValue: stub({ accountingEnabled$: of(true) }) },
        { provide: AuthenticationFacade, useValue: stub({ users$: of([]) }) },
      ],
    });
    component = TestBed.runInInjectionContext(() => new AdminBillingPageComponent());
  });

  it('customer invoices: bulk Mark paid only hits payable invoices, per-item results incl. denied', async () => {
    billingService['markPaid'].mockImplementation((id: string) =>
      id === 'i2' ? throwError(() => ({ status: 403 })) : of({}),
    );
    component.selectedInvoices.set(['d1', 'i1', 'i2', 'p1']);

    await component.runInvoiceBulk('markPaid');

    expect(billingService['markPaid']).toHaveBeenCalledTimes(2);
    expect(billingService['markPaid']).toHaveBeenCalledWith('i1', {});
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(component.selectedInvoices()).toEqual([]);
  });

  it('customer invoices: bulk Void (after confirm) voids issued / overdue only, incl. a denied one', async () => {
    billingService['voidInvoice'].mockImplementation((id: string) =>
      id === 'i1' ? throwError(() => ({ status: 403 })) : of({}),
    );
    component.selectedInvoices.set(['d1', 'i1', 'i2', 'p1']);
    component.openBulkConfirm('void');
    expect(component.bulkConfirmMessage()).toContain('2 selected invoices');
    expect(component.bulkVoidNotifyCustomer).toBe(true);
    component.bulkVoidNotifyCustomer = false;

    await component.runInvoiceBulk('void');

    expect(billingService['voidInvoice']).toHaveBeenCalledTimes(2);
    expect(billingService['voidInvoice']).toHaveBeenCalledWith('i2', { notifyCustomer: false });
    expect(billingService['voidInvoice']).not.toHaveBeenCalledWith('p1');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
  });

  it('customer invoices: bulk Delete drafts deletes drafts only, incl. a denied one', async () => {
    billingService['deleteManualInvoice'].mockImplementation((id: string) =>
      id === 'd2' ? throwError(() => ({ status: 403 })) : of(undefined),
    );
    component.selectedInvoices.set(['d1', 'd2', 'i1']);

    await component.runInvoiceBulk('delete');

    expect(billingService['deleteManualInvoice']).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
  });

  it('supplier invoices: bulk Mark paid / Delete drafts fan out per invoice, incl. a denied one', async () => {
    supplierService['markPaid'].mockImplementation((id: string) =>
      id === 'si2' ? throwError(() => ({ status: 403 })) : of({}),
    );
    component.selectedSupplierInvoices.set(['sd1', 'si1', 'si2']);
    await component.runSupplierBulk('markPaid');
    expect(supplierService['markPaid']).toHaveBeenCalledTimes(2);
    expect(component.bulkResult()?.message).toContain('1 not allowed');

    supplierService['delete'].mockImplementation(() => throwError(() => ({ status: 403 })));
    component.selectedSupplierInvoices.set(['sd1', 'si1']);
    await component.runSupplierBulk('delete');
    expect(supplierService['delete']).toHaveBeenCalledTimes(1);
    expect(supplierService['delete']).toHaveBeenCalledWith('sd1');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
  });

  it('void confirm: sends the trimmed credit note note, none when blank', () => {
    const managerFacade = TestBed.inject(AdminInvoiceManagerFacade) as unknown as Record<string, jest.Mock>;
    const issued = invoice('i1', 'issued') as never;

    component.openActionModal('void', issued);
    component.actionNote.set('  Cancelled on request  ');
    component.confirmAction();
    expect(managerFacade['voidInvoice']).toHaveBeenLastCalledWith('i1', {
      note: 'Cancelled on request',
      notifyCustomer: false,
    });

    component.openActionModal('void', issued);
    expect(component.actionNote()).toBe('');
    component.actionNote.set('   ');
    component.confirmAction();
    expect(managerFacade['voidInvoice']).toHaveBeenLastCalledWith('i1', { notifyCustomer: false });
  });

  it('void confirm: emails the credit note by default only when the invoice itself was sent', () => {
    const managerFacade = TestBed.inject(AdminInvoiceManagerFacade) as unknown as Record<string, jest.Mock>;
    const sent = { ...invoice('i1', 'issued'), sentAt: '2026-11-01T00:00:00Z' } as never;

    component.openActionModal('void', sent);
    expect(component.actionNotifyCustomer()).toBe(true);
    component.confirmAction();
    expect(managerFacade['voidInvoice']).toHaveBeenLastCalledWith('i1', { notifyCustomer: true });

    component.openActionModal('void', sent);
    component.actionNotifyCustomer.set(false);
    component.confirmAction();
    expect(managerFacade['voidInvoice']).toHaveBeenLastCalledWith('i1', { notifyCustomer: false });
  });

  it('send actions: offered for unsent documents only, confirmed through the action modal', () => {
    const managerFacade = TestBed.inject(AdminInvoiceManagerFacade) as unknown as Record<string, jest.Mock>;
    const unsent = { ...invoice('i1', 'issued'), canSend: true } as never;
    const voided = { ...invoice('v1', 'void'), canSendCreditNote: true } as never;
    const ids = (inv: never) => component.invoiceMenu(inv).map((item) => item.id);

    expect(ids(unsent)).toContain('send');
    expect(ids(invoice('i2', 'issued') as never)).not.toContain('send');
    expect(ids(voided)).toContain('send-credit-note');
    expect(component.invoiceColumns[0].state?.(unsent)?.label).toContain('not sent');
    expect(component.invoiceColumns[0].state?.(invoice('i2', 'issued') as never)?.label).not.toContain('not sent');

    component.onInvoiceAction(unsent, 'send');
    expect(component.pendingAction()).toBe('send');
    expect(component.actionConfirmLabel()).toBe('Send to customer');
    component.confirmAction();
    expect(managerFacade['sendInvoice']).toHaveBeenCalledWith('i1');

    component.onInvoiceAction(voided, 'send-credit-note');
    expect(component.actionConfirmLabel()).toBe('Send credit note');
    component.confirmAction();
    expect(managerFacade['sendCreditNote']).toHaveBeenCalledWith('v1');
  });

  it('issue dialog: emails the invoice by default, silently when unchecked', () => {
    const managerFacade = TestBed.inject(AdminInvoiceManagerFacade) as unknown as Record<string, jest.Mock>;

    component.openIssueModal(invoice('d1', 'draft') as never);
    expect(component.issueNotifyCustomer).toBe(true);
    component.issueNotifyCustomer = false;
    component.submitIssue();

    expect(managerFacade['issueManualInvoice']).toHaveBeenLastCalledWith(
      'd1',
      expect.objectContaining({ notifyCustomer: false }),
    );

    component.openIssueModal(invoice('d1', 'draft') as never);
    expect(component.issueNotifyCustomer).toBe(true);
  });

  it('manual invoice: create and edit submit the note (null when blank)', () => {
    const managerFacade = TestBed.inject(AdminInvoiceManagerFacade) as unknown as Record<string, jest.Mock>;
    const line = {
      description: 'Consulting',
      quantity: 1,
      unitPriceNet: 100,
      taxCategory: 'standard' as const,
      positionType: 'standard' as const,
    };

    component.createInvoiceType = 'customer';
    component.createUserId = 'u1';
    component.createLineItems = [line];
    component.createNote = '  Phase 1 \n Thanks ';
    component.submitCreate();
    expect(managerFacade['createManualInvoice']).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'u1', note: 'Phase 1 \n Thanks' }),
    );

    component.editInvoiceId = 'd1';
    component.editLineItems = [line];
    component.editNote = '  ';
    component.submitEdit();
    expect(managerFacade['updateManualInvoice']).toHaveBeenCalledWith('d1', expect.objectContaining({ note: null }));
  });

  it('manual invoice: article positions need an article, prefill price / VAT (keeping text) and send the id', () => {
    const managerFacade = TestBed.inject(AdminInvoiceManagerFacade) as unknown as Record<string, jest.Mock>;
    const standard = {
      description: 'Consulting',
      quantity: 1,
      unitPriceNet: 100,
      taxCategory: 'standard' as const,
      positionType: 'standard' as const,
      inventoryArticleId: null,
    };
    const article = {
      description: 'Box',
      quantity: 2,
      unitPriceNet: 0,
      taxCategory: 'standard' as 'standard' | 'reduced' | 'custom',
      positionType: 'standard' as 'standard' | 'article',
      inventoryArticleId: null as string | null,
    };

    component.onPositionTypeChange(article, 'article');
    component.createInvoiceType = 'customer';
    component.createUserId = 'u1';
    component.createLineItems = [standard, article];
    component.submitCreate();
    expect(managerFacade['createManualInvoice']).not.toHaveBeenCalled();

    article.inventoryArticleId = 'art-1';
    component.onPositionArticlePicked(article, {
      name: 'Router',
      unit: 'piece',
      salesPriceNet: 49.9,
      taxCategory: 'reduced',
    } as never);
    expect(article).toEqual(
      expect.objectContaining({ description: 'Box', unitPriceNet: 49.9, taxCategory: 'reduced' }),
    );

    component.submitCreate();
    expect(managerFacade['createManualInvoice']).toHaveBeenCalledWith(
      expect.objectContaining({
        lineItems: [
          { description: 'Consulting', quantity: 1, unitPriceNet: 100, taxCategory: 'standard' },
          { description: 'Box', quantity: 2, unitPriceNet: 49.9, taxCategory: 'reduced', inventoryArticleId: 'art-1' },
        ],
      }),
    );

    component.onPositionTypeChange(article, 'standard');
    expect(article.inventoryArticleId).toBeNull();
  });

  it('manual invoice: editing a draft restores article positions', () => {
    const service = TestBed.inject(AdminBillingService) as unknown as Record<string, jest.Mock>;

    service['getManualInvoiceDetail'] = jest.fn(() =>
      of({
        lineItems: [
          { description: 'Fee', quantity: 1, unitPriceNet: 5, taxCategory: 'standard', inventoryArticleId: null },
          { description: 'Router', quantity: 2, unitPriceNet: 49.9, taxCategory: 'reduced', inventoryArticleId: 'a1' },
        ],
        note: null,
      }),
    );
    component.openEditModal({ id: 'd1', userId: 'u1' } as never);

    expect(component.editLineItems.map((line) => [line.positionType, line.inventoryArticleId])).toEqual([
      ['standard', null],
      ['article', 'a1'],
    ]);
  });

  it('audit history: loads page 1 on open, then the requested page / size (replace-page, server total)', () => {
    component.openAuditHistory(invoice('i1', 'issued') as never);
    TestBed.tick();
    expect(billingFacade['loadAuditLogs']).toHaveBeenLastCalledWith('i1', 1, 25);
    expect(component.auditLogsTotal()).toBe(60);

    component.auditPage.set(3);
    component.auditPageSize.set(50);
    TestBed.tick();
    expect(billingFacade['loadAuditLogs']).toHaveBeenLastCalledWith('i1', 3, 50);

    // Reopening starts on page 1 again.
    component.openAuditHistory(invoice('i1', 'issued') as never);
    TestBed.tick();
    expect(billingFacade['loadAuditLogs']).toHaveBeenLastCalledWith('i1', 1, 50);
  });

  it('supplier audit history: requests limit / offset per page and keeps the total', () => {
    supplierService['listAuditLogs'].mockReturnValue(
      of({ items: [{ id: 'log-1' }], total: 30, limit: 25, offset: 25 }),
    );
    component.openSupplierAuditHistory(invoice('si1', 'issued') as never);
    TestBed.tick();
    expect(supplierService['listAuditLogs']).toHaveBeenLastCalledWith('si1', 25, 0);

    component.auditPage.set(2);
    TestBed.tick();
    expect(supplierService['listAuditLogs']).toHaveBeenLastCalledWith('si1', 25, 25);
    expect(component.selectedAuditLogs()).toEqual([{ id: 'log-1' }]);
    expect(component.auditLogsTotal()).toBe(30);
    expect(billingFacade['loadAuditLogs']).not.toHaveBeenCalled();
  });

  it('preview modal: Download is offered for the previewed customer / supplier invoice when a PDF is stored', () => {
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:x'), revokeObjectURL: jest.fn() });
    billingService['getManualInvoiceDetail'] = jest.fn(() => of({ id: 'i1', lineItems: [], taxBreakdown: [] }));
    billingService['downloadInvoicePdf'] = jest.fn(() => of(new Blob(['%PDF'])));
    supplierService['getById'] = jest.fn(() => of({ id: 'si1', lineItems: [] }));
    supplierService['downloadDocument'] = jest.fn(() => of(new Blob(['%PDF'])));

    component.openPreview({ ...invoice('i1', 'issued'), canDownload: true } as never);
    component.previewDownload()?.();
    expect(billingService['downloadInvoicePdf']).toHaveBeenCalledWith('i1');

    component.openPreview({ ...invoice('i2', 'issued'), canDownload: false } as never);
    expect(component.previewDownload()).toBeNull();

    component.openSupplierPreview({ ...invoice('si1', 'issued'), canDownload: true } as never);
    component.previewDownload()?.();
    expect(supplierService['downloadDocument']).toHaveBeenCalledWith('si1');
    expect(click).toHaveBeenCalledTimes(2);
    click.mockRestore();
  });

  it('mark paid: sends a partial amount only when entered and blocks amounts above the balance', () => {
    const managerFacade = TestBed.inject(AdminInvoiceManagerFacade) as unknown as Record<string, jest.Mock>;
    const issued = { ...invoice('i1', 'issued'), balance: 100 } as never;

    component.openActionModal('markPaid', issued);
    component.confirmAction();
    const fullPayment = managerFacade['markPaid'].mock.calls[managerFacade['markPaid'].mock.calls.length - 1];

    expect(fullPayment[0]).toBe('i1');
    expect(fullPayment[1]).not.toHaveProperty('amount');

    component.openActionModal('markPaid', issued);
    component.actionAmount.set(40);
    component.confirmAction();
    expect(managerFacade['markPaid']).toHaveBeenLastCalledWith('i1', expect.objectContaining({ amount: 40 }));

    const calls = managerFacade['markPaid'].mock.calls.length;

    component.openActionModal('markPaid', issued);
    component.actionAmount.set(150);
    expect(component.actionAmountValid()).toBe(false);
    component.confirmAction();
    expect(managerFacade['markPaid']).toHaveBeenCalledTimes(calls);
  });

  it('write-off and refund: menu entries follow the balance, confirm dispatches with date / amount', () => {
    const managerFacade = TestBed.inject(AdminInvoiceManagerFacade) as unknown as Record<string, jest.Mock>;
    const open = { ...invoice('i1', 'partially_paid'), balance: 60 } as never;
    const credit = { ...invoice('p1', 'paid'), balance: -15 } as never;
    const ids = (inv: never) => component.invoiceMenu(inv).map((item) => item.id);

    expect(ids(open)).toContain('writeOff');
    expect(ids(open)).toContain('markUnpaid');
    expect(ids(open)).not.toContain('refund');
    expect(ids(credit)).toContain('refund');
    expect(ids(credit)).not.toContain('writeOff');
    expect(component.canVoid(invoice('w1', 'written_off') as never)).toBe(false);
    expect(component.canVoid(invoice('c1', 'credited') as never)).toBe(false);

    component.onInvoiceAction(open, 'writeOff');
    component.actionReason.set(' insolvent ');
    component.confirmAction();
    expect(managerFacade['writeOff']).toHaveBeenCalledWith(
      'i1',
      expect.objectContaining({ reason: 'insolvent', occurredAt: expect.any(String) }),
    );

    component.onInvoiceAction(credit, 'refund');
    expect(component.actionMaxAmount()).toBe(15);
    component.actionAmount.set(10);
    component.confirmAction();
    expect(managerFacade['refund']).toHaveBeenCalledWith('p1', expect.objectContaining({ amount: 10 }));
  });

  it('preview: loads the settlement history, offers the e-invoice XML and links bookings', () => {
    const managerFacade = TestBed.inject(AdminInvoiceManagerFacade) as unknown as Record<string, jest.Mock>;
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    Object.assign(URL, { createObjectURL: jest.fn(() => 'blob:x'), revokeObjectURL: jest.fn() });
    billingService['getManualInvoiceDetail'] = jest.fn(() => of({ id: 'i1', lineItems: [], taxBreakdown: [] }));
    billingService['downloadInvoiceEinvoice'] = jest.fn(() => of(new Blob(['<Invoice/>'])));

    const issued = { ...invoice('i1', 'issued'), canDownload: true } as never;

    component.openPreview(issued);
    expect(managerFacade['loadSettlements']).toHaveBeenCalledWith('i1');
    expect(component.previewInvoice()?.id).toBe('i1');
    expect(component.accountingEnabled()).toBe(true);
    expect(component.bookingsQueryParams(issued)).toEqual({ linkType: 'invoice', targetId: 'i1' });

    component.downloadEinvoice(issued);
    expect(billingService['downloadInvoiceEinvoice']).toHaveBeenCalledWith('i1');
    expect(click).toHaveBeenCalledTimes(1);

    supplierService['getById'] = jest.fn(() => of({ id: 'si1', lineItems: [] }));
    component.openSupplierPreview({ ...invoice('si1', 'issued'), canDownload: false } as never);
    expect(component.previewInvoice()).toBeNull();
    click.mockRestore();
  });

  it('settlement amounts are signed by their effect on the balance', () => {
    const base = { id: 's', currency: 'EUR', occurredAt: '', source: 'manual', createdAt: '' };

    expect(component.settlementAmount({ ...base, type: 'payment', amount: 10 })).toMatch(/^\u2212/);
    expect(component.settlementAmount({ ...base, type: 'refund', amount: 10 })).toMatch(/^\+/);
  });

  it('supplier lines: send account, asset and stock article fields only when set', () => {
    const supplierFacade = TestBed.inject(AdminSupplierInvoiceManagerFacade) as unknown as Record<string, jest.Mock>;

    component.editSupplierInvoiceId = 'si1';
    component.editSupplierLineItems = [
      { description: 'Laptop', quantity: 1, unitPriceNet: 1500, taxCategory: 'standard' },
      {
        description: 'Server',
        quantity: 1,
        unitPriceNet: 4000,
        taxCategory: 'standard',
        ledgerAccountNumber: ' 0420 ',
        capitalizeAsAsset: true,
        assetUsefulLifeMonths: 36,
        inventoryArticleId: 'art-1',
        accountingOpen: true,
      },
    ];
    component.submitEdit();

    expect(supplierFacade['updateInvoice']).toHaveBeenCalledWith(
      'si1',
      expect.objectContaining({
        lineItems: [
          { description: 'Laptop', quantity: 1, unitPriceNet: 1500, taxCategory: 'standard', taxRate: undefined },
          {
            description: 'Server',
            quantity: 1,
            unitPriceNet: 4000,
            taxCategory: 'standard',
            taxRate: undefined,
            ledgerAccountNumber: '0420',
            capitalizeAsAsset: true,
            assetUsefulLifeMonths: 36,
            inventoryArticleId: 'art-1',
          },
        ],
      }),
    );
  });

  it('supplier lines: editing restores accounting fields and opens their row', () => {
    supplierService['getById'] = jest.fn(() =>
      of({
        id: 'si1',
        supplierId: 'sup-1',
        lineItems: [
          { description: 'Fee', quantity: 1, unitPriceNet: 5, taxCategory: 'standard', taxRate: 19 },
          {
            description: 'Server',
            quantity: 1,
            unitPriceNet: 4000,
            taxCategory: 'standard',
            taxRate: 19,
            ledgerAccountNumber: '0420',
            capitalizeAsAsset: true,
            assetUsefulLifeMonths: 36,
          },
        ],
      }),
    );
    component.openEditSupplierModal({ ...invoice('si1', 'draft'), supplierId: 'sup-1' } as never);

    expect(component.editSupplierLineItems[0].accountingOpen).toBe(false);
    expect(component.editSupplierLineItems[1]).toEqual(
      expect.objectContaining({
        ledgerAccountNumber: '0420',
        capitalizeAsAsset: true,
        assetUsefulLifeMonths: 36,
        accountingOpen: true,
      }),
    );
  });
});
