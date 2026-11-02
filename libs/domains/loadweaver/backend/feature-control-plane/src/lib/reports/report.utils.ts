import { USAGE_METER_DEFINITIONS, type UsageMeter } from '../usage/usage.constants';

/** One monthly report (3.25): uptime and SLOs, incidents, capacity trend and forecast, denies, health, usage. */
export interface ReportData {
  scope: string;
  period: { year: number; month: number; from: string; to: string };
  generatedAt: string;
  /** Share of the month per health state of the scope's root entity (cluster / project), in percent. */
  health: Partial<Record<string, number>>;
  services: { service: string; availability: number | null; target: number | null }[];
  incidents: { title: string; status: string; createdAt: string; resolvedAt: string | null }[];
  events: { rollbacks: number; failedRollbacks: number; applies: number; healthChanges: number };
  /** Cluster reports: memory in use per day, and when it would reach 90 % of the capacity at the current trend. */
  capacity?: { points: { day: string; usedBytes: number }[]; capacityBytes: number; daysUntil90Percent: number | null };
  deniedPackets?: number;
  usage?: { cpuMillis: number; memoryBytes: number; storageBytes: number };
  /** Metered usage in the month (3.24), per meter in its unit (`USAGE_METER_DEFINITIONS`). */
  metered?: Partial<Record<UsageMeter, number>>;
  /** Backups and restore tests in the month (3.20). */
  backups?: {
    backups: number;
    failedBackups: number;
    bytes: number;
    uploadedBytes: number;
    restoreTests: number;
    failedRestoreTests: number;
  };
  /** Parts that come with later milestones (upgrades). */
  notYet: string[];
}

/** Least-squares line through the points (x = day index). */
export function linearTrend(values: readonly number[]): { slope: number; intercept: number } | null {
  if (values.length < 2) return null;

  const n = values.length;
  const meanX = (n - 1) / 2;
  const meanY = values.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;

  values.forEach((y, x) => {
    num += (x - meanX) * (y - meanY);
    den += (x - meanX) ** 2;
  });

  const slope = den === 0 ? 0 : num / den;

  return { slope, intercept: meanY - slope * meanX };
}

/** Days from the last point until the trend reaches `limit`; null when it doesn't grow (or already did). */
export function daysUntil(values: readonly number[], limit: number): number | null {
  const trend = linearTrend(values);

  if (!trend || trend.slope <= 0) return null;

  const last = values.length - 1;
  const at = (limit - trend.intercept) / trend.slope - last;

  return at > 0 ? Math.ceil(at) : null;
}

/** `reports/cluster/2026/09/` or `reports/projects/shop/2026/09/` + file. */
export function reportKey(scope: string, year: number, month: number, file: string): string {
  const mm = String(month).padStart(2, '0');

  return `${scope === 'cluster' ? 'cluster' : `projects/${scope}`}/${year}/${mm}/${file}`;
}

/** The month before `now` (reports run on the 1st for the month that ended). */
export function previousMonth(now: Date): { year: number; month: number } {
  const year = now.getUTCMonth() === 0 ? now.getUTCFullYear() - 1 : now.getUTCFullYear();
  const month = now.getUTCMonth() === 0 ? 12 : now.getUTCMonth();

  return { year, month };
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string,
  );
}

const pct = (v: number | null | undefined, digits = 3) =>
  v === null || v === undefined ? '–' : `${v.toFixed(digits)} %`;
const gib = (bytes: number) => `${(bytes / 1024 ** 3).toFixed(1)} GiB`;

