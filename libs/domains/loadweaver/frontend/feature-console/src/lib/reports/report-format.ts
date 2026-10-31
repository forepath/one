import type { AccessMe, Report, ReportStatus } from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcBadgeTone } from '@forepath/shared/frontend/ui-components';

export const REPORT_STATUS_TONE: Record<ReportStatus, FpcBadgeTone> = {
  pending: 'neutral',
  running: 'info',
  completed: 'success',
  failed: 'danger',
};

export function reportStatusLabel(status: ReportStatus): string {
  switch (status) {
    case 'pending':
      return $localize`:@@lwConsoleReports-statusPending:Queued`;
    case 'running':
      return $localize`:@@lwConsoleReports-statusRunning:Running`;
    case 'completed':
      return $localize`:@@lwConsoleReports-statusCompleted:Completed`;
    default:
      return $localize`:@@lwConsoleReports-statusFailed:Failed`;
  }
}

/** `2026-09`. */
export function monthValue(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

/** `2026-09` → year and month; null for anything else. */
export function parseMonth(value: string): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value.trim());

  if (!match) return null;

  const year = Number(match[1]);
  const month = Number(match[2]);

  return month >= 1 && month <= 12 ? { year, month } : null;
}

/** The month that ended last (UTC): reports run for finished months only. */
export function lastFinishedMonth(now = new Date()): { year: number; month: number } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth(); // 0-based: the previous month, 1-based

  return month === 0 ? { year: year - 1, month: 12 } : { year, month };
}

export function isFinishedMonth(year: number, month: number, now = new Date()): boolean {
  return Date.UTC(year, month - 1, 1) < Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1) && year >= 2020;
}

/**
 * Scopes the caller may run reports for: `cluster` and every project for cluster admins, the projects they administer
 * for project admins.
 */
export function runnableScopes(me: AccessMe | null, knownProjects: readonly string[]): string[] {
  if (!me) return [];

  if (me.clusterRole === 'cluster-admin') return ['cluster', ...[...new Set(knownProjects)].sort()];

  return Object.entries(me.projects)
    .filter(([, role]) => role === 'admin')
    .map(([project]) => project)
    .sort();
}

/** The folder of a report's files (`cluster/2026/09`). */
export function reportFolder(report: Report): string | null {
  const path = report.files[0]?.path;

  return path && path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : null;
}

/** The printable page of a report. */
export function reportHtmlPath(report: Report): string | null {
  return report.files.find((f) => f.name === 'report.html')?.path ?? null;
}

export interface PathCrumb {
  label: string;
  path: string;
}

/** `cluster/2026/09` → `cluster`, `cluster/2026`, `cluster/2026/09`. */
export function pathCrumbs(path: string): PathCrumb[] {
  const parts = path.split('/').filter(Boolean);

  return parts.map((label, i) => ({ label, path: parts.slice(0, i + 1).join('/') }));
}

export function parentPath(path: string): string {
  const parts = path.split('/').filter(Boolean);

  return parts.slice(0, -1).join('/');
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * A viewer page for a report: the report runs in a sandboxed frame (no scripts, an opaque origin), so it is never
 * rendered with the console's origin, and the viewer itself allows nothing but inline styles.
 */
export function reportViewerDocument(html: string, title: string): string {
  return [
    '<!doctype html>',
    '<html><head><meta charset="utf-8">',
    `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:">`,
    `<title>${escapeHtml(title)}</title>`,
    '<style>html,body{margin:0;height:100%}iframe{border:0;width:100%;height:100%;display:block}</style>',
    '</head><body>',
    `<iframe sandbox="" title="${escapeHtml(title)}" srcdoc="${escapeHtml(html)}"></iframe>`,
    '</body></html>',
  ].join('');
}

/** A blob's text (`Blob.text()` where the platform has it). */
export function readBlobText(blob: Blob): Promise<string> {
  if (typeof blob.text === 'function') return blob.text();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}
