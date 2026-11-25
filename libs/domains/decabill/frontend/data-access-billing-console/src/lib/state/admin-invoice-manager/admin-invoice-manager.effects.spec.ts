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
  adminInvoiceManagerRefund,
  adminInvoiceManagerRefundFailure,
  adminInvoiceManagerRefundSuccess,
  adminInvoiceManagerSend,
  adminInvoiceManagerSendCreditNote,
  adminInvoiceManagerSendCreditNoteSuccess,
  adminInvoiceManagerSendFailure,
  adminInvoiceManagerSendSuccess,
  adminInvoiceManagerMarkSent,
  adminInvoiceManagerMarkSentSuccess,
  adminInvoiceManagerVoid,
  adminInvoiceManagerVoidFailure,
  adminInvoiceManagerVoidSuccess,
  adminInvoiceManagerWriteOff,
  adminInvoiceManagerWriteOffFailure,
  adminInvoiceManagerWriteOffSuccess,
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
  loadAdminInvoiceManagerFailure,
  loadAdminInvoiceManagerSuccess,
  loadAdminInvoiceSettlements,
  loadAdminInvoiceSettlementsFailure,
  loadAdminInvoiceSettlementsSuccess,
  updateManualInvoice,
  updateManualInvoiceFailure,
  updateManualInvoiceSuccess,
} from './admin-invoice-manager.actions';
import {
  adminInvoiceManagerMarkPaid$,
  adminInvoiceManagerMarkUnpaid$,
  adminInvoiceManagerRefund$,
  adminInvoiceManagerSend$,
  adminInvoiceManagerMarkSent$,
  adminInvoiceManagerSendCreditNote$,
  adminInvoiceManagerVoid$,
  adminInvoiceManagerWriteOff$,
  createManualInvoice$,
  deleteManualInvoice$,
  issueManualInvoice$,
  loadAdminInvoiceManager$,
  loadAdminInvoiceSettlements$,
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
      sendInvoice: jest.fn(),
      sendCreditNote: jest.fn(),
      sendInvoiceLetter: jest.fn(),
      sendCreditNoteLetter: jest.fn(),
      markInvoiceSent: jest.fn(),
      markCreditNoteSent: jest.fn(),
      markPaid: jest.fn(),
      markUnpaid: jest.fn(),
      writeOffInvoice: jest.fn(),
      refundInvoice: jest.fn(),
      listInvoiceSettlements: jest.fn(),
    } as never;
    TestBed.configureTestingModule({
      providers: [provideMockActions(() => actions$), { provide: AdminBillingService, useValue: adminBillingService }],
    });
    actions$ = TestBed.inject(Actions);
  });

  describe('loadAdminInvoiceManager$', () => {
    it('returns empty success when no invoices', (done) => {
      actions$ = of(loadAdminInvoiceManager({}));
      adminBillingService.listInvoices.mockReturnValue(of({ items: [], total: 0, limit: 25, offset: 0 }));

      loadAdminInvoiceManager$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(loadAdminInvoiceManagerSuccess({ invoices: [], total: 0 }));
        expect(adminBillingService.listInvoices).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 25, offset: 0 }),
        );
        done();
      });
    });

    it('loads the requested page and returns its rows with the total', (done) => {
      actions$ = of(loadAdminInvoiceManager({ search: 'inv', page: 3, pageSize: 50 }));
      adminBillingService.listInvoices.mockReturnValue(
        of({ items: [mockInvoice], total: 101, limit: 50, offset: 100 }),
      );

      loadAdminInvoiceManager$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(loadAdminInvoiceManagerSuccess({ invoices: [mockInvoice], total: 101 }));
        expect(adminBillingService.listInvoices).toHaveBeenCalledWith(
          expect.objectContaining({ search: 'inv', limit: 50, offset: 100 }),
        );
        done();
      });
    });

    it('returns failure on error', (done) => {
      actions$ = of(loadAdminInvoiceManager({}));
      adminBillingService.listInvoices.mockReturnValue(throwError(() => new Error('Load failed')));

      loadAdminInvoiceManager$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(loadAdminInvoiceManagerFailure({ error: 'Load failed' }));
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

  describe('send$ / sendCreditNote$', () => {
    it('sends the invoice and the credit note through the admin endpoints', (done) => {
      const sent = { ...mockInvoice, status: 'issued', sentAt: '2026-11-21T10:00:00Z', canSend: false };

      adminBillingService.sendInvoice.mockReturnValue(of(sent as never));
      adminBillingService.sendCreditNote.mockReturnValue(of(sent as never));

      adminInvoiceManagerSendCreditNote$(
        of(adminInvoiceManagerSendCreditNote({ invoiceRefId: 'inv-1' })) as never,
        adminBillingService,
      ).subscribe((result) => {
        expect(result).toEqual(adminInvoiceManagerSendCreditNoteSuccess({ invoice: sent as never }));
        expect(adminBillingService.sendCreditNote).toHaveBeenCalledWith('inv-1');
      });

      adminInvoiceManagerSend$(
        of(adminInvoiceManagerSend({ invoiceRefId: 'inv-1' })) as never,
        adminBillingService,
      ).subscribe((result) => {
        expect(result).toEqual(adminInvoiceManagerSendSuccess({ invoice: sent as never }));
        expect(adminBillingService.sendInvoice).toHaveBeenCalledWith('inv-1');
        done();
      });
    });

    it('maps send errors (e.g. no billing email) to failure', (done) => {
      adminBillingService.sendInvoice.mockReturnValue(
        throwError(() => ({ error: { message: 'Customer has no billing email address; nothing was sent' } })),
      );

      adminInvoiceManagerSend$(
        of(adminInvoiceManagerSend({ invoiceRefId: 'inv-1' })) as never,
        adminBillingService,
      ).subscribe((result) => {
        expect(result.type).toBe(adminInvoiceManagerSendFailure.type);
        done();
      });
    });
  });

  describe('letters and mark sent', () => {
    it('routes letter sends to the letter endpoints', (done) => {
      const sent = { ...mockInvoice, sentVia: 'letter' };

      adminBillingService.sendInvoiceLetter.mockReturnValue(of(sent as never));
      adminBillingService.sendCreditNoteLetter.mockReturnValue(of(sent as never));

      adminInvoiceManagerSendCreditNote$(
        of(adminInvoiceManagerSendCreditNote({ invoiceRefId: 'inv-1', channel: 'letter' })) as never,
        adminBillingService,
      ).subscribe(() => expect(adminBillingService.sendCreditNoteLetter).toHaveBeenCalledWith('inv-1'));

      adminInvoiceManagerSend$(
        of(adminInvoiceManagerSend({ invoiceRefId: 'inv-1', channel: 'letter' })) as never,
        adminBillingService,
      ).subscribe((result) => {
        expect(result).toEqual(adminInvoiceManagerSendSuccess({ invoice: sent as never }));
        expect(adminBillingService.sendInvoiceLetter).toHaveBeenCalledWith('inv-1');
        expect(adminBillingService.sendInvoice).not.toHaveBeenCalled();
        done();
      });
    });

    it('marks the invoice or its credit note as sent', (done) => {
      adminBillingService.markInvoiceSent.mockReturnValue(of(mockInvoice as never));
      adminBillingService.markCreditNoteSent.mockReturnValue(of(mockInvoice as never));

      adminInvoiceManagerMarkSent$(
        of(adminInvoiceManagerMarkSent({ invoiceRefId: 'inv-1', creditNote: true })) as never,
        adminBillingService,
      ).subscribe(() => expect(adminBillingService.markCreditNoteSent).toHaveBeenCalledWith('inv-1', undefined));

      adminInvoiceManagerMarkSent$(
        of(adminInvoiceManagerMarkSent({ invoiceRefId: 'inv-1', dto: { sentAt: '2026-11-20' } })) as never,
        adminBillingService,
      ).subscribe((result) => {
        expect(result).toEqual(adminInvoiceManagerMarkSentSuccess({ invoice: mockInvoice as never }));
        expect(adminBillingService.markInvoiceSent).toHaveBeenCalledWith('inv-1', { sentAt: '2026-11-20' });
        done();
      });
    });

    it('issues without email and then sends the letter', (done) => {
      const invoice = { ...mockInvoice, id: 'inv-1', status: 'issued' };
      const emitted: unknown[] = [];

      adminBillingService.issueManualInvoice.mockReturnValue(of(invoice as never));

      issueManualInvoice$(
        of(issueManualInvoice({ invoiceRefId: 'inv-1', dto: { dueInDays: 14 }, sendLetter: true })) as never,
        adminBillingService,
      ).subscribe({
        next: (action) => emitted.push(action),
        complete: () => {
          expect(adminBillingService.issueManualInvoice).toHaveBeenCalledWith('inv-1', {
            dueInDays: 14,
            notifyCustomer: false,
          });
          expect(emitted).toEqual([
            issueManualInvoiceSuccess({ invoice: invoice as never }),
            adminInvoiceManagerSend({ invoiceRefId: 'inv-1', channel: 'letter' }),
          ]);
          done();
        },
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

  describe('adminInvoiceManagerWriteOff$', () => {
    it('returns success', (done) => {
      const invoice = { ...mockInvoice, status: 'written_off' };

      actions$ = of(adminInvoiceManagerWriteOff({ invoiceRefId: 'inv-1', dto: { reason: 'insolvent' } }));
      adminBillingService.writeOffInvoice.mockReturnValue(of(invoice as never));

      adminInvoiceManagerWriteOff$(actions$, adminBillingService).subscribe((result) => {
        expect(adminBillingService.writeOffInvoice).toHaveBeenCalledWith('inv-1', { reason: 'insolvent' });
        expect(result).toEqual(adminInvoiceManagerWriteOffSuccess({ invoice: invoice as never }));
        done();
      });
    });

    it('returns failure', (done) => {
      actions$ = of(adminInvoiceManagerWriteOff({ invoiceRefId: 'inv-1' }));
      adminBillingService.writeOffInvoice.mockReturnValue(throwError(() => new Error('Write-off failed')));

      adminInvoiceManagerWriteOff$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(adminInvoiceManagerWriteOffFailure({ error: 'Write-off failed' }));
        done();
      });
    });
  });

  describe('adminInvoiceManagerRefund$', () => {
    it('returns success', (done) => {
      const invoice = { ...mockInvoice, status: 'paid', balance: 0 };

      actions$ = of(adminInvoiceManagerRefund({ invoiceRefId: 'inv-1', dto: { amount: 10 } }));
      adminBillingService.refundInvoice.mockReturnValue(of(invoice as never));

      adminInvoiceManagerRefund$(actions$, adminBillingService).subscribe((result) => {
        expect(adminBillingService.refundInvoice).toHaveBeenCalledWith('inv-1', { amount: 10 });
        expect(result).toEqual(adminInvoiceManagerRefundSuccess({ invoice: invoice as never }));
        done();
      });
    });

    it('returns failure', (done) => {
      actions$ = of(adminInvoiceManagerRefund({ invoiceRefId: 'inv-1' }));
      adminBillingService.refundInvoice.mockReturnValue(throwError(() => new Error('Refund failed')));

      adminInvoiceManagerRefund$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(adminInvoiceManagerRefundFailure({ error: 'Refund failed' }));
        done();
      });
    });
  });

  describe('loadAdminInvoiceSettlements$', () => {
    it('returns success', (done) => {
      const settlements = [
        {
          id: 's-1',
          type: 'payment',
          amount: 50,
          currency: 'EUR',
          occurredAt: '2026-11-01T00:00:00Z',
          source: 'manual',
          createdAt: '2026-11-01T00:00:00Z',
        },
      ];

      actions$ = of(loadAdminInvoiceSettlements({ invoiceRefId: 'inv-1' }));
      adminBillingService.listInvoiceSettlements.mockReturnValue(of(settlements));

      loadAdminInvoiceSettlements$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(loadAdminInvoiceSettlementsSuccess({ invoiceRefId: 'inv-1', settlements }));
        done();
      });
    });

    it('returns failure', (done) => {
      actions$ = of(loadAdminInvoiceSettlements({ invoiceRefId: 'inv-1' }));
      adminBillingService.listInvoiceSettlements.mockReturnValue(throwError(() => new Error('Load failed')));

      loadAdminInvoiceSettlements$(actions$, adminBillingService).subscribe((result) => {
        expect(result).toEqual(loadAdminInvoiceSettlementsFailure({ invoiceRefId: 'inv-1', error: 'Load failed' }));
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
