import { initialAdminSupplierInvoiceManagerState } from './admin-supplier-invoice-manager.reducer';
import {
  selectAdminSupplierInvoiceManagerInvoices,
  selectAdminSupplierInvoiceManagerLoading,
  selectAdminSupplierInvoiceSummary,
} from './admin-supplier-invoice-manager.selectors';

describe('adminSupplierInvoiceManagerSelectors', () => {
  const invoice = {
    id: 'inv-1',
    supplierId: 'supplier-1',
    status: 'draft',
    currency: 'EUR',
    subtotalNet: 10,
    taxTotal: 1.9,
    totalGross: 11.9,
    balanceDue: 11.9,
    hasUploadedDocument: false,
    createdAt: '',
    canDownload: false,
    canPreview: false,
  };

  it('selectAdminSupplierInvoiceSummary returns summary', () => {
    expect(
      selectAdminSupplierInvoiceSummary.projector({
        ...initialAdminSupplierInvoiceManagerState,
        summary: {
          totalGross: 100,
          invoiceCount: 2,
          openCount: 1,
          openGross: 50,
          paidCount: 1,
          paidGross: 50,
          draftCount: 0,
          series: [{ period: '2024-01-01', totalGross: 50 }],
          from: '2024-01-01',
          to: '2024-01-31',
          groupBy: 'day',
        },
      }),
    ).toEqual({
      totalGross: 100,
      invoiceCount: 2,
      openCount: 1,
      openGross: 50,
      paidCount: 1,
      paidGross: 50,
      draftCount: 0,
      series: [{ period: '2024-01-01', totalGross: 50 }],
      from: '2024-01-01',
      to: '2024-01-31',
      groupBy: 'day',
    });
  });

  it('selectAdminSupplierInvoiceManagerInvoices returns invoices', () => {
    expect(
      selectAdminSupplierInvoiceManagerInvoices.projector({
        ...initialAdminSupplierInvoiceManagerState,
        invoices: [invoice],
      }),
    ).toEqual([invoice]);
  });

  it('selectAdminSupplierInvoiceManagerLoading returns loading flag', () => {
    expect(
      selectAdminSupplierInvoiceManagerLoading.projector({
        ...initialAdminSupplierInvoiceManagerState,
        loading: true,
      }),
    ).toBe(true);
  });
});
