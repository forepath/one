import { sanitizeLogPayload } from './sanitize-log-payload';

describe('sanitizeLogPayload', () => {
  it('serializes Error instances (non-enumerable message/stack)', () => {
    const err = new Error('connection refused');

    expect(sanitizeLogPayload(err)).toEqual({
      name: 'Error',
      message: 'connection refused',
      stack: expect.stringContaining('Error: connection refused'),
    });
  });

  it('redacts sensitive keys deeply', () => {
    expect(sanitizeLogPayload({ password: 'x', nested: { access_token: 't' }, ok: 1 })).toEqual({
      password: '[REDACTED]',
      nested: { access_token: '[REDACTED]' },
      ok: 1,
    });
  });

  it('redacts JWT-shaped strings', () => {
    const jwt = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XwpL5Qu9lrVzpRw9qTXY';

    expect(sanitizeLogPayload({ detail: jwt })).toEqual({ detail: '[REDACTED]' });
  });

  it('sanitizes bearer/basic/apikey strings', () => {
    expect(sanitizeLogPayload('Authorization: Bearer abc.def.ghi')).toContain('Bearer [REDACTED]');
    expect(sanitizeLogPayload('Basic dXNlcjpwYXNz')).toBe('Basic [REDACTED]');
    expect(sanitizeLogPayload('ApiKey sk_live_abc')).toBe('ApiKey [REDACTED]');
  });

  it('returns input unchanged for null, undefined, and unsupported types', () => {
    expect(sanitizeLogPayload(null)).toBeNull();
    expect(sanitizeLogPayload(undefined)).toBeUndefined();
    const sym = Symbol('s');
    expect(sanitizeLogPayload(sym)).toBe(sym);
    const fn = (): number => 1;
    expect(sanitizeLogPayload(fn)).toBe(fn);
  });

  it('sanitizes nested arrays and stops recursion past max depth', () => {
    expect(sanitizeLogPayload([{ ok: 1 }, ['nested']])).toEqual([{ ok: 1 }, ['nested']]);

    let deep: unknown = 'leaf';
    for (let i = 0; i < 8; i++) {
      deep = [deep];
    }
    // Innermost array hits depth > 6 and becomes '[REDACTED]'; outer arrays still normalize children.
    let expected: unknown = '[REDACTED]';
    for (let i = 0; i < 7; i++) {
      expected = [expected];
    }
    expect(sanitizeLogPayload(deep)).toEqual(expected);
  });

  it('does not treat two-segment dot strings as JWT', () => {
    expect(sanitizeLogPayload('part.one')).toBe('part.one');
  });

  it('does not treat four-segment strings (non-JWT shape) as JWT when long enough', () => {
    expect(sanitizeLogPayload('part1.part2.part3.part4')).toBe('part1.part2.part3.part4');
  });

  it('redacts strings that start with Bearer when long enough', () => {
    expect(sanitizeLogPayload('Bearer sk_live_abcdef')).toBe('Bearer [REDACTED]');
  });
});
