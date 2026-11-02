import {
  createSupplierInvoiceSuccess,
  loadAdminSupplierInvoiceManager,
  loadAdminSupplierInvoiceManagerSuccess,
  loadAdminSupplierInvoiceSummarySuccess,
  parseSupplierInvoiceDocumentSuccess,
} from './admin-supplier-invoice-manager.actions';
import {
  adminSupplierInvoiceManagerReducer,
  initialAdminSupplierInvoiceManagerState,
} from './admin-supplier-invoice-manager.reducer';

describe('adminSupplierInvoiceManagerReducer', () => {
  const listItem = {
    id: 'inv-1',
    supplierId: 'supplier-1',
    status: 'draft',
    currency: 'EUR',
    subtotalNet: 100,
    taxTotal: 19,
    totalGross: 119,
    balanceDue: 119,
    hasUploadedDocument: false,
    createdAt: '2024-01-01',
    canDownload: false,
    canPreview: false,
  };

  it('stores summary on loadAdminSupplierInvoiceSummarySuccess', () => {
    const state = adminSupplierInvoiceManagerReducer(
      { ...initialAdminSupplierInvoiceManagerState, summaryLoading: true },
      loadAdminSupplierInvoiceSummarySuccess({
        summary: {
          totalGross: 500,
          invoiceCount: 3,
          openCount: 1,
          openGross: 100,
          paidCount: 2,
          paidGross: 400,
          draftCount: 0,
          series: [{ period: '2024-01-01', totalGross: 100 }],
          from: '2024-01-01',
          to: '2024-01-31',
          groupBy: 'day',
        },
      }),
    );

    expect(state.summaryLoading).toBe(false);
    expect(state.summary?.totalGross).toBe(500);
  });

  it('sets loading and the requested page on loadAdminSupplierInvoiceManager', () => {
    const state = adminSupplierInvoiceManagerReducer(
      { ...initialAdminSupplierInvoiceManagerState, invoices: [listItem], total: 40 },
      loadAdminSupplierInvoiceManager({ search: 'INV', page: 2 }),
    );

    expect(state.loading).toBe(true);
    expect(state.invoices).toEqual([listItem]);
    expect(state.page).toBe(2);
    expect(state.pageSize).toBe(25);
    expect(state.search).toBe('INV');
  });

  it('stores invoices on loadAdminSupplierInvoiceManagerSuccess', () => {
    const state = adminSupplierInvoiceManagerReducer(
      { ...initialAdminSupplierInvoiceManagerState, loading: true },
      loadAdminSupplierInvoiceManagerSuccess({ invoices: [listItem], total: 26 }),
    );

    expect(state.loading).toBe(false);
    expect(state.invoices).toEqual([listItem]);
    expect(state.total).toBe(26);
  });

  it('stores parse preview on parseSupplierInvoiceDocumentSuccess', () => {
    const state = adminSupplierInvoiceManagerReducer(
      { ...initialAdminSupplierInvoiceManagerState, parsing: true },
      parseSupplierInvoiceDocumentSuccess({
        preview: {
          issueDate: '2024-01-01',
          lineItems: [{ description: 'Hosting', quantity: 1, unitPriceNet: 100 }],
          warnings: [],
        },
      }),
    );

    expect(state.parsing).toBe(false);
    expect(state.parsePreview?.issueDate).toBe('2024-01-01');
  });

  it('upserts invoice on createSupplierInvoiceSuccess', () => {
    const state = adminSupplierInvoiceManagerReducer(
      { ...initialAdminSupplierInvoiceManagerState, creating: true },
      createSupplierInvoiceSuccess({
        invoice: { ...listItem, lineItems: [] },
      }),
    );

    expect(state.creating).toBe(false);
    expect(state.invoices[0].id).toBe('inv-1');
  });
});
