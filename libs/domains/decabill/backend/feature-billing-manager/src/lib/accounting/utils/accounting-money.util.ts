/** Money helpers working in integer cents (no float drift when summing journal lines). */

export function toCents(value: number | string | null | undefined): number {
  const n = Number(value ?? 0);

  if (!Number.isFinite(n)) {
    return 0;
  }

  return Math.round(n * 100 + Number.EPSILON * Math.sign(n) * 100);
}

export function fromCents(cents: number): number {
  return cents / 100;
}

export function roundAmount(value: number): number {
  return fromCents(toCents(value));
}

/**
 * Splits `total` into parts proportional to `weights`, distributing rounding cents so the parts sum exactly to the
 * total (largest remainder method).
 */
export function allocateCents(totalCents: number, weights: number[]): number[] {
  const sum = weights.reduce((a, b) => a + Math.abs(b), 0);

  if (sum === 0 || weights.length === 0) {
    return weights.map((_, i) => (i === 0 ? totalCents : 0));
  }

  const raw = weights.map((w) => (Math.abs(w) / sum) * totalCents);
  const floors = raw.map((r) => Math.trunc(r));
  let remainder = totalCents - floors.reduce((a, b) => a + b, 0);
  const order = raw.map((r, i) => ({ i, frac: Math.abs(r - Math.trunc(r)) })).sort((a, b) => b.frac - a.frac);
  const step = remainder >= 0 ? 1 : -1;

  for (let k = 0; remainder !== 0 && k < order.length * 2; k += 1) {
    floors[order[k % order.length].i] += step;
    remainder -= step;
  }

  return floors;
}
