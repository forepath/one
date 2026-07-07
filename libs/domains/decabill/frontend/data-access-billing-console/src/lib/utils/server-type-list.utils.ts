import type { ServerType } from '../types/billing.types';

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === 'object' && !Array.isArray(value);
}

function readNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string' && value.trim()) {
    const parsed = Number(value);

    return Number.isFinite(parsed) ? parsed : undefined;
  }

  return undefined;
}

function readString(value: unknown): string | undefined {
  if (typeof value !== 'string') {
    return undefined;
  }

  const trimmed = value.trim();

  return trimmed.length > 0 ? trimmed : undefined;
}

function coerceServerType(raw: unknown, fallbackId?: string): ServerType | null {
  if (!isRecord(raw)) {
    if (typeof raw === 'string' && raw.trim()) {
      const id = raw.trim();

      return { id, name: id, cores: 0, memory: 0, disk: 0 };
    }

    return null;
  }

  const id = readString(raw['id']) ?? readString(raw['name']) ?? fallbackId;

  if (!id) {
    return null;
  }

  const name = readString(raw['name']) ?? readString(raw['description']) ?? id;

  return {
    id,
    name,
    cores: readNumber(raw['cores']) ?? 0,
    memory: readNumber(raw['memory']) ?? 0,
    disk: readNumber(raw['disk']) ?? 0,
    priceMonthly: readNumber(raw['priceMonthly'] ?? raw['price_monthly']),
    priceHourly: readNumber(raw['priceHourly'] ?? raw['price_hourly']),
    description: readString(raw['description']),
  };
}

/**
 * Normalizes provider server-types API payloads to a ServerType array.
 * Some gateways or serializers return arrays as numeric-keyed objects ({ "0": {...}, "1": {...} }).
 */
export function normalizeProviderServerTypes(value: unknown): ServerType[] {
  if (Array.isArray(value)) {
    return value.map((entry) => coerceServerType(entry)).filter((entry): entry is ServerType => entry != null);
  }

  if (!isRecord(value)) {
    return [];
  }

  const entries = Object.entries(value);
  const coerced = entries
    .map(([key, entry]) => coerceServerType(entry, /^\d+$/.test(key) ? undefined : key))
    .filter((entry): entry is ServerType => entry != null);

  if (coerced.length > 0) {
    return coerced;
  }

  return Object.values(value)
    .map((entry) => coerceServerType(entry))
    .filter((entry): entry is ServerType => entry != null);
}

/** Normalizes allowed server type id lists (array or numeric-keyed object of ids). */
export function normalizeAllowedServerTypeIds(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((entry) => (typeof entry === 'string' ? entry.trim() : '')).filter((entry) => entry.length > 0);
  }

  if (isRecord(value)) {
    return Object.values(value)
      .map((entry) => (typeof entry === 'string' ? entry.trim() : ''))
      .filter((entry) => entry.length > 0);
  }

  if (typeof value === 'string' && value.trim()) {
    return [value.trim()];
  }

  return [];
}
