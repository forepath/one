import { decodeMsgpack, encodeMsgpack, isUnknown, UNKNOWN, type MsgpackValue } from './msgpack';

const hex = (b: Uint8Array) => Buffer.from(b).toString('hex');
const bytes = (h: string) => Buffer.from(h.replace(/\s+/g, ''), 'hex');

describe('msgpack', () => {
  it.each<[MsgpackValue, string]>([
    [null, 'c0'],
    [true, 'c3'],
    [false, 'c2'],
    [0, '00'],
    [127, '7f'],
    [128, 'cc80'],
    [256, 'cd0100'],
    [65536, 'ce00010000'],
    [2 ** 40, 'cf0000010000000000'],
    [-1, 'ff'],
    [-32, 'e0'],
    [-33, 'd0df'],
    [-129, 'd1ff7f'],
    [-40000, 'd2ffff63c0'],
    [-(2 ** 40), 'd3ffffff0000000000'],
    [1.5, 'cb3ff8000000000000'],
    ['', 'a0'],
    ['abc', 'a3616263'],
    [[], '90'],
    [{ a: 'b' }, '81a161a162'],
  ])('encodes %p as cty does', (value, expected) => {
    expect(hex(encodeMsgpack(value))).toBe(expected);
    expect(decodeMsgpack(bytes(expected))).toEqual(value);
  });

  it('round-trips long strings, binary, big arrays and maps', () => {
    const value = {
      s32: 'x'.repeat(32),
      s300: 'y'.repeat(300),
      s70k: 'z'.repeat(70_000),
      bin: Uint8Array.from([1, 2, 3]),
      list: Array.from({ length: 20 }, (_, i) => i),
      map: Object.fromEntries(Array.from({ length: 20 }, (_, i) => [`k${i}`, i % 2 === 0])),
      utf8: 'Grüße ✓',
    };
    const encoded = encodeMsgpack(value);

    expect(encoded.subarray(0, 1).toString('hex')).toBe('87');
    expect(decodeMsgpack(encoded)).toEqual(value);
  });

  it('writes unknown values as cty unknown extension and reads any extension as unknown', () => {
    expect(hex(encodeMsgpack(UNKNOWN))).toBe('d40000');
    expect(isUnknown(decodeMsgpack(bytes('d40000')))).toBe(true);
    // Refined unknown (cty extension 12) with a payload.
    expect(isUnknown(decodeMsgpack(bytes('c7030c81a161')))).toBe(true);
    expect(decodeMsgpack(bytes('82a161d40000a162c0'))).toEqual({ a: UNKNOWN, b: null });
  });

  it('keeps 64-bit integers beyond the safe range exact', () => {
    expect(decodeMsgpack(bytes('cfffffffffffffffff'))).toBe(18446744073709551615n);
    expect(hex(encodeMsgpack(9007199254740993n))).toBe('cf0020000000000001');
  });

  it('refuses malformed data', () => {
    expect(() => decodeMsgpack(bytes('a3 6162'))).toThrow('truncated');
    expect(() => decodeMsgpack(bytes('c0 c0'))).toThrow('trailing');
    expect(() => decodeMsgpack(bytes('81 01 02'))).toThrow('keys must be strings');
    expect(() => decodeMsgpack(bytes('c1'))).toThrow('unsupported');
  });

  it('does not let map keys pollute prototypes', () => {
    const decoded = decodeMsgpack(encodeMsgpack({ ['__proto__']: 'x' } as never)) as Record<string, unknown>;

    expect(({} as Record<string, unknown>)['polluted']).toBeUndefined();
    expect(Object.getPrototypeOf(decoded)).toBeNull();
  });
});
