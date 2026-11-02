import { alertRuleSpecSchema, clusterObservabilitySchema, dashboardSpecSchema, durationMs } from './observability';

describe('observability resources', () => {
  it('parses durations', () => {
    expect(durationMs('30s')).toBe(30_000);
    expect(durationMs('2h')).toBe(7_200_000);
    expect(durationMs('soon')).toBe(0);
  });

  it('defaults alert rules and accepts rate-of-change and escalation', () => {
    const rule = alertRuleSpecSchema.parse({
      condition: { metric: { name: 'node.disk_bytes', mode: 'change', op: '>', threshold: 1e9 } },
      escalate: { after: '30m', emails: ['oncall@example.com'] },
    });

    expect(rule).toMatchObject({ severity: 'warning', for: '0s', repeatEvery: '4h', notify: { webhooks: true } });
    expect(
      alertRuleSpecSchema.safeParse({ condition: { metric: { name: 'x', op: '!=', threshold: 1 } } }).success,
    ).toBe(false);
  });

  it('validates SIEM targets by type', () => {
    const ok = (siem: unknown[]) => clusterObservabilitySchema.safeParse({ siem }).success;

    expect(ok([{ name: 'soc', type: 'syslog', url: 'tls://siem.example.com:6514', sources: ['audit'] }])).toBe(true);
    expect(
      ok([
        {
          name: 'otel',
          type: 'otlp',
          url: 'https://otel.example.com/v1/logs',
          sources: ['container'],
          credentials: 'secret://ops/otel',
        },
      ]),
    ).toBe(true);
    expect(ok([{ name: 'soc', type: 'syslog', url: 'https://siem.example.com', sources: ['audit'] }])).toBe(false);
    expect(ok([{ name: 'soc', type: 'syslog', url: 'tcp://siem.example.com', sources: ['audit'] }])).toBe(false);
    expect(
      ok([{ name: 'soc', type: 'syslog', url: 'tcp://siem:514', sources: ['audit'], credentials: 'secret://ops/x' }]),
    ).toBe(false);
    expect(ok([{ name: 'hook', type: 'webhook', url: 'ftp://x', sources: ['audit'] }])).toBe(false);
    expect(
      ok([
        { name: 'a', type: 'webhook', url: 'https://x', sources: ['audit'] },
        { name: 'a', type: 'webhook', url: 'https://y', sources: ['audit'] },
      ]),
    ).toBe(false);
  });

  it('lays dashboard widgets out on 12 columns with matching query kinds', () => {
    const widget = { title: 'CPU', type: 'line', query: { metrics: { metric: 'node.cpu_cores' } } };

    expect(dashboardSpecSchema.parse({ title: 'D', widgets: [widget] }).widgets[0]).toMatchObject({
      x: 0,
      w: 6,
      query: { metrics: { aggregation: 'avg', groupBy: 'entity' } },
    });
    expect(dashboardSpecSchema.safeParse({ title: 'D', widgets: [{ ...widget, x: 8, w: 6 }] }).success).toBe(false);
    expect(dashboardSpecSchema.safeParse({ title: 'D', widgets: [{ ...widget, type: 'logs' }] }).success).toBe(false);
    expect(
      dashboardSpecSchema.safeParse({
        title: 'D',
        widgets: [{ title: 'Errors', type: 'logs', query: { logs: { levels: ['error'] } } }],
      }).success,
    ).toBe(true);
  });
});
