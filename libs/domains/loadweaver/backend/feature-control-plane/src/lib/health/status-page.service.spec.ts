import { overallState, publicState, renderStatusPage } from './status-page.service';

describe('status pages', () => {
  it('shows internal health as public states', () => {
    expect(
      ['healthy', 'at-risk', 'degraded', 'failed', 'unknown', undefined].map((s) => publicState(s as never)),
    ).toEqual(['operational', 'operational', 'degraded', 'outage', 'unknown', 'unknown']);
    expect(overallState(['operational', 'degraded', 'unknown'])).toBe('degraded');
    expect(overallState([])).toBe('operational');
  });

  it('renders escaped HTML without scripts', () => {
    const html = renderStatusPage({
      title: 'Shop <status>',
      status: 'degraded',
      services: [
        { name: 'Checkout', status: 'degraded', uptime: 99.512 },
        { name: 'API "v2"', status: 'operational' },
      ],
      incidents: [
        {
          title: 'Slow <b>checkout</b>',
          status: 'identified',
          updates: [{ at: '2026-10-18T12:00:00.000Z', status: 'identified', message: '<script>alert(1)</script>' }],
          resolvedAt: null,
        },
      ],
      updatedAt: '2026-10-18T12:01:00.000Z',
    });

    expect(html).toContain('<title>Shop &lt;status&gt;</title>');
    expect(html).toContain('Degraded performance · 99.51 % this month');
    expect(html).toContain('API &quot;v2&quot;');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).not.toContain('<script');
  });
});
