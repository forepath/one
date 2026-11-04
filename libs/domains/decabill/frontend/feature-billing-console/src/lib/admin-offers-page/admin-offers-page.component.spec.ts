import { DatePipe, DecimalPipe } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import {
  AdminOffersFacade,
  AdminOffersService,
  type AdminOfferListItem,
} from '@forepath/decabill/frontend/data-access-billing-console';
import { of, throwError } from 'rxjs';

import { AdminOffersPageComponent, offerTaxBreakdown } from './admin-offers-page.component';

jest.mock('keycloak-js', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('keycloak-angular', () => ({
  KeycloakService: jest.fn(),
  createAuthGuard: jest.fn((impl: unknown) => impl),
}));
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

  it('bulk Send to customer archives each selected draft with per-item results (incl. denied)', async () => {
    service.archive.mockImplementation((id: string) => (id === 'd2' ? throwError(() => ({ status: 403 })) : of({})));
    component.selected.set(['d1', 'd2', 'p1']);

    await component.sendSelected();

    expect(service.archive).toHaveBeenCalledTimes(2);
    expect(service.archive).not.toHaveBeenCalledWith('p1');
    expect(component.bulkResult()?.message).toContain('1 done');
    expect(component.bulkResult()?.message).toContain('1 not allowed');
  });

  it('bulk Revoke / Delete drafts run after confirm on the allowed subset only', async () => {
    service.revoke.mockReturnValue(of({}));
    service.delete.mockImplementation(() => throwError(() => ({ status: 403 })));
    component.selected.set(['d1', 'p1', 'a1']);

    component.pendingBulk.set('revoke');
    await component.runPendingBulk();
    expect(service.revoke).toHaveBeenCalledTimes(1);
    expect(service.revoke).toHaveBeenCalledWith('p1');

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
