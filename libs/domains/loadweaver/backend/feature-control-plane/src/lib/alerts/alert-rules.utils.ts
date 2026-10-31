/** Something wrong right now: one alert per rule and key (node, entity, zone, ...). */
export interface AlertFinding {
  rule: string;
  key: string;
  project?: string;
  /** The node it is about: findings on nodes in maintenance (draining / leaving) are silenced. */
  node?: string;
  severity: 'info' | 'warning' | 'critical';
  title: string;
  message: string;
  value?: number;
  forMs: number;
  repeatMs: number;
  notify: { emails: string[]; webhooks: boolean };
  escalate?: { afterMs: number; emails: string[] };
}

export interface OpenAlert {
  state: 'pending' | 'firing';
  startedAt: Date;
  notifiedAt: Date | null;
  acknowledgedAt: Date | null;
  /** Silenced now (silences and maintenance evaluated for this tick). */
  silenced: boolean;
}

export type AlertAction = 'pend' | 'fire' | 'notify' | 'resolve' | 'none';

export function compare(op: '>' | '>=' | '<' | '<=', value: number, threshold: number): boolean {
  switch (op) {
    case '>':
      return value > threshold;
    case '>=':
      return value >= threshold;
    case '<':
      return value < threshold;
    case '<=':
      return value <= threshold;
  }
}

/**
 * What to do for one rule + key (3.18): a new finding is pending until its `for` passed, then fires; a firing,
 * unacknowledged, unsilenced alert is sent when it wasn't yet (silenced when it fired) and again every
 * `repeatEvery`; a finding that is gone resolves.
 */
export function transition(open: OpenAlert | undefined, finding: AlertFinding | undefined, now: number): AlertAction {
  if (!finding) return open ? 'resolve' : 'none';

  if (!open) return finding.forMs > 0 ? 'pend' : 'fire';

  if (open.state === 'pending') return now - open.startedAt.getTime() >= finding.forMs ? 'fire' : 'none';

  if (open.acknowledgedAt || open.silenced) return 'none';

  return !open.notifiedAt || now - open.notifiedAt.getTime() >= finding.repeatMs ? 'notify' : 'none';
}

/** Escalate once: firing, unacknowledged, unsilenced and older than the rule's `escalate.after`. */
export function shouldEscalate(
  open: OpenAlert & { firedAt: Date | null; escalatedAt: Date | null },
  finding: AlertFinding,
  now: number,
): boolean {
  return (
    !!finding.escalate &&
    open.state === 'firing' &&
    !open.acknowledgedAt &&
    !open.silenced &&
    !open.escalatedAt &&
    !!open.firedAt &&
    now - open.firedAt.getTime() >= finding.escalate.afterMs
  );
}

export interface Silence {
  rule: string | null;
  project: string | null;
  key: string | null;
  startsAt: Date;
  endsAt: Date;
}

/** A silence matches when every field it sets matches (a rule ending in `*` is a prefix). */
export function silenced(
  silences: readonly Silence[],
  alert: { rule: string; key: string; project?: string | null },
  now: number,
): boolean {
  return silences.some(
    (s) =>
      s.startsAt.getTime() <= now &&
      s.endsAt.getTime() > now &&
      (!s.rule || (s.rule.endsWith('*') ? alert.rule.startsWith(s.rule.slice(0, -1)) : s.rule === alert.rule)) &&
      (!s.project || s.project === alert.project) &&
      (!s.key || s.key === alert.key),
  );
}

/**
 * Policy denies spiking (3.18): the last 5 minutes are well above the usual 5 minutes of the last day (at least
 * 10× and at least `floor` packets), so a busy cluster with steady denies stays quiet.
 */
export function deniesSpiking(recent: number, baselinePer5m: number, floor = 1_000): boolean {
  return recent >= floor && recent >= 10 * Math.max(baselinePer5m, 1);
}

/** The value of a `change` rule: last minus first per-minute value of a series (oldest first). */
export function seriesChange(points: readonly number[]): number | null {
  return points.length >= 2 ? points[points.length - 1] - points[0] : null;
}
