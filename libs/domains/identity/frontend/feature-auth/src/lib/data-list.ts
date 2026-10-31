import {
  fpcBulkSummary,
  fpcCopyIdMenuItem,
  type FpcBulkResult,
  type FpcBulkSummaryLabels,
  type FpcMenuItem,
} from '@forepath/shared/frontend/ui-components';

/**
 * Strings of the one data-list pattern (3.38 D1, D8, D11) for the identity managers (user / token manager): row-menu
 * entries and the bulk-action result summary. The `sharedDataList-*` ids are shared by the shared managers of
 * every app (same id, same text).
 */
export const SHARED_DL_COPY_ID = $localize`:@@sharedDataList-copyId:Copy ID`;
export const SHARED_DL_DELETE = $localize`:@@sharedDataList-delete:Delete`;

export const SHARED_DL_BULK_LABELS: FpcBulkSummaryLabels = {
  succeeded: $localize`:@@sharedDataList-bulkSucceeded:{count} done`,
  denied: $localize`:@@sharedDataList-bulkDenied:{count} not allowed`,
  failed: $localize`:@@sharedDataList-bulkFailed:{count} failed`,
};

/** ⋮ "Copy ID" (ids are never shown as data, D11). */
export function sharedCopyIdItem(): FpcMenuItem {
  return fpcCopyIdMenuItem(SHARED_DL_COPY_ID);
}

/** The page's result alert after a bulk action. */
export function sharedBulkSummary<T>(result: FpcBulkResult<T>, name: (item: T) => string) {
  return fpcBulkSummary(result, name, SHARED_DL_BULK_LABELS);
}
