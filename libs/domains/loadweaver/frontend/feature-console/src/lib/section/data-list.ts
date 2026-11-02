import {
  fpcBulkSummary,
  fpcCopyIdMenuItem,
  type FpcBulkResult,
  type FpcBulkSummaryLabels,
  type FpcMenuItem,
} from '@forepath/shared/frontend/ui-components';

/**
 * Loadweaver strings of the one data-list pattern (3.38 D1, D8, D11): row-menu entries every table shares and the
 * bulk-action result summary.
 */
export const DL_OPEN = $localize`:@@lwConsoleDataList-open:Open`;
export const DL_COPY_ID = $localize`:@@lwConsoleDataList-copyId:Copy ID`;
export const DL_DELETE = $localize`:@@lwConsoleDataList-delete:Delete`;

export const DL_BULK_LABELS: FpcBulkSummaryLabels = {
  succeeded: $localize`:@@lwConsoleDataList-bulkSucceeded:{count} done`,
  denied: $localize`:@@lwConsoleDataList-bulkDenied:{count} not allowed`,
  failed: $localize`:@@lwConsoleDataList-bulkFailed:{count} failed`,
};

/** ⋮ "Open" (the row's primary action, also on click). */
export function dlOpenItem(): FpcMenuItem {
  return { id: 'open', label: DL_OPEN, icon: 'box-arrow-up-right' };
}

/** ⋮ "Copy ID" (ids are never shown as data, D11). */
export function dlCopyIdItem(): FpcMenuItem {
  return fpcCopyIdMenuItem(DL_COPY_ID);
}

/** The page's result alert after a bulk action. */
export function dlBulkSummary<T>(result: FpcBulkResult<T>, name: (item: T) => string) {
  return fpcBulkSummary(result, name, DL_BULK_LABELS);
}

export const DL_DELETED_USER = $localize`:@@lwConsoleDataList-deletedUser:Deleted user`;
export const DL_FLEET_USER = $localize`:@@lwConsoleDataList-fleetUser:Fleet user`;
export const DL_API_KEY = $localize`:@@lwConsoleDataList-apiKey:API key`;
export const DL_SYSTEM = $localize`:@@lwConsoleDataList-system:System`;

/** A platform user id as the control plane stores creators / requesters / approvers (`<uuid>` or `user:<uuid>`). */
const USER_ID = /^(?:user:)?[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Who did something, readable (D11, no raw ids): the email the API resolved server-side (like Agenstra / Decabill);
 * a user id without one is a deleted user, a fleet person without a verified email "Fleet user"; the actor keywords
 * (`api-key`, `system`) localized; other non-user actors (`git`, `policy`, …) as they are. Empty for no actor.
 */
export function dlUserLabel(id: string | null | undefined, email?: string | null): string {
  if (email) return email;

  if (!id) return '';

  if (USER_ID.test(id)) return DL_DELETED_USER;

  if (id.startsWith('fleet:')) return DL_FLEET_USER;

  if (id === 'api-key') return DL_API_KEY;

  if (id === 'system') return DL_SYSTEM;

  return id;
}
