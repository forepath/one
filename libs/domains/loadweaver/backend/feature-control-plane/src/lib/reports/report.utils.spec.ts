import { listTree, normalizeFilePath } from './reports.service';
import { daysUntil, linearTrend, previousMonth, renderReportHtml, reportKey, type ReportData } from './report.utils';

describe('reports', () => {
  it('fits a trend and forecasts when it crosses a limit', () => {
    expect(linearTrend([1, 2, 3])).toEqual({ slope: 1, intercept: 1 });
    expect(daysUntil([10, 20, 30], 60)).toBe(3);
    expect(daysUntil([30, 20, 10], 60)).toBeNull();
    expect(daysUntil([70, 80], 60)).toBeNull();
    expect(daysUntil([5], 60)).toBeNull();
  });

  it('names keys and periods', () => {
    expect(reportKey('cluster', 2026, 9, 'report.html')).toBe('cluster/2026/09/report.html');
    expect(reportKey('shop', 2026, 10, 'report.json')).toBe('projects/shop/2026/10/report.json');
    expect(previousMonth(new Date('2026-01-01T03:00:00Z'))).toEqual({ year: 2025, month: 12 });
    expect(previousMonth(new Date('2026-10-01T03:00:00Z'))).toEqual({ year: 2026, month: 9 });
  });

  it('renders escaped, script-free HTML', () => {
    const data: ReportData = {
      scope: 'shop',
      period: { year: 2026, month: 9, from: '2026-09-01T00:00:00.000Z', to: '2026-10-01T00:00:00.000Z' },
      generatedAt: '2026-10-01T03:00:00.000Z',
      health: { healthy: 99.5, degraded: 0.5 },
      services: [{ service: 'shop/store/web', availability: 99.95, target: 99.9 }],
      incidents: [{ title: '<img onerror=x>', status: 'resolved', createdAt: 'a', resolvedAt: 'b' }],
      events: { applies: 3, rollbacks: 1, failedRollbacks: 0, healthChanges: 2 },
      usage: { cpuMillis: 1500, memoryBytes: 2 * 1024 ** 3, storageBytes: 0 },
      notYet: ['upgrades'],
    };
    const html = renderReportHtml(data);

    expect(html).toContain('Loadweaver report project shop 2026-09');
    expect(html).toContain('99.950 %');
    expect(html).toContain('&lt;img onerror=x&gt;');
    expect(html).toContain('1.50 CPUs, 2.0 GiB memory');
    expect(html).not.toMatch(/<script|<img/);
  });

  it('builds the file tree from recorded paths and rejects traversal', () => {
    const files = [
      { path: 'cluster/2026/09/report.html', bytes: 10 },
      { path: 'cluster/2026/09/report.json', bytes: 20 },
      { path: 'projects/shop/2026/09/report.html', bytes: 5 },
    ];

    expect(listTree(files, '')).toEqual([
      { name: 'cluster', path: 'cluster', type: 'folder' },
      { name: 'projects', path: 'projects', type: 'folder' },
    ]);
    expect(listTree(files, 'cluster/2026/09').map((e) => [e.name, e.type, e.bytes])).toEqual([
      ['report.html', 'file', 10],
      ['report.json', 'file', 20],
    ]);
    expect(normalizeFilePath('/cluster/2026/')).toBe('cluster/2026');
    expect(() => normalizeFilePath('cluster/../secrets')).toThrow('invalid path');
    expect(() => normalizeFilePath('a\0b')).toThrow('invalid path');
  });
});
