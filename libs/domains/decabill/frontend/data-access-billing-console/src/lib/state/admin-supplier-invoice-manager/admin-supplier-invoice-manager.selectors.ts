import { createFeatureSelector, createSelector } from '@ngrx/store';

import type { AdminSupplierInvoiceManagerState } from './admin-supplier-invoice-manager.reducer';

export const selectAdminSupplierInvoiceManagerState =
  createFeatureSelector<AdminSupplierInvoiceManagerState>('adminSupplierInvoiceManager');

export const selectAdminSupplierInvoiceSummary = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.summary,
);

export const selectAdminSupplierInvoiceSummaryLoading = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.summaryLoading,
);

export const selectAdminSupplierInvoiceSummaryError = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.summaryError,
);

export const selectAdminSupplierInvoiceManagerInvoices = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.invoices,
);

export const selectAdminSupplierInvoiceManagerLoading = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.loading,
);

export const selectAdminSupplierInvoiceManagerCreating = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.creating,
);

export const selectAdminSupplierInvoiceManagerUpdating = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.updating,
);

export const selectAdminSupplierInvoiceManagerIssuing = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.issuing,
);

export const selectAdminSupplierInvoiceManagerDeleting = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.deleting,
);

export const selectAdminSupplierInvoiceManagerParsing = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.parsing,
);

export const selectAdminSupplierInvoiceParsePreview = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.parsePreview,
);

export const selectAdminSupplierInvoiceParseError = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.parseError,
);

export const selectAdminSupplierInvoiceManagerActionLoading = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.actionLoading,
);

export const selectAdminSupplierInvoiceManagerError = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.error,
);

export const selectAdminSupplierInvoiceManagerTotal = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.total,
);

export const selectAdminSupplierInvoiceManagerPage = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.page,
);

export const selectAdminSupplierInvoiceManagerPageSize = createSelector(
  selectAdminSupplierInvoiceManagerState,
  (state) => state.pageSize,
);
