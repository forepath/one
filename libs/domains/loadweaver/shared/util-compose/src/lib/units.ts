/** Compose value formats: durations (`1m30s`), CPU (`0.5`), byte sizes (`512m`, `1g`). */

const DURATION_UNITS: Record<string, number> = { us: 0.001, ms: 1, s: 1000, m: 60_000, h: 3_600_000 };

/** Compose duration (`1h2m3s4ms`) in milliseconds; null if malformed. */
export function parseDuration(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0) return value * 1000;

  if (typeof value !== 'string' || value.length === 0 || value.length > 64) return null;

  const re = /(\d+(?:\.\d+)?)(us|ms|s|m|h)/g;
  let total = 0;
  let consumed = 0;
  let match: RegExpExecArray | null;

  while ((match = re.exec(value)) !== null) {
    if (match.index !== consumed) return null;

    total += Number(match[1]) * DURATION_UNITS[match[2]];
    consumed = match.index + match[0].length;
  }

  return consumed === value.length ? Math.round(total) : null;
}

/** `cpus: 0.5` → 500 millicores. */
export function parseCpus(value: unknown): number | null {
  const n =
    typeof value === 'number' ? value : typeof value === 'string' && /^\d+(\.\d+)?$/.test(value) ? Number(value) : NaN;

  return Number.isFinite(n) && n > 0 && n <= 1024 ? Math.round(n * 1000) : null;
}

const BYTE_UNITS: Record<string, number> = {
  '': 1,
  b: 1,
  k: 1024,
  kb: 1024,
  m: 1024 ** 2,
  mb: 1024 ** 2,
  g: 1024 ** 3,
  gb: 1024 ** 3,
  t: 1024 ** 4,
  tb: 1024 ** 4,
};

/** Compose byte size (`512m`, `1g`, `1048576`). */
export function parseBytes(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value > 0) return value;

  if (typeof value !== 'string') return null;

  const match = /^(\d+(?:\.\d+)?)\s*([a-zA-Z]{0,2})$/.exec(value.trim());

  if (!match) return null;

  const unit = BYTE_UNITS[match[2].toLowerCase()];

  return unit === undefined ? null : Math.round(Number(match[1]) * unit);
}
