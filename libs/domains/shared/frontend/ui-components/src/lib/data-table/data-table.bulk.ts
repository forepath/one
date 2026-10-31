import type { FpcMenuItem } from '../menu/menu.types';

/** Outcome of one item of a bulk action (3.38 D8). */
export type FpcBulkOutcome = 'succeeded' | 'denied' | 'failed';

export interface FpcBulkItemResult<T> {
  item: T;
  outcome: FpcBulkOutcome;
  /** Server message (failed / denied). */
  error?: string;
}

export interface FpcBulkResult<T> {
  results: FpcBulkItemResult<T>[];
  succeeded: T[];
  denied: T[];
  failed: T[];
}

/** An HTTP error the server raised because the caller may not change this item (never counted as success). */
export function fpcIsDenied(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;

  return status === 401 || status === 403;
}

function messageOf(error: unknown): string | undefined {
  const body = (error as { error?: { message?: unknown } } | null)?.error;
  const message = body?.message ?? (error as { message?: unknown } | null)?.message;

  return Array.isArray(message) ? message.join(', ') : typeof message === 'string' ? message : undefined;
}

/**
 * Bulk action as a client fan-out over the single-item endpoints (3.38 D8): every item runs through `run` (the same
 * call — and so the same server-side authorization — as the row action), at most `concurrency` at a time, and is
 * reported individually: `succeeded`, `denied` (401 / 403) or `failed`. Nothing is skipped or assumed: an item counts
 * as succeeded only when its own call resolved.
 */
export async function fpcRunBulk<T>(
  items: readonly T[],
  run: (item: T) => Promise<unknown>,
  concurrency = 4,
): Promise<FpcBulkResult<T>> {
  const results: FpcBulkItemResult<T>[] = new Array(items.length);
  let next = 0;

  const worker = async (): Promise<void> => {
    while (next < items.length) {
      const index = next++;
      const item = items[index];

      try {
        await run(item);
        results[index] = { item, outcome: 'succeeded' };
      } catch (error) {
        results[index] = { item, outcome: fpcIsDenied(error) ? 'denied' : 'failed', error: messageOf(error) };
      }
    }
  };

  await Promise.all(Array.from({ length: Math.max(1, Math.min(concurrency, items.length)) }, worker));

  return {
    results,
    succeeded: results.filter((r) => r.outcome === 'succeeded').map((r) => r.item),
    denied: results.filter((r) => r.outcome === 'denied').map((r) => r.item),
    failed: results.filter((r) => r.outcome === 'failed').map((r) => r.item),
  };
}

export interface FpcBulkSummaryLabels {
  /** `{count}` */
  succeeded: string;
  /** `{count}` */
  denied: string;
  /** `{count}` */
  failed: string;
}

export const FPC_BULK_SUMMARY_LABELS: FpcBulkSummaryLabels = {
  succeeded: '{count} done',
  denied: '{count} not allowed',
  failed: '{count} failed',
};

/** "3 done · 1 not allowed · 1 failed: name (message)" for the page's result alert. */
export function fpcBulkSummary<T>(
  result: FpcBulkResult<T>,
  name: (item: T) => string,
  labels: FpcBulkSummaryLabels = FPC_BULK_SUMMARY_LABELS,
): { tone: 'success' | 'warning' | 'danger'; message: string } {
  const parts: string[] = [];
  const count = (template: string, n: number) => template.replace('{count}', String(n));

  if (result.succeeded.length) parts.push(count(labels.succeeded, result.succeeded.length));
  if (result.denied.length) parts.push(count(labels.denied, result.denied.length));
  if (result.failed.length) parts.push(count(labels.failed, result.failed.length));

  const problems = result.results
    .filter((r) => r.outcome !== 'succeeded')
    .slice(0, 5)
    .map((r) => (r.error ? `${name(r.item)} (${r.error})` : name(r.item)));
  const tone =
    result.failed.length || result.denied.length ? (result.succeeded.length ? 'warning' : 'danger') : 'success';

  return { tone, message: parts.join(' · ') + (problems.length ? `: ${problems.join(', ')}` : '') };
}

/** ⋮ entry "Copy ID" (3.38 D11: ids are never shown as data, only copied on request). */
export function fpcCopyIdMenuItem(label = 'Copy ID'): FpcMenuItem {
  return { id: 'copy-id', label, icon: 'clipboard', dividerBefore: true };
}

/** Copies text to the clipboard (no-op where the API is missing). */
export function fpcCopyText(text: string): void {
  void globalThis.navigator?.clipboard?.writeText(text).catch(() => undefined);
}