/** A self-contained, printable HTML document (no scripts, no external resources). */
export function renderReportHtml(data: ReportData): string {
  const title = `Loadweaver report ${data.scope === 'cluster' ? 'cluster' : `project ${data.scope}`} ${data.period.year}-${String(data.period.month).padStart(2, '0')}`;
  const rows = (cells: string[][]) => cells.map((c) => `<tr>${c.map((v) => `<td>${v}</td>`).join('')}</tr>`).join('');

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(title)}</title>
<style>body{font-family:system-ui,sans-serif;max-width:56rem;margin:2rem auto;padding:0 1rem;color:#1f2937}
table{border-collapse:collapse;width:100%;margin:.5rem 0 1.5rem}td,th{border-bottom:1px solid #e5e7eb;padding:.4rem;text-align:left}
small{color:#6b7280}</style></head><body>
<h1>${escapeHtml(title)}</h1><p><small>${escapeHtml(data.period.from)} – ${escapeHtml(data.period.to)}, generated ${escapeHtml(data.generatedAt)}</small></p>
<h2>Health</h2><table>${rows(Object.entries(data.health).map(([state, share]) => [escapeHtml(state), pct(share, 2)]))}</table>
<h2>Uptime and SLOs</h2>${
    data.services.length
      ? `<table><tr><th>Service</th><th>Availability</th><th>Target</th></tr>${rows(
          data.services.map((s) => [
            escapeHtml(s.service),
            pct(s.availability),
            s.target === null ? '–' : `${s.target} %`,
          ]),
        )}</table>`
      : '<p>No service defines an availability SLO.</p>'
  }
<h2>Incidents and changes</h2><p>${data.events.applies} applies, ${data.events.rollbacks} rollbacks (${data.events.failedRollbacks} failed), ${data.events.healthChanges} health changes.</p>${
    data.incidents.length
      ? `<table><tr><th>Incident</th><th>Status</th><th>Opened</th><th>Resolved</th></tr>${rows(
          data.incidents.map((i) => [
            escapeHtml(i.title),
            escapeHtml(i.status),
            escapeHtml(i.createdAt),
            escapeHtml(i.resolvedAt ?? '–'),
          ]),
        )}</table>`
      : '<p>No incidents.</p>'
  }
${
  data.capacity
    ? `<h2>Capacity</h2><p>Memory in use at the end of the month: ${gib(data.capacity.points.at(-1)?.usedBytes ?? 0)} of ${gib(data.capacity.capacityBytes)}. ${
        data.capacity.daysUntil90Percent === null
          ? 'At the current trend, memory use does not reach 90 % of the capacity.'
          : `At the current trend, memory use reaches 90 % of the capacity in about ${data.capacity.daysUntil90Percent} days.`
      }</p>`
    : ''
}${data.deniedPackets !== undefined ? `<h2>Policy denies</h2><p>${data.deniedPackets} denied packets.</p>` : ''}${
    data.usage
      ? `<h2>Usage</h2><p>Requested at the end of the month: ${(data.usage.cpuMillis / 1000).toFixed(2)} CPUs, ${gib(data.usage.memoryBytes)} memory, ${gib(data.usage.storageBytes)} storage.</p>`
      : ''
  }${data.metered ? meteredSection(data.metered) : ''}${
    data.backups
      ? `<h2>Backups and restore tests</h2><p>${data.backups.backups} backups (${data.backups.failedBackups} failed), ${gib(data.backups.bytes)} backed up, ${gib(data.backups.uploadedBytes)} stored after deduplication; ${data.backups.restoreTests} restore tests (${data.backups.failedRestoreTests} failed).</p>`
      : ''
  }${data.notYet.length ? `<p><small>Not in this report yet: ${data.notYet.map(escapeHtml).join(', ')}.</small></p>` : ''}
</body></html>`;
}

/** Metered usage of the month (3.24): one line per meter with its unit. */
export function meteredSection(metered: Partial<Record<UsageMeter, number>>): string {
  const lines = USAGE_METER_DEFINITIONS.map(
    (m) =>
      `<tr><td>${escapeHtml(m.description)}</td><td>${(metered[m.key] ?? 0).toFixed(2)} ${escapeHtml(m.unit)}</td></tr>`,
  ).join('');

  return `<h2>Metered usage</h2><table><tr><th>Meter</th><th>Usage</th></tr>${lines}</table>`;
}
