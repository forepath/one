/** Alerts, acknowledgements and silences (3.18): `/alerts`. */

export type AlertState = 'pending' | 'firing' | 'resolved';
export type AlertSeverity = 'info' | 'warning' | 'critical';
/** `open` = pending and firing. */
export type AlertListState = 'open' | 'resolved' | 'all';

export interface Alert {
  id: string;
  rule: string;
  key: string;
  project: string | null;
  severity: AlertSeverity;
  state: AlertState;
  title: string;
  message: string;
  value: number | null;
  startedAt: string;
  firedAt: string | null;
  resolvedAt: string | null;
  silenced: boolean;
  acknowledgedBy: string | null;
  acknowledgedAt: string | null;
}

export interface AlertListQuery {
  state?: AlertListState;
  project?: string;
  limit?: number;
}

export interface AlertSilence {
  id: string;
  rule: string | null;
  project: string | null;
  key: string | null;
  reason: string;
  createdBy: string | null;
  startsAt: string;
  endsAt: string;
}

/** `POST /alerts/silences`: at least one of `rule`, `project`, `key`. */
export interface CreateAlertSilence {
  rule?: string;
  project?: string;
  key?: string;
  reason: string;
  startsAt?: string;
  endsAt: string;
}

export type AlertExportFormat = 'csv' | 'json';
