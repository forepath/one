import {
  fpcBulkSummary,
  fpcCopyIdMenuItem,
  type FpcBulkResult,
  type FpcBulkSummaryLabels,
  type FpcMenuItem,
} from '@forepath/shared/frontend/ui-components';

/**
 * Decabill strings of the one data-list pattern: row-menu entries every table shares and the bulk-action result
 * summary.
 */
export const DB_DL_OPEN = $localize`:@@featureDataList-open:Open`;
export const DB_DL_COPY_ID = $localize`:@@featureDataList-copyId:Copy ID`;
export const DB_DL_DELETE = $localize`:@@featureDataList-delete:Delete`;
export const DB_DL_CANCEL = $localize`:@@featureDataList-cancel:Cancel`;
export const DB_DL_EDIT = $localize`:@@featureDataList-edit:Edit`;
export const DB_DL_CUSTOM_DATA = $localize`:@@featureDataList-customData:Custom data`;
export const DB_DL_TRUST_SCORE = $localize`:@@featureDataList-trustScore:Trust score`;
export const DB_DL_PREVIEW = $localize`:@@featureDataList-preview:Preview`;
export const DB_DL_ISSUE = $localize`:@@featureDataList-issue:Issue`;
export const DB_DL_VOID = $localize`:@@featureDataList-void:Void`;
export const DB_DL_MARK_PAID = $localize`:@@featureDataList-markPaid:Mark paid`;
export const DB_DL_MARK_UNPAID = $localize`:@@featureDataList-markUnpaid:Mark unpaid`;
export const DB_DL_HISTORY = $localize`:@@featureDataList-history:History`;
export const DB_DL_DOWNLOAD = $localize`:@@featureDataList-download:Download`;
export const DB_DL_DOWNLOAD_PDF = $localize`:@@featureDataList-downloadPdf:Download PDF`;
export const DB_DL_TIME_REPORT = $localize`:@@featureDataList-timeReport:Time report`;
export const DB_DL_VOID_PDF = $localize`:@@featureDataList-voidPdf:Void PDF`;
export const DB_DL_CREDIT_NOTE = $localize`:@@featureDataList-creditNote:Credit note`;
export const DB_DL_ARCHIVE = $localize`:@@featureDataList-archive:Archive`;
export const DB_DL_PAY = $localize`:@@featureDataList-pay:Pay`;
export const DB_DL_SEND = $localize`:@@featureDataList-send:Send`;
/** Cancel (terminate) a subscription; DB_DL_CANCEL is "abort". */
export const DB_DL_CANCEL_SUBSCRIPTION = $localize`:@@featureDataList-cancelSubscription:Cancel`;
export const DB_DL_CANCEL_NOW = $localize`:@@featureDataList-cancelNow:Cancel now`;
export const DB_DL_RESUME = $localize`:@@featureDataList-resume:Resume`;
export const DB_DL_WITHDRAW = $localize`:@@featureDataList-withdraw:Withdraw`;
export const DB_DL_METERS = $localize`:@@featureDataList-meters:Meters`;
export const DB_DL_CHANGE_PLAN = $localize`:@@featureDataList-changePlan:Change plan`;
export const DB_DL_RETRY = $localize`:@@featureDataList-retry:Retry`;
export const DB_DL_START = $localize`:@@featureDataList-start:Start`;
export const DB_DL_STOP = $localize`:@@featureDataList-stop:Stop`;
export const DB_DL_RESTART = $localize`:@@featureDataList-restart:Restart`;
export const DB_DL_CONSOLE = $localize`:@@featureDataList-console:Console`;
export const DB_DL_SSH_KEY = $localize`:@@featureDataList-sshKey:SSH key`;

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
