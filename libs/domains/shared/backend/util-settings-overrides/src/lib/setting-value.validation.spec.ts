import { SettingDefinition } from './setting-definition.types';
import { normalizeSettingValue, SettingValueValidationError } from './setting-value.validation';

const def = (type: SettingDefinition['type'], extra: Partial<SettingDefinition> = {}): SettingDefinition => ({
  key: 'KEY',
  category: 'c',
  type,
  scope: 'global',
  ...extra,
});

describe('normalizeSettingValue', () => {
  it('rejects non-strings and control characters', () => {
    expect(() => normalizeSettingValue(def('string'), 5)).toThrow(SettingValueValidationError);
    expect(() => normalizeSettingValue(def('string'), 'a\nb')).toThrow('control characters');
    expect(() => normalizeSettingValue(def('string'), 'a\u0000b')).toThrow('control characters');
    expect(normalizeSettingValue(def('text'), 'line 1\r\nline 2')).toBe('line 1\nline 2');
    expect(() => normalizeSettingValue(def('text'), 'a\u0000b')).toThrow('control characters');
  });

  it('enforces the maximum length', () => {
    expect(() => normalizeSettingValue(def('string', { maxLength: 3 }), 'abcd')).toThrow('at most 3');
    expect(normalizeSettingValue(def('string', { maxLength: 3 }), ' abc ')).toBe('abc');
  });

  it('normalizes booleans, integers and numbers with bounds', () => {
    expect(normalizeSettingValue(def('boolean'), 'TRUE')).toBe('true');
    expect(() => normalizeSettingValue(def('boolean'), 'yes')).toThrow();
    expect(normalizeSettingValue(def('integer', { min: 0, max: 10 }), '07')).toBe('7');
    expect(() => normalizeSettingValue(def('integer', { min: 0, max: 10 }), '11')).toThrow('at most 10');
    expect(() => normalizeSettingValue(def('integer'), '1.5')).toThrow('integer');
    expect(normalizeSettingValue(def('number', { min: 0, max: 1 }), '0.25')).toBe('0.25');
    expect(() => normalizeSettingValue(def('number'), 'abc')).toThrow('number');
  });

  it('maps enums to their canonical option', () => {
    expect(normalizeSettingValue(def('enum', { options: ['SKR03', 'SKR04'] }), 'skr04')).toBe('SKR04');
    expect(normalizeSettingValue(def('enum', { options: ['', 'EXW'] }), '')).toBe('');
    expect(() => normalizeSettingValue(def('enum', { options: ['a'] }), 'b')).toThrow('one of');
  });

  it('validates urls', () => {
    expect(normalizeSettingValue(def('url'), 'http://example.com/x')).toBe('http://example.com/x');
    expect(() => normalizeSettingValue(def('url', { httpsOnly: true }), 'http://example.com')).toThrow('https');
    expect(() => normalizeSettingValue(def('url'), 'file:///etc/passwd')).toThrow();
    expect(() => normalizeSettingValue(def('url'), 'https://user:pw@example.com')).toThrow('credentials');
    expect(() => normalizeSettingValue(def('url'), 'not a url')).toThrow('absolute URL');
  });

  it('validates emails, cron, time zones, durations and lists', () => {
    expect(normalizeSettingValue(def('email'), 'a@b.de')).toBe('a@b.de');
    expect(() => normalizeSettingValue(def('email'), 'nope')).toThrow();
    expect(normalizeSettingValue(def('cron'), '0  0 * * *')).toBe('0 0 * * *');
    expect(() => normalizeSettingValue(def('cron'), '0 0 *')).toThrow('cron');
    expect(normalizeSettingValue(def('timezone'), 'Europe/Berlin')).toBe('Europe/Berlin');
    expect(() => normalizeSettingValue(def('timezone'), 'Mars/Base')).toThrow('time zone');
    expect(normalizeSettingValue(def('duration'), '15M')).toBe('15m');
    expect(() => normalizeSettingValue(def('duration'), '15 minutes')).toThrow('duration');
    expect(normalizeSettingValue(def('list'), ' a , ,b ')).toBe('a,b');
  });

  it('applies patterns to non-empty values', () => {
    const country = def('string', { pattern: '^[A-Za-z]{2}$' });

    expect(normalizeSettingValue(country, 'DE')).toBe('DE');
    expect(normalizeSettingValue(country, '')).toBe('');
    expect(() => normalizeSettingValue(country, 'DEU')).toThrow('invalid format');
  });
});
