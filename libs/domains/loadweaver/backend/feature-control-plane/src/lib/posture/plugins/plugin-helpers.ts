import type { PostureRiskLevel } from '@forepath/loadweaver/shared/util-model';

import type { PostureVendorDevice } from '../../remote-access/posture-plugin';

/** A required configuration value (trimmed), or an error naming the field. */
export function required(config: Readonly<Record<string, string>>, key: string, pattern?: RegExp): string {
  const value = String(config[key] ?? '').trim();

  if (!value) throw new Error(`${key} is required`);

  if (pattern && !pattern.test(value)) throw new Error(`${key} has an invalid format`);

  return value;
}

export function optional(config: Readonly<Record<string, string>>, key: string, fallback = ''): string {
  return String(config[key] ?? fallback).trim();
}

export function choice<T extends string>(
  config: Readonly<Record<string, string>>,
  key: string,
  options: readonly T[],
  fallback: T,
): T {
  const value = optional(config, key, fallback) as T;

  if (!options.includes(value)) throw new Error(`${key} must be one of ${options.join(', ')}`);

  return value;
}

export function integer(
  config: Readonly<Record<string, string>>,
  key: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const raw = optional(config, key);

  if (!raw) return fallback;

  const value = Number(raw);

  if (!Number.isInteger(value) || value < min || value > max)
    throw new Error(`${key} must be between ${min} and ${max}`);

  return value;
}

/** Tenant ids: a GUID or a verified domain. */
export const TENANT_ID = /^([0-9a-fA-F-]{36}|[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+)$/;
export const CLIENT_ID = /^[A-Za-z0-9._~-]{1,128}$/;

export function text(value: unknown, max = 256): string | undefined {
  if (typeof value === 'number') return String(value);

  if (typeof value !== 'string') return undefined;

  const trimmed = value.trim();

  return trimmed ? trimmed.slice(0, max) : undefined;
}

export function ids(...values: unknown[]): string[] {
  return [...new Set(values.map((v) => text(v, 128)).filter((v): v is string => !!v))];
}

/** Device users as e-mail / UPN (lower-cased, deduplicated); values without an `@` are no usable identity. */
export function users(...values: unknown[]): string[] {
  return [
    ...new Set(
      values.map((v) => text(v, 320)?.toLowerCase()).filter((v): v is string => !!v && /^[^@\s]+@[^@\s]+$/.test(v)),
    ),
  ];
}

export function maxRisk(...levels: (PostureRiskLevel | undefined)[]): PostureRiskLevel | undefined {
  const order: PostureRiskLevel[] = ['low', 'medium', 'high'];
  const present = levels.filter((l): l is PostureRiskLevel => !!l);

  return present.length ? present.reduce((a, b) => (order.indexOf(b) > order.indexOf(a) ? b : a)) : undefined;
}

/** Days since an ISO timestamp (Infinity when missing / invalid). */
export function daysSince(iso: string | undefined, now = Date.now()): number {
  const at = iso ? Date.parse(iso) : NaN;

  return Number.isNaN(at) ? Infinity : (now - at) / 86_400_000;
}

/** Runs `fn` over items with bounded concurrency, keeping the order. */
export async function mapConcurrent<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;

  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;

        results[index] = await fn(items[index]);
      }
    }),
  );

  return results;
}

export function device(partial: Omit<PostureVendorDevice, 'reasons'> & { reasons?: string[] }): PostureVendorDevice {
  return { ...partial, reasons: partial.reasons ?? [] };
}
