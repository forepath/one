import type { Alert, AlertSeverity, AlertSilence, AlertState } from '@forepath/loadweaver/frontend/data-access-console';

export const ALERT_STATE_TONE: Record<AlertState, 'danger' | 'warning' | 'success'> = {
  firing: 'danger',
  pending: 'warning',
  resolved: 'success',
};

export const SEVERITY_TONE: Record<AlertSeverity, 'danger' | 'warning' | 'info'> = {
  critical: 'danger',
  warning: 'warning',
  info: 'info',
};

export function alertStateLabel(state: AlertState): string {
  switch (state) {
    case 'firing':
      return $localize`:@@lwConsoleAlerts-stateFiring:Firing`;
    case 'pending':
      return $localize`:@@lwConsoleAlerts-statePending:Pending`;
    default:
      return $localize`:@@lwConsoleAlerts-stateResolved:Resolved`;
  }
}

export function severityLabel(severity: AlertSeverity): string {
  switch (severity) {
    case 'critical':
      return $localize`:@@lwConsoleAlerts-severityCritical:Critical`;
    case 'warning':
      return $localize`:@@lwConsoleAlerts-severityWarning:Warning`;
    default:
      return $localize`:@@lwConsoleAlerts-severityInfo:Info`;
  }
}

/** Acknowledging is for firing alerts nobody acknowledged yet. */
export function mayAcknowledge(alert: Alert): boolean {
  return alert.state === 'firing' && !alert.acknowledgedBy;
}

export type SilenceStatus = 'active' | 'upcoming' | 'ended';

/** Silence status as a tone badge (3.38 R10). */
export const SILENCE_STATUS_TONE: Record<SilenceStatus, 'success' | 'info' | 'neutral'> = {
  active: 'success',
  upcoming: 'info',
  ended: 'neutral',
};

export function silenceStatus(silence: AlertSilence, now = Date.now()): SilenceStatus {
  if (new Date(silence.endsAt).getTime() <= now) return 'ended';

  return new Date(silence.startsAt).getTime() > now ? 'upcoming' : 'active';
}

export function silenceStatusLabel(status: SilenceStatus): string {
  switch (status) {
    case 'active':
      return $localize`:@@lwConsoleAlerts-silenceActive:Active`;
    case 'upcoming':
      return $localize`:@@lwConsoleAlerts-silenceUpcoming:Upcoming`;
    default:
      return $localize`:@@lwConsoleAlerts-silenceEnded:Ended`;
  }
}

/** Health entity keys (`node/n1`, `deployment/shop/web`) link to the health tree. */
export function isHealthKey(key: string): boolean {
  return /^(cluster|site|node|project|deployment|service|replica|volume)(\/|$)/.test(key);
}

/** `<input type="datetime-local">` value for a date (local time, minutes). */
export function toLocalInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(
    date.getMinutes(),
  )}`;
}
