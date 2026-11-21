import { DatePipe, DecimalPipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  AdminOffersFacade,
  AdminBillingService,
  AdminOffersService,
  type AdminOfferListItem,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { AdminOffersPageComponent, offerTaxBreakdown } from './admin-offers-page.component';

jest.mock('../billing-country-options', () => ({ getCountryDisplayName: (code: string) => code }));
jest.mock('ng-apexcharts', () => {
  const { NgModule } = jest.requireActual('@angular/core');

  @NgModule({})
  class NgApexchartsModule {}

  return { NgApexchartsModule };
});

const offer = (id: string, status: string): AdminOfferListItem =>
  ({
    id,
    userId: `user-uuid-${id}`,
    userEmail: `${id}@example.com`,
    offerNumber: `OF-${id}`,
    status,
    currency: 'EUR',
    totalGross: 100,
    createdAt: '2026-10-01T00:00:00Z',
    updatedAt: '2026-10-01T00:00:00Z',
    // Mirrors the server's offerCapabilityFlags: drafts have no document.
    canPreview: status !== 'draft',
    canDownload: status !== 'draft',
  }) as AdminOfferListItem;

describe('AdminOffersPageComponent (data list)', () => {
  let service: {
    archive: jest.Mock;
    revoke: jest.Mock;
    delete: jest.Mock;
    get: jest.Mock;
    downloadPdf: jest.Mock;
  };
  let facade: Record<string, unknown>;
  let component: AdminOffersPageComponent;

  beforeEach(() => {
    service = { archive: jest.fn(), revoke: jest.fn(), delete: jest.fn(), get: jest.fn(), downloadPdf: jest.fn() };
    facade = new Proxy(
      {
        offers$: of([offer('d1', 'draft'), offer('d2', 'draft'), offer('p1', 'archived'), offer('a1', 'accepted')]),
        total$: of(60),
        getAuditLogsForOffer$: jest.fn(() => of([])),
        getAuditLogsTotal$: jest.fn(() => of(40)),
        loadOffers: jest.fn(),
        loadAuditLogs: jest.fn(),
        loadStatistics: jest.fn(),
      } as Record<string, unknown>,
      {
        get: (target, key: string) => {
          if (!(key in target)) target[key] = key.endsWith('$') ? of(null) : jest.fn();

          return target[key];
        },
      },
    );
    TestBed.configureTestingModule({
      providers: [
        DatePipe,
        DecimalPipe,
        { provide: AdminOffersFacade, useValue: facade },
        { provide: AdminOffersService, useValue: service },
        {
          provide: AdminBillingService,
          useValue: {
            getDocumentTermsDefaults: jest.fn(() =>
              of({ paymentDueDays: 14, deliveryTermsCode: null, deliveryTermsPlace: null, deliveryTermsText: null }),
            ),
          },
        },
      ],
    });
    component = TestBed.runInInjectionContext(() => new AdminOffersPageComponent());
  });

  it('server-pages the offers table (page 1 / 25 first, then the requested page) with the customer filter', () => {
    TestBed.tick();
    expect(facade['loadOffers']).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1, pageSize: 25, userId: undefined }),
    );

    component.paging.page.set(3);
    TestBed.tick();
    expect(facade['loadOffers']).toHaveBeenLastCalledWith(expect.objectContaining({ page: 3, pageSize: 25 }));

    component.offersUserIdDraft = 'user-1';
    component.applyOfferFilters();
    TestBed.tick();
    expect(facade['loadOffers']).toHaveBeenLastCalledWith(expect.objectContaining({ userId: 'user-1' }));
  });

  it('shows State + offer number + customer email (never the user id) and pages the audit log', () => {
    expect(component.columns[0]).toEqual(expect.objectContaining({ id: 'status', type: 'state' }));
    expect(component.columns[1].value?.(offer('d1', 'draft'))).toBe('OF-d1');
    expect(component.columns[2].value?.(offer('d1', 'draft'))).toBe('d1@example.com');
    expect(component.columns.map((c) => c.id)).not.toContain('id');

    component.openAuditHistory(offer('d1', 'draft'));
    TestBed.tick();
    expect(facade['loadAuditLogs']).toHaveBeenLastCalledWith('d1', 1, 25);
    component.auditPage.set(2);
    TestBed.tick();
    expect(facade['loadAuditLogs']).toHaveBeenLastCalledWith('d1', 2, 25);
    expect(component.auditLogsTotal()).toBe(40);
  });

  it('bulk Archive asks first, then archives each selected draft with the chosen notification (per-item result)', async () => {
    service.archive.mockImplementation((id: string) => (id === 'd2' ? throwError(() => ({ status: 403 })) : of({})));
    component.selected.set(['d1', 'd2', 'p1']);

    component.archiveSelected();

    expect(component.pendingArchive()?.map((o) => o.id)).toEqual(['d1', 'd2']);
    expect(service.archive).not.toHaveBeenCalled();
    expect(component.archiveNotifyCustomer).toBe(true);

    component.archiveNotifyCustomer = false;
    await component.confirmArchive();

    expect(service.archive).toHaveBeenCalledTimes(2);
    expect(service.archive).toHaveBeenCalledWith('d1', { notifyCustomer: false, notifyOnExpiry: true });
    expect(service.archive).not.toHaveBeenCalledWith('p1', expect.anything());
    expect(component.pendingArchive()).toBeNull();
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
  });

  it('row Archive opens the dialog (notifications on by default) and archives through the store', async () => {
    component.onRowAction(offer('d1', 'draft'), 'archive');

    expect(component.pendingArchive()?.map((o) => o.id)).toEqual(['d1']);
    expect(facade['archiveOffer']).not.toHaveBeenCalled();

    component.archiveNotifyOnExpiry = false;
    await component.confirmArchive();

    expect(facade['archiveOffer']).toHaveBeenCalledWith('d1', { notifyCustomer: true, notifyOnExpiry: false });
    expect(service.archive).not.toHaveBeenCalled();
  });

  it('offers Send to customer for archived offers that were not sent, after a confirm', () => {
    const unsent = { ...offer('p2', 'archived'), sentAt: null, canSend: true };
    const sent = { ...offer('p1', 'archived'), sentAt: '2026-10-02T00:00:00Z', canSend: false };
    const ids = (row: AdminOfferListItem) => component.rowMenu(row).map((item) => item.id);

    expect(ids(offer('d1', 'draft'))).toEqual(expect.arrayContaining(['archive']));
    expect(ids(offer('d1', 'draft'))).not.toContain('send');
    expect(ids(unsent)).toEqual(expect.arrayContaining(['send', 'revoke']));
    expect(ids(sent)).not.toContain('send');
    expect(component.columns[0].state?.(unsent)).toEqual(
      expect.objectContaining({ icon: 'send-slash', label: 'Pending response (not sent)' }),
    );
    expect(component.columns[0].state?.(sent)?.icon).not.toBe('send-slash');

    component.onRowAction(sent, 'send');
    expect(component.pendingSend()).toBeNull();

    component.onRowAction(unsent, 'send');
    expect(component.pendingSend()?.id).toBe('p2');
    expect(facade['sendOffer']).not.toHaveBeenCalled();

    component.confirmSend();
    expect(facade['sendOffer']).toHaveBeenCalledWith('p2');
    expect(component.pendingSend()).toBeNull();
  });

  it('offers Accept / Decline exactly where the server allows it (sent or not), after a confirm', () => {
    const open = { ...offer('p2', 'archived'), sentAt: null, canAccept: true, canDecline: true };
    const expired = { ...offer('p3', 'archived'), canAccept: false, canDecline: true };
    const ids = (row: AdminOfferListItem) => component.rowMenu(row).map((item) => item.id);

    expect(ids(open)).toEqual(expect.arrayContaining(['accept', 'decline']));
    expect(ids(expired)).not.toContain('accept');
    expect(ids(expired)).toContain('decline');

    for (const status of ['draft', 'accepted', 'declined', 'expired', 'revoked'] as const) {
      expect(ids(offer('x', status))).not.toEqual(expect.arrayContaining(['accept']));
      expect(ids(offer('x', status))).not.toContain('decline');
    }

    component.onRowAction(expired, 'accept');
    expect(component.pendingAccept()).toBeNull();

    component.acceptNotifyCustomer = false;
    component.onRowAction(open, 'accept');
    expect(component.pendingAccept()?.id).toBe('p2');
    expect(component.acceptNotifyCustomer).toBe(true);
    expect(component.acceptNotifyInvoices).toBe(true);
    expect(facade['acceptOffer']).not.toHaveBeenCalled();

    component.acceptNotifyInvoices = false;
    component.confirmAccept();
    expect(facade['acceptOffer']).toHaveBeenCalledWith('p2', { notifyCustomer: true, notifyInvoices: false });
    expect(component.pendingAccept()).toBeNull();

    component.onRowAction(expired, 'decline');
    expect(component.pendingDecline()?.id).toBe('p3');
    component.declineNotifyCustomer = false;
    component.confirmDecline();
    expect(facade['declineOffer']).toHaveBeenCalledWith('p3', { notifyCustomer: false });
    expect(component.pendingDecline()).toBeNull();
  });

  it('row Revoke asks first and passes the notification choice', () => {
    component.onRowAction({ ...offer('p2', 'archived'), sentAt: null }, 'revoke');
    expect(component.revokeNotifyCustomer).toBe(false);

    component.onRowAction({ ...offer('p1', 'archived'), sentAt: '2026-10-02T00:00:00Z' }, 'revoke');

    expect(component.pendingRevoke()?.id).toBe('p1');
    expect(component.revokeNotifyCustomer).toBe(true);
    expect(facade['revokeOffer']).not.toHaveBeenCalled();

    component.revokeNotifyCustomer = false;
    component.confirmRevoke();

    expect(facade['revokeOffer']).toHaveBeenCalledWith('p1', { notifyCustomer: false });
  });

  it('bulk Revoke / Delete drafts run after confirm on the allowed subset only', async () => {
    service.revoke.mockReturnValue(of({}));
    service.delete.mockImplementation(() => throwError(() => ({ status: 403 })));
    component.selected.set(['d1', 'p1', 'a1']);

    component.openBulkConfirm('revoke');
    expect(component.bulkRevokeNotifyCustomer).toBe(true);
    await component.runPendingBulk();
    expect(service.revoke).toHaveBeenCalledTimes(1);
    expect(service.revoke).toHaveBeenCalledWith('p1', { notifyCustomer: true });

    component.selected.set(['d1', 'a1']);
    component.pendingBulk.set('delete');
    await component.runPendingBulk();
    expect(service.delete).toHaveBeenCalledTimes(1);
    expect(component.bulkResult()?.message).toContain('1 not allowed');
    expect(component.pendingBulk()).toBeNull();
  });

  it('offers Preview / Download PDF for sent offers only (drafts are edited)', () => {
    const ids = (status: string) => component.rowMenu(offer('x', status)).map((item) => item.id);

    expect(ids('draft')).toEqual(expect.arrayContaining(['edit']));
    expect(ids('draft')).not.toEqual(expect.arrayContaining(['preview']));
    expect(ids('draft')).not.toContain('download');

    for (const status of ['archived', 'accepted', 'declined', 'expired', 'revoked']) {
      expect(ids(status)).toEqual(expect.arrayContaining(['preview', 'download']));
      expect(ids(status)).not.toContain('edit');
    }
  });

  it('opens the preview from the detail endpoint (row activation of a sent offer too)', () => {
    service.get.mockReturnValue(
      of({ ...offer('p1', 'archived'), userEmail: 'p1@example.com', subtotalNet: 84, taxTotal: 16, lineItems: [] }),
    );
    const sent = { ...offer('p1', 'archived'), customerName: 'ACME GmbH' };

    component.onRowActivate(sent);

    expect(service.get).toHaveBeenCalledWith('p1');
    expect(component.previewOfferModalOpen()).toBe(true);
    expect(component.previewLoading()).toBe(false);
    expect(component.previewDetail()?.customerName).toBe('ACME GmbH');
    expect(component.previewSummaryItems().map((item) => item.key)).toEqual(['subtotal', 'tax', 'total']);

    component.onRowAction(offer('d1', 'draft'), 'preview');
    expect(service.get).toHaveBeenCalledTimes(1);
  });

  it('downloads the stored PDF of a sent offer through the admin endpoint', () => {
    const blob = new Blob(['%PDF']);
    const click = jest.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);

    URL.createObjectURL = jest.fn(() => 'blob:offer');
    URL.revokeObjectURL = jest.fn();
    service.downloadPdf.mockReturnValue(of(blob));

    component.onRowAction(offer('p1', 'archived'), 'download');
    expect(service.downloadPdf).toHaveBeenCalledWith('p1');
    expect(click).toHaveBeenCalledTimes(1);

    component.downloadOfferPdf(offer('d1', 'draft'));
    expect(service.downloadPdf).toHaveBeenCalledTimes(1);
    click.mockRestore();
  });

  it('sums line taxes per rate for the tax breakdown', () => {
    const line = (taxRate: number, lineTax: number) => ({ taxRate, lineTax }) as never;

    expect(offerTaxBreakdown({ lineItems: [line(7, 0.7), line(19, 1.9), line(19, 3.8), line(0, 0)] })).toEqual([
      { taxRate: 19, taxAmount: 5.7 },
      { taxRate: 7, taxAmount: 0.7 },
    ]);
  });
});
