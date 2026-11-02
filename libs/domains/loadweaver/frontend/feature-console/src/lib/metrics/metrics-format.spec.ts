import {
  durationMs,
  escapeChartText,
  formatMetricValue,
  metricChartOptions,
  metricLabel,
  metricUnit,
  overviewMetrics,
  statValue,
  summaryValue,
  workloadMetricsEntity,
} from './metrics-format';

describe('metrics format', () => {
  it('builds the replica entity prefix of a workload, nothing for missing or unsafe names', () => {
    expect(workloadMetricsEntity('shop', 'site')).toBe('shop/site/*');
    expect(workloadMetricsEntity('shop', 'site', 'web')).toBe('shop/site/web/*');
    expect(workloadMetricsEntity('shop', 'lw-vm', 'db1')).toBe('shop/lw-vm/db1/*');
    expect(workloadMetricsEntity(undefined, 'site', 'web')).toBe('');
    expect(workloadMetricsEntity('', 'site')).toBe('');
    expect(workloadMetricsEntity('shop', '*')).toBe('');
    expect(workloadMetricsEntity('shop', 'a/b')).toBe('');
    expect(workloadMetricsEntity('shop', 'site', '')).toBe('');
  });

  it('reads durations and units', () => {
    expect(durationMs('6h')).toBe(6 * 3_600_000);
    expect(durationMs('30s')).toBe(30_000);
    expect(durationMs('soon')).toBe(0);
    expect(metricUnit('replica.memory_bytes')).toBe('bytes');
    expect(metricUnit('net.rx_bytes_per_s')).toBe('bytes/s');
    expect(metricUnit('ingress.latency_p95_ms')).toBe('ms');
    expect(metricUnit('ingress.requests_per_s')).toBe('/s');
    expect(metricUnit('wg.handshake_age_s')).toBe('s');
    expect(metricUnit('node.containers')).toBeUndefined();
  });

  it('formats values with their unit', () => {
    expect(formatMetricValue(1536, 'bytes')).toBe('1.5 KiB');
    expect(formatMetricValue(2048, 'bytes/s')).toBe('2.0 KiB/s');
    expect(formatMetricValue(0.256, 'cores')).toBe('0.26 cores');
    expect(formatMetricValue(null)).toBe('–');
  });

  it('sums the newest values for a stat', () => {
    expect(
      statValue([
        {
          key: 'a',
          points: [
            ['t1', 1],
            ['t2', 2],
          ],
        },
        { key: 'b', points: [['t1', 5]] },
        { key: 'c', points: [] },
      ]),
    ).toBe(7);
    expect(statValue([])).toBeNull();
  });

  it('builds datetime series with event markers', () => {
    const options = metricChartOptions('area', [{ key: 'a', points: [['2026-10-18T08:00:00.000Z', 3]] }], {
      events: [
        { id: 'e', time: '2026-10-18T08:05:00.000Z', kind: 'plan.applied', entity: 'p', project: null, message: '' },
      ],
    });

    expect(options.series).toEqual([{ name: 'a', data: [[Date.parse('2026-10-18T08:00:00.000Z'), 3]] }]);
    expect(options.chart.type).toBe('area');
    expect(options.annotations.xaxis[0]).toMatchObject({ x: Date.parse('2026-10-18T08:05:00.000Z') });
  });

  it('escapes chart text for ApexCharts innerHTML', () => {
    expect(escapeChartText(`<img src=x onerror="alert('1')">&`)).toBe(
      '&lt;img src=x onerror=&quot;alert(&#39;1&#39;)&quot;&gt;&amp;',
    );
    expect(escapeChartText(null)).toBe('');
    expect(escapeChartText(3)).toBe('3');
  });

  it('escapes series names and tooltip values from API data', () => {
    const options = metricChartOptions(
      'line',
      [{ key: '{pod="<img src=x onerror=alert(1)>"}', points: [['2026-10-18T08:00:00.000Z', 3]] }],
      { unit: '<b>u</b>' },
    );

    expect(options.series[0].name).toBe('{pod=&quot;&lt;img src=x onerror=alert(1)&gt;&quot;}');
    expect(options.tooltip.y.formatter(3)).toBe('3 &lt;b&gt;u&lt;/b&gt;');
    // Axis labels are SVG text: not escaped.
    expect(options.yaxis.labels.formatter(3)).toBe('3 <b>u</b>');
  });

  it('builds the overview: catalog order, unknown names under Other, metering counters left out', () => {
    const defs = overviewMetrics(['zz.custom', 'replica.cpu_seconds', 'ingress.requests_per_s', 'node.cpu_cores']);

    expect(defs.map((d) => [d.metric, d.category])).toEqual([
      ['node.cpu_cores', 'nodes'],
      ['ingress.requests_per_s', 'ingress'],
      ['zz.custom', 'other'],
    ]);
    expect(metricLabel('ingress.latency_p95_ms')).toBe('Latency p95');
    expect(metricLabel('zz.custom')).toBe('zz.custom');
    expect(formatMetricValue(0.125, 'ratio')).toBe('12.5 %');
    expect(
      summaryValue(
        [
          { key: 'a', points: [['t', 40]] },
          { key: 'b', points: [['t', 90]] },
        ],
        'max',
      ),
    ).toBe(90);
  });
});
