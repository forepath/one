import { decodeMsgpack, encodeMsgpack, isUnknown, UNKNOWN, type MsgpackValue, type Unknown } from './msgpack';

/**
 * Terraform's type system (cty) as far as the provider needs it, in its JSON type notation (the `type` bytes of a
 * schema attribute): primitives, collections and objects.
 */
export type CtyType =
  | 'string'
  | 'number'
  | 'bool'
  | ['list', CtyType]
  | ['set', CtyType]
  | ['map', CtyType]
  | ['object', { [attribute: string]: CtyType }];

/** A decoded Terraform value: `null`, `UNKNOWN` or a (nested) plain value. */
export type TfValue = null | Unknown | string | number | boolean | TfValue[] | { [key: string]: TfValue };
export type TfObject = { [key: string]: TfValue };

/** The `type` bytes of a schema attribute. */
export function ctyTypeJson(type: CtyType): Buffer {
  return Buffer.from(JSON.stringify(type), 'utf8');
}

export class CtyConversionError extends Error {
  constructor(
    readonly path: (string | number)[],
    message: string,
  ) {
    super(`${path.length ? path.join('.') + ': ' : ''}${message}`);
  }
}

function toNumber(value: unknown, path: (string | number)[]): number {
  if (typeof value === 'number') return value;

  if (typeof value === 'bigint') return Number(value);

  // cty writes numbers that don't fit into an int64 / float64 as their decimal string.
  if (typeof value === 'string' && value.trim() !== '' && Number.isFinite(Number(value))) return Number(value);

  throw new CtyConversionError(path, `expected a number, got ${typeof value}`);
}

/** Converts a decoded msgpack / JSON value into a {@link TfValue} of the given type (missing attributes: null). */
export function fromWire(type: CtyType, value: unknown, path: (string | number)[] = []): TfValue {
  if (value === null || value === undefined) return null;

  if (isUnknown(value)) return UNKNOWN;

  if (type === 'string') {
    if (typeof value === 'string') return value;

    if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);

    throw new CtyConversionError(path, 'expected a string');
  }

  if (type === 'number') return toNumber(value, path);

  if (type === 'bool') {
    if (typeof value === 'boolean') return value;

    if (value === 'true' || value === 'false') return value === 'true';

    throw new CtyConversionError(path, 'expected a bool');
  }

  const [kind, inner] = type;

  if (kind === 'list' || kind === 'set') {
    if (!Array.isArray(value)) throw new CtyConversionError(path, `expected a ${kind}`);

    return value.map((v, i) => fromWire(inner, v, [...path, i]));
  }

  if (typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array)
    throw new CtyConversionError(path, `expected a ${kind}`);

  const record = value as Record<string, unknown>;

  if (kind === 'map') {
    const out: TfObject = {};

    for (const [k, v] of Object.entries(record)) out[k] = fromWire(inner, v, [...path, k]);

    return out;
  }

  const out: TfObject = {};

  for (const [attribute, attributeType] of Object.entries(inner))
    out[attribute] = fromWire(attributeType, record[attribute], [...path, attribute]);

  return out;
}

/** Converts a {@link TfValue} into the msgpack shape cty expects for the type (objects carry every attribute). */
export function toWire(type: CtyType, value: TfValue | undefined, path: (string | number)[] = []): MsgpackValue {
  if (value === null || value === undefined) return null;

  if (isUnknown(value)) return UNKNOWN;

  if (type === 'string') {
    if (typeof value !== 'string') throw new CtyConversionError(path, 'expected a string');

    return value;
  }

  if (type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value))
      throw new CtyConversionError(path, 'expected a finite number');

    return value;
  }

  if (type === 'bool') {
    if (typeof value !== 'boolean') throw new CtyConversionError(path, 'expected a bool');

    return value;
  }

  const [kind, inner] = type;

  if (kind === 'list' || kind === 'set') {
    if (!Array.isArray(value)) throw new CtyConversionError(path, `expected a ${kind}`);

    return value.map((v, i) => toWire(inner, v, [...path, i]));
  }

  if (typeof value !== 'object' || Array.isArray(value)) throw new CtyConversionError(path, `expected a ${kind}`);

  if (kind === 'map') {
    const out: { [key: string]: MsgpackValue } = {};

    for (const [k, v] of Object.entries(value)) out[k] = toWire(inner, v, [...path, k]);

    return out;
  }

  const out: { [key: string]: MsgpackValue } = {};

  for (const [attribute, attributeType] of Object.entries(inner))
    out[attribute] = toWire(attributeType, value[attribute], [...path, attribute]);

  return out;
}

/** `DynamicValue` as it travels in tfplugin6 messages. */
export interface DynamicValue {
  msgpack?: Uint8Array | null;
  json?: Uint8Array | null;
}

/** Decodes a `DynamicValue` (msgpack, or JSON as in stored state) against a type. An empty value is null. */
export function decodeDynamicValue(type: CtyType, value: DynamicValue | null | undefined): TfValue {
  if (value?.msgpack && value.msgpack.length > 0) return fromWire(type, decodeMsgpack(value.msgpack));

  if (value?.json && value.json.length > 0)
    return fromWire(type, JSON.parse(Buffer.from(value.json).toString('utf8')) as unknown);

  return null;
}

export function encodeDynamicValue(type: CtyType, value: TfValue): { msgpack: Buffer } {
  return { msgpack: encodeMsgpack(toWire(type, value)) };
}

/** True if the value or anything inside it is unknown. */
export function containsUnknown(value: TfValue | undefined): boolean {
  if (isUnknown(value)) return true;

  if (Array.isArray(value)) return value.some(containsUnknown);

  if (value && typeof value === 'object') return Object.values(value).some(containsUnknown);

  return false;
}

/** Deep equality of two Terraform values (unknown equals only unknown). */
export function tfEqual(a: TfValue | undefined, b: TfValue | undefined): boolean {
  if (a === b) return true;

  if (a === undefined || b === undefined || a === null || b === null) return (a ?? null) === (b ?? null);

  if (isUnknown(a) || isUnknown(b)) return false;

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;

    return a.every((v, i) => tfEqual(v, b[i]));
  }

  if (typeof a === 'object' && typeof b === 'object') {
    const keys = new Set([...Object.keys(a), ...Object.keys(b)]);

    return [...keys].every((k) => tfEqual(a[k], b[k]));
  }

  return false;
}
