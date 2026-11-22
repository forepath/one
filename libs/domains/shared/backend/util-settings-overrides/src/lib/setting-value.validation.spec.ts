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

  it('normalizes hex colors', () => {
    expect(normalizeSettingValue(def('color'), '#32A852')).toBe('#32a852');
    expect(normalizeSettingValue(def('color'), ' #abc ')).toBe('#aabbcc');
    expect(normalizeSettingValue(def('color'), '')).toBe('');
    expect(() => normalizeSettingValue(def('color'), '32a852')).toThrow('hex color');
    expect(() => normalizeSettingValue(def('color'), 'red')).toThrow('hex color');
    expect(() => normalizeSettingValue(def('color'), '#32a852;} body{display:none')).toThrow('hex color');
  });

  describe('images', () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d]).toString('base64');
    const svg = (markup: string) => `data:image/svg+xml;base64,${Buffer.from(markup).toString('base64')}`;

    it('accepts data URIs whose bytes match the declared type', () => {
      expect(normalizeSettingValue(def('image'), `data:image/png;base64,${png}`)).toBe(`data:image/png;base64,${png}`);
      expect(normalizeSettingValue(def('image'), svg('<svg xmlns="http://www.w3.org/2000/svg"/>'))).toContain('svg');
      expect(normalizeSettingValue(def('image'), '')).toBe('');
    });

    it('rejects remote URLs, other schemes and mismatching bytes', () => {
      expect(() => normalizeSettingValue(def('image'), 'https://example.com/logo.png')).toThrow('data URI');
      expect(() => normalizeSettingValue(def('image'), 'file:///etc/passwd')).toThrow('data URI');
      expect(() => normalizeSettingValue(def('image'), `data:text/html;base64,${png}`)).toThrow('data URI');
      expect(() => normalizeSettingValue(def('image'), 'data:image/png;base64,abc')).toThrow('data URI');
      expect(() => normalizeSettingValue(def('image'), `data:image/jpeg;base64,${png}`)).toThrow('valid image/jpeg');
      expect(() => normalizeSettingValue(def('image'), `data:image/png;base64,${png}" onerror="x`)).toThrow();
    });

    it('rejects SVG with a DOCTYPE or without an svg root', () => {
      expect(() => normalizeSettingValue(def('image'), svg('<!DOCTYPE svg [<!ENTITY a "x">]><svg>&a;</svg>'))).toThrow(
        'valid image/svg+xml',
      );
      expect(() => normalizeSettingValue(def('image'), svg('<html><body/></html>'))).toThrow('valid image/svg+xml');
    });

    it('defaults to a 64 KiB limit', () => {
      const big = `data:image/png;base64,${'A'.repeat(65536)}`;

      expect(() => normalizeSettingValue(def('image'), big)).toThrow('at most 65536');
    });
  });
});
