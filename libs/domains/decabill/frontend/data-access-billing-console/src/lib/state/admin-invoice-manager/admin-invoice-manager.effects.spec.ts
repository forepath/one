import { TestBed } from '@angular/core/testing';
import { Actions } from '@ngrx/effects';
import { provideMockActions } from '@ngrx/effects/testing';
import { of, throwError } from 'rxjs';

import { AdminBillingService } from '../../services/admin-billing.service';
import type { AdminInvoiceListItem } from '../../types/billing.types';

import {
  adminInvoiceManagerMarkPaid,
  adminInvoiceManagerMarkPaidFailure,
  adminInvoiceManagerMarkPaidSuccess,
  adminInvoiceManagerMarkUnpaid,
  adminInvoiceManagerMarkUnpaidFailure,
  adminInvoiceManagerMarkUnpaidSuccess,
  adminInvoiceManagerVoid,
  adminInvoiceManagerVoidFailure,
  adminInvoiceManagerVoidSuccess,
  createManualInvoice,
  createManualInvoiceFailure,
  createManualInvoiceSuccess,
  deleteManualInvoice,
  deleteManualInvoiceFailure,
  deleteManualInvoiceSuccess,
  issueManualInvoice,
  issueManualInvoiceFailure,
  issueManualInvoiceSuccess,
  loadAdminInvoiceManager,
  loadAdminInvoiceManagerBatch,
  loadAdminInvoiceManagerFailure,
  loadAdminInvoiceManagerSuccess,
  updateManualInvoice,
  updateManualInvoiceFailure,
  updateManualInvoiceSuccess,
} from './admin-invoice-manager.actions';
import {
  adminInvoiceManagerMarkPaid$,
  adminInvoiceManagerMarkUnpaid$,
  adminInvoiceManagerVoid$,
  createManualInvoice$,
  deleteManualInvoice$,
  issueManualInvoice$,
  loadAdminInvoiceManager$,
  loadAdminInvoiceManagerBatch$,
  updateManualInvoice$,
} from './admin-invoice-manager.effects';

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
    adminBillingService = {
      listInvoices: jest.fn(),
      createManualInvoice: jest.fn(),
      updateManualInvoice: jest.fn(),
      issueManualInvoice: jest.fn(),
      deleteManualInvoice: jest.fn(),
      voidInvoice: jest.fn(),
      markPaid: jest.fn(),
      markUnpaid: jest.fn(),
    } as never;
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AdminBillingService, useValue: adminBillingService }],
    });
    actions$ = TestBed.inject(Actions);
  });

  describe('loadAdminInvoiceManager$', () => {
    it('returns empty success when no invoices', (done) => {
      actions$ = of(loadAdminInvoiceManager());
      adminBillingService.listInvoices.mockReturnValue(of({ items: [], total: 0, limit: 10, offset: 0 }));

      loadAdminInvoiceManager$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(loadAdminInvoiceManagerSuccess({ invoices: [] }));
        done();
      });
    });

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

  describe('createManualInvoice$', () => {
    it('returns success', (done) => {
      const invoice = { ...mockInvoice, id: 'inv-new' };

      actions$ = of(
        createManualInvoice({
          dto: {
            userId: 'user-1',
            lineItems: [{ description: 'Line', quantity: 1, unitPriceNet: 10, taxCategory: 'standard' }],
          },
        }),
      );
      adminBillingService.createManualInvoice.mockReturnValue(of(invoice as never));

      createManualInvoice$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(createManualInvoiceSuccess({ invoice: invoice as never }));
        done();
      });
    });
  });

  describe('updateManualInvoice$', () => {
    it('returns success', (done) => {
      const invoice = { ...mockInvoice, id: 'inv-1' };

      actions$ = of(
        updateManualInvoice({
          invoiceRefId: 'inv-1',
          dto: { lineItems: [{ description: 'Updated', quantity: 1, unitPriceNet: 20, taxCategory: 'standard' }] },
        }),
      );
      adminBillingService.updateManualInvoice.mockReturnValue(of(invoice as never));

      updateManualInvoice$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(updateManualInvoiceSuccess({ invoice: invoice as never }));
        done();
      });
    });
  });

  describe('issueManualInvoice$', () => {
    it('returns success', (done) => {
      const invoice = { ...mockInvoice, id: 'inv-1', status: 'issued' };

      actions$ = of(issueManualInvoice({ invoiceRefId: 'inv-1', dto: { dueInDays: 14 } }));
      adminBillingService.issueManualInvoice.mockReturnValue(of(invoice as never));

      issueManualInvoice$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(issueManualInvoiceSuccess({ invoice: invoice as never }));
        done();
      });
    });
  });

  describe('deleteManualInvoice$', () => {
    it('returns success', (done) => {
      actions$ = of(deleteManualInvoice({ invoiceRefId: 'inv-1' }));
      adminBillingService.deleteManualInvoice.mockReturnValue(of(undefined));

      deleteManualInvoice$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(deleteManualInvoiceSuccess({ invoiceRefId: 'inv-1' }));
        done();
      });
    });
  });

  describe('adminInvoiceManagerVoid$', () => {
    it('returns success', (done) => {
      const invoice = { ...mockInvoice, status: 'void' };

      actions$ = of(adminInvoiceManagerVoid({ invoiceRefId: 'inv-1' }));
      adminBillingService.voidInvoice.mockReturnValue(of(invoice as never));

      adminInvoiceManagerVoid$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(adminInvoiceManagerVoidSuccess({ invoice: invoice as never }));
        done();
      });
    });
  });

  describe('adminInvoiceManagerMarkPaid$', () => {
    it('returns success', (done) => {
      const invoice = { ...mockInvoice, status: 'paid' };

      actions$ = of(adminInvoiceManagerMarkPaid({ invoiceRefId: 'inv-1', dto: { reason: 'manual' } }));
      adminBillingService.markPaid.mockReturnValue(of(invoice as never));

      adminInvoiceManagerMarkPaid$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(adminInvoiceManagerMarkPaidSuccess({ invoice: invoice as never }));
        done();
      });
    });
  });

  describe('adminInvoiceManagerMarkUnpaid$', () => {
    it('returns success', (done) => {
      const invoice = { ...mockInvoice, status: 'issued' };

      actions$ = of(adminInvoiceManagerMarkUnpaid({ invoiceRefId: 'inv-1' }));
      adminBillingService.markUnpaid.mockReturnValue(of(invoice as never));

      adminInvoiceManagerMarkUnpaid$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(adminInvoiceManagerMarkUnpaidSuccess({ invoice: invoice as never }));
        done();
      });
    });
  });

  describe('failure effects', () => {
    it('createManualInvoice$ returns failure', (done) => {
      actions$ = of(
        createManualInvoice({
          dto: {
            userId: 'user-1',
            lineItems: [{ description: 'Line', quantity: 1, unitPriceNet: 10, taxCategory: 'standard' }],
          },
        }),
      );
      adminBillingService.createManualInvoice.mockReturnValue(throwError(() => new Error('Create failed')));

      createManualInvoice$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(createManualInvoiceFailure({ error: 'Create failed' }));
        done();
      });
    });

    it('updateManualInvoice$ returns failure', (done) => {
      actions$ = of(
        updateManualInvoice({
          invoiceRefId: 'inv-1',
          dto: { lineItems: [{ description: 'Updated', quantity: 1, unitPriceNet: 20, taxCategory: 'standard' }] },
        }),
      );
      adminBillingService.updateManualInvoice.mockReturnValue(throwError(() => new Error('Update failed')));

      updateManualInvoice$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(updateManualInvoiceFailure({ error: 'Update failed' }));
        done();
      });
    });

    it('issueManualInvoice$ returns failure', (done) => {
      actions$ = of(issueManualInvoice({ invoiceRefId: 'inv-1' }));
      adminBillingService.issueManualInvoice.mockReturnValue(throwError(() => new Error('Issue failed')));

      issueManualInvoice$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(issueManualInvoiceFailure({ error: 'Issue failed' }));
        done();
      });
    });

    it('deleteManualInvoice$ returns failure', (done) => {
      actions$ = of(deleteManualInvoice({ invoiceRefId: 'inv-1' }));
      adminBillingService.deleteManualInvoice.mockReturnValue(throwError(() => new Error('Delete failed')));

      deleteManualInvoice$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(deleteManualInvoiceFailure({ error: 'Delete failed' }));
        done();
      });
    });

    it('adminInvoiceManagerVoid$ returns failure', (done) => {
      actions$ = of(adminInvoiceManagerVoid({ invoiceRefId: 'inv-1' }));
      adminBillingService.voidInvoice.mockReturnValue(throwError(() => new Error('Void failed')));

      adminInvoiceManagerVoid$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(adminInvoiceManagerVoidFailure({ error: 'Void failed' }));
        done();
      });
    });

    it('adminInvoiceManagerMarkPaid$ returns failure', (done) => {
      actions$ = of(adminInvoiceManagerMarkPaid({ invoiceRefId: 'inv-1' }));
      adminBillingService.markPaid.mockReturnValue(throwError(() => new Error('Mark paid failed')));

      adminInvoiceManagerMarkPaid$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(adminInvoiceManagerMarkPaidFailure({ error: 'Mark paid failed' }));
        done();
      });
    });

    it('adminInvoiceManagerMarkUnpaid$ returns failure', (done) => {
      actions$ = of(adminInvoiceManagerMarkUnpaid({ invoiceRefId: 'inv-1' }));
      adminBillingService.markUnpaid.mockReturnValue(throwError(() => new Error('Mark unpaid failed')));

      adminInvoiceManagerMarkUnpaid$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(adminInvoiceManagerMarkUnpaidFailure({ error: 'Mark unpaid failed' }));
        done();
      });
    });
  });
});
