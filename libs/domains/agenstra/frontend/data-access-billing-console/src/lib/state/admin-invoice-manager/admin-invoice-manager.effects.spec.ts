import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';
import type { AdminInvoiceListItem } from '../../types/billing.types';

import {
  loadAdminInvoiceManager,
  loadAdminInvoiceManagerBatch,
  loadAdminInvoiceManagerFailure,
  loadAdminInvoiceManagerSuccess,
} from './admin-invoice-manager.actions';
import { loadAdminInvoiceManager$, loadAdminInvoiceManagerBatch$ } from './admin-invoice-manager.effects';

describe('AdminInvoiceManagerEffects', () => {
  let actions$: Actions;
  let adminBillingService: jest.Mocked<AdminBillingService>;
  const mockInvoice: AdminInvoiceListItem = {
    id: 'inv-1',
    userId: 'user-1',
    status: 'draft',
    createdAt: '2024-01-01T00:00:00Z',
    canPay: false,
    canDownload: false,
    canPreview: false,
  };

  beforeEach(() => {
    adminBillingService = { listInvoices: jest.fn() } as never;
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AdminBillingService, useValue: adminBillingService }],
    });
    actions$ = TestBed.inject(Actions);
  });

  describe('loadAdminInvoiceManager$', () => {
    it('returns success when first batch is partial', (done) => {
      actions$ = of(loadAdminInvoiceManager());
      adminBillingService.listInvoices.mockReturnValue(of({ items: [mockInvoice], total: 1, limit: 10, offset: 0 }));

      loadAdminInvoiceManager$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(loadAdminInvoiceManagerSuccess({ invoices: [mockInvoice] }));
        done();
      });
    });

    it('chains batch when first page is full', (done) => {
      actions$ = of(loadAdminInvoiceManager());
      adminBillingService.listInvoices.mockReturnValue(
        of({ items: Array(10).fill(mockInvoice), total: 20, limit: 10, offset: 0 }),
      );

      loadAdminInvoiceManager$(actions$, adminBillingService).subscribe((result) => {
        expect(result.type).toBe(loadAdminInvoiceManagerBatch.type);
        done();
      });
    });

    it('returns failure on error', (done) => {
      actions$ = of(loadAdminInvoiceManager());
      adminBillingService.listInvoices.mockReturnValue(throwError(() => new Error('Load failed')));

      loadAdminInvoiceManager$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(loadAdminInvoiceManagerFailure({ error: 'Load failed' }));
        done();
      });
    });
  });

  describe('loadAdminInvoiceManagerBatch$', () => {
    it('accumulates invoices until partial page', (done) => {
      actions$ = of(loadAdminInvoiceManagerBatch({ offset: 10, accumulatedInvoices: [mockInvoice] }));
      adminBillingService.listInvoices.mockReturnValue(of({ items: [mockInvoice], total: 2, limit: 10, offset: 10 }));

      loadAdminInvoiceManagerBatch$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(loadAdminInvoiceManagerSuccess({ invoices: [mockInvoice, mockInvoice] }));
        done();
      });
    });
  });
});
