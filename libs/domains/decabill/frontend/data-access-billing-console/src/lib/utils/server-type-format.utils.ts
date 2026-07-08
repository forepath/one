import type { ServerType } from '../types/billing.types';

function formatPriceValue(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(2);
}

export interface FormatServerTypeOptionOptions {
  /** When false, omits provider infrastructure price (e.g. customer checkout). Defaults to true. */
  includePrice?: boolean;
}

/** Human-readable label for a server type option (name, specs, disk, optional monthly price). */
export function formatServerTypeOption(st: ServerType, options?: FormatServerTypeOptionOptions): string {
  const includePrice = options?.includePrice !== false;
  const name = st.name?.trim() || st.id?.trim() || '';
  const cores = st.cores ?? 0;
  const memory = st.memory ?? 0;
  const disk = st.disk ?? 0;
  const parts = [name, `- ${cores} vCPU, ${memory}GB RAM, ${disk}GB Disk`];

  if (includePrice && st.priceMonthly != null) {
    parts.push(`- €${formatPriceValue(st.priceMonthly)}/month`);
  }

  const label = parts.join(' ').trim();

  return label || String(st.id ?? '');
}

/** Resolves a server type id to a human-readable label using a loaded catalog. */
export function formatServerTypeIdLabel(catalog: ServerType[], id: string): string {
  const trimmed = id?.trim();

  if (!trimmed) {
    return '';
  }

  const match = catalog.find((st) => st.id === trimmed);

  return match ? formatServerTypeOption(match) : trimmed;
}
