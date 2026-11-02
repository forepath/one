import {
  fpcBulkSummary,
  fpcCopyIdMenuItem,
  type FpcBulkResult,
  type FpcBulkSummaryLabels,
  type FpcMenuItem,
} from '@forepath/shared/frontend/ui-components';

/**
 * Agenstra strings of the one data-list pattern (3.38 D1, D8, D11): row-menu entries every table shares and the
 * bulk-action result summary.
 */
export const AG_DL_OPEN = $localize`:@@featureAgentConsoleDataList-open:Open`;
export const AG_DL_COPY_ID = $localize`:@@featureAgentConsoleDataList-copyId:Copy ID`;
export const AG_DL_DELETE = $localize`:@@featureAgentConsoleDataList-delete:Delete`;
export const AG_DL_CANCEL = $localize`:@@featureAgentConsoleDataList-cancel:Cancel`;
export const AG_DL_CLOSE = $localize`:@@featureAgentConsoleDataList-close:Close`;
export const AG_DL_EDIT = $localize`:@@featureAgentConsoleDataList-edit:Edit`;
export const AG_DL_USERS = $localize`:@@featureAgentConsoleDataList-users:Users`;
export const AG_DL_CONFIGURATION = $localize`:@@featureAgentConsoleDataList-configuration:Configuration`;
export const AG_DL_AGENT_CONFIGURATION = $localize`:@@featureAgentConsoleDataList-agentConfiguration:Agent configuration`;
export const AG_DL_VARIABLES = $localize`:@@featureAgentConsoleDataList-variables:Variables`;
export const AG_DL_AUTONOMY = $localize`:@@featureAgentConsoleDataList-autonomy:Autonomy`;
export const AG_DL_RUN_NOW = $localize`:@@featureAgentConsoleDataList-runNow:Run now`;
export const AG_DL_TEST = $localize`:@@featureAgentConsoleDataList-test:Test`;
export const AG_DL_CLEAR_MARKERS = $localize`:@@featureAgentConsoleDataList-clearMarkers:Clear markers`;
export const AG_DL_CHAT = $localize`:@@featureAgentConsoleDataList-chat:Chat`;
export const AG_DL_LOGS = $localize`:@@featureAgentConsoleDataList-logs:Logs`;
export const AG_DL_SWITCH = $localize`:@@featureAgentConsoleDataList-switch:Switch`;
export const AG_DL_CHECK_OUT = $localize`:@@featureAgentConsoleDataList-checkOut:Check out`;

export const AG_DL_BULK_LABELS: FpcBulkSummaryLabels = {
  succeeded: $localize`:@@featureAgentConsoleDataList-bulkSucceeded:{count} done`,
  denied: $localize`:@@featureAgentConsoleDataList-bulkDenied:{count} not allowed`,
  failed: $localize`:@@featureAgentConsoleDataList-bulkFailed:{count} failed`,
};

/** ⋮ "Open" (the row's primary action, also on click). */
export function agOpenItem(): FpcMenuItem {
  return { id: 'open', label: AG_DL_OPEN, icon: 'box-arrow-up-right' };
}

/** ⋮ "Copy ID" (ids are never shown as data, D11). */
export function agCopyIdItem(): FpcMenuItem {
  return fpcCopyIdMenuItem(AG_DL_COPY_ID);
}

/** The page's result alert after a bulk action. */
export function agBulkSummary<T>(result: FpcBulkResult<T>, name: (item: T) => string) {
  return fpcBulkSummary(result, name, AG_DL_BULK_LABELS);
}
