import type { Report } from '@forepath/loadweaver/frontend/data-access-console';

import {
  isFinishedMonth,
  lastFinishedMonth,
  monthValue,
  parentPath,
  parseMonth,
  pathCrumbs,
  reportFolder,
  reportHtmlPath,
  reportViewerDocument,
  runnableScopes,
} from './report-format';

const report: Report = {
  id: 'r1',
  scope: 'shop',
  year: 2026,
  month: 9,
  status: 'completed',
  files: [
    { name: 'report.json', path: 'projects/shop/2026/09/report.json', bytes: 10, sha256: 'a' },
    { name: 'report.html', path: 'projects/shop/2026/09/report.html', bytes: 20, sha256: 'b' },
  ],
  error: null,
  completedAt: null,
};

describe('report format', () => {
  it('works with finished months', () => {
    const now = new Date('2026-10-18T10:00:00Z');

    expect(lastFinishedMonth(now)).toEqual({ year: 2026, month: 9 });
    expect(lastFinishedMonth(new Date('2026-01-05T00:00:00Z'))).toEqual({ year: 2025, month: 12 });
    expect(isFinishedMonth(2026, 9, now)).toBe(true);
    expect(isFinishedMonth(2026, 10, now)).toBe(false);
    expect(monthValue(2026, 9)).toBe('2026-09');
    expect(parseMonth('2026-09')).toEqual({ year: 2026, month: 9 });
    expect(parseMonth('2026-13')).toBeNull();
    expect(parseMonth('')).toBeNull();
  });

  it('knows who may run which scope', () => {
    expect(
      runnableScopes({ userId: 'a', clusterRole: 'cluster-admin', projects: {} }, ['shop', 'blog', 'shop']),
    ).toEqual(['cluster', 'blog', 'shop']);
    expect(
      runnableScopes({ userId: 'u', clusterRole: 'auditor', projects: { shop: 'admin', blog: 'operator' } }, ['x']),
    ).toEqual(['shop']);
    expect(runnableScopes(null, [])).toEqual([]);
  });

  it('finds the folder and the page of a report and walks paths', () => {
    expect(reportFolder(report)).toBe('projects/shop/2026/09');
    expect(reportHtmlPath(report)).toBe('projects/shop/2026/09/report.html');
    expect(pathCrumbs('cluster/2026/09')).toEqual([
      { label: 'cluster', path: 'cluster' },
      { label: '2026', path: 'cluster/2026' },
      { label: '09', path: 'cluster/2026/09' },
    ]);
    expect(parentPath('cluster/2026')).toBe('cluster');
    expect(parentPath('cluster')).toBe('');
  });

  it('puts the report into a sandboxed frame', () => {
    const doc = reportViewerDocument('<p class="x">A & "B"</p>', 'Report <shop>');

    expect(doc).toContain('sandbox=""');
    expect(doc).toContain('srcdoc="&lt;p class=&quot;x&quot;&gt;A &amp; &quot;B&quot;&lt;/p&gt;"');
    expect(doc).toContain('<title>Report &lt;shop&gt;</title>');
    expect(doc).not.toContain('<p class="x">');
  });
});
