/** Default page size of the paged billing lists (one data-list pattern: 25 / 50 / 100, replace-page). */
export const BILLING_LIST_PAGE_SIZE = 25;

/** `limit` / `offset` for a 1-based page. */
export function billingPageWindow(
  page?: number,
  pageSize?: number,
): { page: number; pageSize: number; limit: number; offset: number } {
  const size = pageSize && pageSize > 0 ? Math.floor(pageSize) : BILLING_LIST_PAGE_SIZE;
  const current = page && page > 0 ? Math.floor(page) : 1;

  return { page: current, pageSize: size, limit: size, offset: (current - 1) * size };
}
