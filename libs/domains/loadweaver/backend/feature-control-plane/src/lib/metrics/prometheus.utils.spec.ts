import { prometheusName, prometheusText } from './prometheus.utils';

describe('prometheus exposition', () => {
  const time = new Date('2026-10-18T12:00:00Z');

  it('names metrics', () => {
    expect(prometheusName('ingress.latency_p95_ms')).toBe('loadweaver_ingress_latency_p95_ms');
  });

  it('writes one gauge per metric with escaped labels and timestamps', () => {
    expect(
      prometheusText([
        { metric: 'replica.cpu_cores', node: 'n1', entity: 'shop/site/web/0', project: 'shop', value: 0.5, time },
        { metric: 'node.cpu_cores', node: 'n1', entity: 'node', project: null, value: 1.25, time },
        { metric: 'node.cpu_cores', node: 'n2', entity: 'a"b\\c\nd', project: null, value: 2, time },
        { metric: 'node.cpu_cores', node: 'n3', entity: 'node', project: null, value: Number.NaN, time },
      ]),
    ).toBe(
      [
        '# TYPE loadweaver_node_cpu_cores gauge',
        `loadweaver_node_cpu_cores{node="n1",entity="node"} 1.25 ${time.getTime()}`,
        `loadweaver_node_cpu_cores{node="n2",entity="a\\"b\\\\c\\nd"} 2 ${time.getTime()}`,
        '# TYPE loadweaver_replica_cpu_cores gauge',
        `loadweaver_replica_cpu_cores{node="n1",entity="shop/site/web/0",project="shop"} 0.5 ${time.getTime()}`,
        '',
      ].join('\n'),
    );
    expect(prometheusText([])).toBe('');
  });

  it('keeps one TYPE line when names collide, telling the metrics apart', () => {
    const text = prometheusText([
      { metric: 'a.b_c', node: 'n1', entity: 'e', project: null, value: 1, time },
      { metric: 'a_b.c', node: 'n1', entity: 'e', project: null, value: 2, time },
    ]);

    expect(text.match(/# TYPE/g)).toHaveLength(1);
    expect(text).toContain('loadweaver_a_b_c{node="n1",entity="e",metric="a_b.c"} 2');
  });
});
