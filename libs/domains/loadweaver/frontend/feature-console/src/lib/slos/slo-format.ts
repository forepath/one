import type { Slo, SloObjective, SloState } from '@forepath/loadweaver/frontend/data-access-console';
import { SLO_FAST_BURN } from '@forepath/loadweaver/frontend/data-access-console';
import type { FpcProgressRingTone, FpcStatusBadgeTone } from '@forepath/shared/frontend/ui-components';

export const SLO_STATES: SloState[] = ['burning', 'exhausted', 'ok', 'no-data'];

export const SLO_STATE_TONE: Record<SloState, FpcStatusBadgeTone> = {
  ok: 'success',
  burning: 'danger',
  exhausted: 'warning',
  'no-data': 'neutral',
};

export const SLO_STATE_ICON: Record<SloState, string> = {
  ok: 'bi-check-lg',
  burning: 'bi-fire',
  exhausted: 'bi-hourglass-bottom',
  'no-data': 'bi-dash-lg',
};

export function sloStateLabel(state: SloState): string {
  switch (state) {
    case 'ok':
      return $localize`:@@lwConsoleSlos-stateOk:OK`;
    case 'burning':
      return $localize`:@@lwConsoleSlos-stateBurning:Burning`;
    case 'exhausted':
      return $localize`:@@lwConsoleSlos-stateExhausted:Budget exhausted`;
    default:
      return $localize`:@@lwConsoleSlos-stateNoData:No data`;
  }
}

/** `shop/web/api`. */
export function sloKey(slo: Slo): string {
  return `${slo.project}/${slo.deployment}/${slo.service}`;
}

/** Share of the error budget used, 0–100 for the ring (it can exceed the budget). */
export function budgetUsedPercent(objective: SloObjective): number {
  return Math.max(0, Math.min(100, Math.round(objective.consumed * 100)));
}

/** The ring's tone: how much of the budget is gone, and whether it burns fast. */
export function budgetTone(objective: SloObjective): FpcProgressRingTone {
  if (objective.state === 'no-data') return 'info';

  if (objective.state === 'burning' || objective.consumed >= 1) return 'danger';

  return objective.consumed >= 0.75 ? 'warning' : 'success';
}

/** `99.97 %`, `–` without data; targets keep their digits (99.95), measurements get up to three. */
export function formatPercent(value: number | null | undefined, digits = 3): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '–';

  return `${Number(value.toFixed(digits))} %`;
}

/** `0.2×`, `–` without traffic in the last hour. */
export function formatBurnRate(rate: number | null): string {
  if (rate === null || !Number.isFinite(rate)) return '–';

  return `${rate >= 10 ? Math.round(rate) : Number(rate.toFixed(1))}×`;
}

/** The burn rate reaches the fast-burn threshold (alerts fire). */
export function burnsFast(objective: SloObjective): boolean {
  return objective.burnRate1h !== null && objective.burnRate1h >= SLO_FAST_BURN;
}

/** Most urgent first (burning, exhausted, ok, no data), then by service. */
export function sortSlos(slos: readonly Slo[]): Slo[] {
  return [...slos].sort(
    (a, b) => SLO_STATES.indexOf(a.state) - SLO_STATES.indexOf(b.state) || sloKey(a).localeCompare(sloKey(b)),
  );
}

/** `/health/service/<project>/<deployment>/<service>`. */
export function sloHealthLink(slo: Slo): string[] {
  return ['/health', 'service', slo.project, slo.deployment, slo.service];
}
