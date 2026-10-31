export interface LatestSample {
  metric: string;
  node: string;
  entity: string;
  project: string | null;
  value: number;
  time: Date;
}

/** `node.cpu_cores` → `loadweaver_node_cpu_cores` (Prometheus metric names: letters, digits, underscores). */
export function prometheusName(metric: string): string {
  return `loadweaver_${metric.replace(/[^a-zA-Z0-9_]/g, '_')}`;
}

function labelValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

/**
 * Prometheus text exposition (version 0.0.4) of the latest sample per series: every metric a gauge, labelled with
 * node, entity and project, with the sample's own timestamp.
 */
export function prometheusText(samples: readonly LatestSample[]): string {
  // Grouped by the exposed name, so metrics mapping to the same name share one `# TYPE` line.
  const byName = new Map<string, LatestSample[]>();

  for (const s of samples) {
    const name = prometheusName(s.metric);
    const group = byName.get(name);

    if (group) group.push(s);
    else byName.set(name, [s]);
  }

  const lines: string[] = [];

  for (const [name, series] of [...byName].sort(([a], [b]) => a.localeCompare(b))) {
    lines.push(`# TYPE ${name} gauge`);

    for (const s of series) {
      if (!Number.isFinite(s.value)) continue;

      const labels = [
        `node="${labelValue(s.node)}"`,
        `entity="${labelValue(s.entity)}"`,
        ...(s.metric !== series[0].metric ? [`metric="${labelValue(s.metric)}"`] : []),
        ...(s.project ? [`project="${labelValue(s.project)}"`] : []),
      ].join(',');

      lines.push(`${name}{${labels}} ${s.value} ${s.time.getTime()}`);
    }
  }

  return lines.length ? `${lines.join('\n')}\n` : '';
}
