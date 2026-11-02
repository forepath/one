import type { AutoscaledService } from '@forepath/loadweaver/frontend/data-access-console';

function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(Math.abs(n) >= 100 ? 0 : Math.abs(n) >= 10 ? 1 : 2);
}

/** `cpu`, `requests`, or the custom metric's name. */
export function autoscaleMetricName(s: Pick<AutoscaledService, 'metric' | 'customMetric'>): string {
  return s.metric === 'custom' ? (s.customMetric ?? 'custom') : s.metric;
}

/** The target in its unit: `70 %` of the request, `50/s` per replica, or the plain value. */
export function autoscaleTarget(s: Pick<AutoscaledService, 'metric' | 'target'>): string {
  if (s.metric === 'cpu' || s.metric === 'memory')
    return $localize`:@@lwConsoleAutoscaling-percentOfRequest:${formatNumber(s.target)}:value: % of the request`;

  if (s.metric === 'requests')
    return $localize`:@@lwConsoleAutoscaling-perReplica:${formatNumber(s.target)}:value:/s per replica`;

  return formatNumber(s.target);
}

/** The current value in the target's unit, or a dash while it is missing. */
export function autoscaleValue(s: Pick<AutoscaledService, 'metric' | 'status'>): string {
  const value = s.status?.value;

  if (value === null || value === undefined) return '–';

  if (s.metric === 'cpu' || s.metric === 'memory') return `${formatNumber(value)} %`;

  if (s.metric === 'requests') return `${formatNumber(value)}/s`;

  return formatNumber(value);
}

/** Badge tone of the last evaluation: blocked = warning, scaling = info, steady = success, none yet = secondary. */
export function autoscaleTone(s: Pick<AutoscaledService, 'status'>): 'warning' | 'info' | 'success' | 'secondary' {
  if (!s.status) return 'secondary';

  if (s.status.blocked) return 'warning';

  return s.status.action === 'hold' ? 'success' : 'info';
}

export function autoscaleActionLabel(s: Pick<AutoscaledService, 'status'>): string {
  if (!s.status) return $localize`:@@lwConsoleAutoscaling-notEvaluated:not evaluated yet`;

  if (s.status.blocked) return $localize`:@@lwConsoleAutoscaling-blocked:blocked`;

  switch (s.status.action) {
    case 'up':
      return $localize`:@@lwConsoleAutoscaling-scalingUp:scaling up`;
    case 'down':
      return $localize`:@@lwConsoleAutoscaling-scalingDown:scaling down`;
    default:
      return $localize`:@@lwConsoleAutoscaling-steady:steady`;
  }
}

/** Services of one deployment (and optionally one service), by name. */
export function autoscaledOf(
  services: readonly AutoscaledService[],
  deployment: string | null,
  service: string | null = null,
): AutoscaledService[] {
  return services
    .filter((s) => (!deployment || s.deployment === deployment) && (!service || s.service === service))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/** The autoscaling panel's scope for a health entity (`deployment/<p>/<d>`, `service/<p>/<d>/<s>`), else null. */
export function autoscaleScopeOfHealthKey(
  key: string | null,
): { project: string; deployment: string; service: string | null } | null {
  const parts = (key ?? '').split('/');

  if (parts[0] === 'deployment' && parts.length === 3)
    return { project: parts[1], deployment: parts[2], service: null };

  if (parts[0] === 'service' && parts.length === 4)
    return { project: parts[1], deployment: parts[2], service: parts[3] };

  return null;
}
