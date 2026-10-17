import type { HealthState } from '@forepath/loadweaver/frontend/data-access-console';

/** Health states as status tones and labels (shared by the console's views). */
export const HEALTH_TONE: Record<HealthState, 'success' | 'warning' | 'danger' | 'secondary' | 'info'> = {
  healthy: 'success',
  degraded: 'warning',
  'at-risk': 'warning',
  failed: 'danger',
  unknown: 'secondary',
};

export const HEALTH_ICON: Record<HealthState, string> = {
  healthy: 'bi-check-lg',
  degraded: 'bi-exclamation',
  'at-risk': 'bi-exclamation-triangle',
  failed: 'bi-x-lg',
  unknown: 'bi-question',
};

export function healthLabel(state: HealthState): string {
  switch (state) {
    case 'healthy':
      return $localize`:@@lwConsoleHealth-healthy:Healthy`;
    case 'degraded':
      return $localize`:@@lwConsoleHealth-degraded:Degraded`;
    case 'at-risk':
      return $localize`:@@lwConsoleHealth-atRisk:At risk`;
    case 'failed':
      return $localize`:@@lwConsoleHealth-failed:Failed`;
    default:
      return $localize`:@@lwConsoleHealth-unknown:Unknown`;
  }
}

/** Bytes in binary units, e.g. `12.5 GiB`. */
export function formatBytes(bytes: number): string {
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
  let value = bytes;
  let unit = 0;

  while (Math.abs(value) >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit++;
  }

  return `${unit === 0 ? value : value.toFixed(1)} ${units[unit]}`;
}

/** A share as a whole percentage; `–` without a total. */
export function formatShare(used: number, total: number): string {
  return total > 0 ? `${Math.round((used / total) * 100)} %` : '–';
}
