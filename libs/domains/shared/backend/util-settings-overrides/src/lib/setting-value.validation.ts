import { SettingDefinition } from './setting-definition.types';

export class SettingValueValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingValueValidationError';
  }
}

const DEFAULT_MAX_LENGTH = 2048;
const TEXT_MAX_LENGTH = 16384;
// Values become environment-variable strings: control characters are rejected on purpose.
// eslint-disable-next-line no-control-regex
const SINGLE_LINE_FORBIDDEN = /[\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const MULTI_LINE_FORBIDDEN = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/;
const INTEGER_PATTERN = /^-?\d+$/;
const DURATION_PATTERN = /^\d+(?:\.\d+)?(?:ms|s|m|h|d)?$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const CRON_FIELD_PATTERN = /^[0-9A-Za-z*/,?#LW-]+$/;

export function isSensitiveSetting(definition: SettingDefinition): boolean {
  return definition.type === 'secret';
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
  const maxLength = definition.maxLength ?? (multiLine ? TEXT_MAX_LENGTH : DEFAULT_MAX_LENGTH);
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
