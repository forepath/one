import {
  fpcBulkSummary,
  fpcCopyIdMenuItem,
  type FpcBulkResult,
  type FpcBulkSummaryLabels,
  type FpcMenuItem,
} from '@forepath/shared/frontend/ui-components';

/**
 * Decabill strings of the one data-list pattern: row-menu entries every table shares and the bulk-action result
 * summary (mirrors Loadweaver's `section/data-list.ts`).
 */
export const DB_DL_OPEN = $localize`:@@featureDataList-open:Open`;
export const DB_DL_COPY_ID = $localize`:@@featureDataList-copyId:Copy ID`;
export const DB_DL_DELETE = $localize`:@@featureDataList-delete:Delete`;
export const DB_DL_CANCEL = $localize`:@@featureDataList-cancel:Cancel`;

export const DB_DL_BULK_LABELS: FpcBulkSummaryLabels = {
  succeeded: $localize`:@@featureDataList-bulkSucceeded:{count} done`,
  denied: $localize`:@@featureDataList-bulkDenied:{count} not allowed`,
  failed: $localize`:@@featureDataList-bulkFailed:{count} failed`,
};

/** Result alert of a bulk action (page-level, dismissible). */
export type DbBulkResult = { tone: 'success' | 'warning' | 'danger'; message: string };

/** ⋮ "Open" (the row's primary action, also on click). */
export function dbOpenItem(): FpcMenuItem {
  return { id: 'open', label: DB_DL_OPEN, icon: 'box-arrow-up-right' };
}

/** ⋮ "Copy ID" (ids are never shown as data). */
export function dbCopyIdItem(): FpcMenuItem {
  return fpcCopyIdMenuItem(DB_DL_COPY_ID);
}

/** The page's result alert after a bulk action. */
export function dbBulkSummary<T>(result: FpcBulkResult<T>, name: (item: T) => string): DbBulkResult {
  return fpcBulkSummary(result, name, DB_DL_BULK_LABELS);
}
