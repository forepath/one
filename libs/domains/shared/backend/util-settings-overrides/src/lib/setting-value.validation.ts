import { SettingDefinition } from './setting-definition.types';

export class SettingValueValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingValueValidationError';
  }
}

const DEFAULT_MAX_LENGTH = 2048;
const TEXT_MAX_LENGTH = 16384;
const IMAGE_MAX_LENGTH = 65536;
// Values become environment-variable strings: control characters are rejected on purpose.
// eslint-disable-next-line no-control-regex
const SINGLE_LINE_FORBIDDEN = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const MULTI_LINE_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const INTEGER_PATTERN = /^-?\d+$/;
const DURATION_PATTERN = /^\d+(?:\.\d+)?(?:ms|s|m|h|d)?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CRON_FIELD_PATTERN = /^[0-9A-Za-z*/,?#LW-]+$/;
const COLOR_PATTERN = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const IMAGE_DATA_URI_PATTERN = /^data:(image\/(?:png|jpeg|webp|svg\+xml));base64,([A-Za-z0-9+/]+={0,2})$/;

export function isSensitiveSetting(definition: SettingDefinition): boolean {
  return definition.type === 'secret';
}

/** Maximum stored length of a setting value (explicit `maxLength`, otherwise the default of its type). */
export function resolveSettingMaxLength(definition: SettingDefinition): number {
  if (definition.maxLength !== undefined) {
    return definition.maxLength;
  }

  if (definition.type === 'text') {
    return TEXT_MAX_LENGTH;
  }

  return definition.type === 'image' ? IMAGE_MAX_LENGTH : DEFAULT_MAX_LENGTH;
}

/**
 * Validates and normalizes an override value. Returns the value to store; throws
 * {@link SettingValueValidationError} with an operator-readable message otherwise.
 * An empty string is a valid override for free-form types (explicitly empty); typed values must parse.
 */
export function normalizeSettingValue(definition: SettingDefinition, raw: unknown): string {
  if (typeof raw !== 'string') {
    throw new SettingValueValidationError(`${definition.key} must be a string`);
  }

  const multiLine = definition.type === 'text';
  const maxLength = resolveSettingMaxLength(definition);
  const value = multiLine ? raw.replace(/\r\n/g, '\n') : raw.trim();

  if (value.length > maxLength) {
    throw new SettingValueValidationError(`${definition.key} must be at most ${maxLength} characters`);
  }

  if ((multiLine ? MULTI_LINE_FORBIDDEN : SINGLE_LINE_FORBIDDEN).test(value)) {
    throw new SettingValueValidationError(`${definition.key} must not contain control characters`);
  }

  if (definition.pattern && value !== '' && !new RegExp(definition.pattern).test(value)) {
    throw new SettingValueValidationError(`${definition.key} has an invalid format`);
  }

  switch (definition.type) {
    case 'string':
    case 'text':
    case 'secret':
      return value;
    case 'list':
      return value
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .join(',');
    case 'boolean':
      return normalizeBoolean(definition, value);
    case 'integer':
      return normalizeInteger(definition, value);
    case 'number':
      return normalizeNumber(definition, value);
    case 'enum':
      return normalizeEnum(definition, value);
    case 'url':
      return normalizeUrl(definition, value);
    case 'email':
      if (!EMAIL_PATTERN.test(value)) {
        throw new SettingValueValidationError(`${definition.key} must be an email address`);
      }

      return value;
    case 'cron':
      return normalizeCron(definition, value);
    case 'timezone':
      return normalizeTimezone(definition, value);
    case 'duration':
      if (!DURATION_PATTERN.test(value.toLowerCase())) {
        throw new SettingValueValidationError(
          `${definition.key} must be a duration in milliseconds or with a unit (ms, s, m, h, d)`,
        );
      }

      return value.toLowerCase();
    case 'color':
      return normalizeColor(definition, value);
    case 'image':
      return normalizeImage(definition, value);
    default:
      throw new SettingValueValidationError(`${definition.key} has an unsupported type`);
  }
}

function normalizeBoolean(definition: SettingDefinition, value: string): string {
  const normalized = value.toLowerCase();

  if (normalized !== 'true' && normalized !== 'false') {
    throw new SettingValueValidationError(`${definition.key} must be "true" or "false"`);
  }

  return normalized;
}

function assertBounds(definition: SettingDefinition, parsed: number): void {
  if (definition.min !== undefined && parsed < definition.min) {
    throw new SettingValueValidationError(`${definition.key} must be at least ${definition.min}`);
  }

  if (definition.max !== undefined && parsed > definition.max) {
    throw new SettingValueValidationError(`${definition.key} must be at most ${definition.max}`);
  }
}

function normalizeInteger(definition: SettingDefinition, value: string): string {
  if (!INTEGER_PATTERN.test(value)) {
    throw new SettingValueValidationError(`${definition.key} must be an integer`);
  }

  const parsed = Number(value);

  if (!Number.isSafeInteger(parsed)) {
    throw new SettingValueValidationError(`${definition.key} must be an integer`);
  }

  assertBounds(definition, parsed);

  return String(parsed);
}

function normalizeNumber(definition: SettingDefinition, value: string): string {
  const parsed = value === '' ? Number.NaN : Number(value);

  if (!Number.isFinite(parsed)) {
    throw new SettingValueValidationError(`${definition.key} must be a number`);
  }

  assertBounds(definition, parsed);

  return value;
}

function normalizeEnum(definition: SettingDefinition, value: string): string {
  const match = (definition.options ?? []).find((option) => option.toLowerCase() === value.toLowerCase());

  if (match === undefined) {
    throw new SettingValueValidationError(
      `${definition.key} must be one of: ${(definition.options ?? []).map((option) => option || '(empty)').join(', ')}`,
    );
  }

  return match;
}

function normalizeUrl(definition: SettingDefinition, value: string): string {
  if (value === '') {
    return value;
  }

  let parsed: URL;

  try {
    parsed = new URL(value);
  } catch {
    throw new SettingValueValidationError(`${definition.key} must be an absolute URL`);
  }

  const allowed = definition.httpsOnly ? ['https:'] : ['https:', 'http:'];

  if (!allowed.includes(parsed.protocol)) {
    throw new SettingValueValidationError(
      `${definition.key} must use ${definition.httpsOnly ? 'https' : 'http or https'}`,
    );
  }

  if (parsed.username || parsed.password) {
    throw new SettingValueValidationError(`${definition.key} must not contain credentials`);
  }

  return value;
}

function normalizeCron(definition: SettingDefinition, value: string): string {
  const fields = value.split(/\s+/).filter((field) => field.length > 0);

  if (fields.length < 5 || fields.length > 6 || !fields.every((field) => CRON_FIELD_PATTERN.test(field))) {
    throw new SettingValueValidationError(`${definition.key} must be a cron expression with 5 or 6 fields`);
  }

  return fields.join(' ');
}

function normalizeTimezone(definition: SettingDefinition, value: string): string {
  try {
    new Intl.DateTimeFormat('en', { timeZone: value });
  } catch {
    throw new SettingValueValidationError(`${definition.key} must be an IANA time zone (e.g. Europe/Berlin)`);
  }

  return value;
}

/** `#rgb` / `#rrggbb` → lowercase `#rrggbb`; empty stays empty (explicitly unset). */
function normalizeColor(definition: SettingDefinition, value: string): string {
  if (value === '') {
    return value;
  }

  if (!COLOR_PATTERN.test(value)) {
    throw new SettingValueValidationError(`${definition.key} must be a hex color such as #32a852`);
  }

  const hex = value.slice(1).toLowerCase();

  return hex.length === 3 ? `#${[...hex].map((digit) => digit + digit).join('')}` : `#${hex}`;
}

/**
 * Base64 `data:` URI whose bytes match the declared image type. Remote URLs are rejected on purpose: documents are
 * rendered server-side, so a URL would make the renderer fetch arbitrary (internal) addresses. SVG is only accepted
 * without a DOCTYPE (no entity expansion); browsers render SVG images without scripts or external loads.
 */
function normalizeImage(definition: SettingDefinition, value: string): string {
  if (value === '') {
    return value;
  }

  const match = IMAGE_DATA_URI_PATTERN.exec(value);

  if (!match || match[2].length % 4 !== 0) {
    throw new SettingValueValidationError(
      `${definition.key} must be a base64 data URI of a PNG, JPEG, WebP or SVG image`,
    );
  }

  const mimeType = match[1];
  const bytes = Buffer.from(match[2], 'base64');

  if (!imageBytesMatchType(mimeType, bytes)) {
    throw new SettingValueValidationError(`${definition.key} does not contain a valid ${mimeType} image`);
  }

  return value;
}

function imageBytesMatchType(mimeType: string, bytes: Buffer): boolean {
  switch (mimeType) {
    case 'image/png':
      return bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    case 'image/jpeg':
      return bytes.length > 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case 'image/webp':
      return bytes.subarray(0, 4).toString('latin1') === 'RIFF' && bytes.subarray(8, 12).toString('latin1') === 'WEBP';

    case 'image/svg+xml': {
      const text = bytes.toString('utf8');

      return /<svg[\s>]/i.test(text) && !/<!DOCTYPE|<!ENTITY/i.test(text);
    }

    default:
      return false;
  }
}
