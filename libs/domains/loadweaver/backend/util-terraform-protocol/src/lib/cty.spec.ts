import {
  containsUnknown,
  ctyTypeJson,
  CtyConversionError,
  decodeDynamicValue,
  encodeDynamicValue,
  fromWire,
  tfEqual,
  toWire,
  type CtyType,
  type TfObject,
} from './cty';
import { decodeMsgpack, encodeMsgpack, UNKNOWN } from './msgpack';

const OBJECT: CtyType = [
  'object',
  {
    name: 'string',
    count: 'number',
    on: 'bool',
    labels: ['map', 'string'],
    items: ['list', ['object', { id: 'string', tags: ['set', 'string'] }]],
  },
];

describe('cty values', () => {
  it('writes the JSON type notation of schema attributes', () => {
    expect(ctyTypeJson('string').toString()).toBe('"string"');
    expect(ctyTypeJson(['map', 'string']).toString()).toBe('["map","string"]');
    expect(ctyTypeJson(['object', { a: 'bool' }]).toString()).toBe('["object",{"a":"bool"}]');
  });

  it('fills missing object attributes with null and converts nested values', () => {
    expect(fromWire(OBJECT, { name: 'x', items: [{ id: 'a', tags: ['t'] }] })).toEqual({
      name: 'x',
      count: null,
      on: null,
      labels: null,
      items: [{ id: 'a', tags: ['t'] }],
    });
  });

  it('accepts numbers as strings / bigints (cty big numbers) and bools as strings (flatmap)', () => {
    expect(fromWire('number', '12.5')).toBe(12.5);
    expect(fromWire('number', 10n)).toBe(10);
    expect(fromWire('bool', 'true')).toBe(true);
    expect(fromWire('string', 3)).toBe('3');
  });

  it('reports the path of conversion errors', () => {
    expect(() => fromWire(OBJECT, { items: [{ id: {} }] })).toThrow(
      new CtyConversionError(['items', 0, 'id'], 'expected a string'),
    );
    expect(() => toWire(OBJECT, { count: 'x' })).toThrow('count: expected a finite number');
  });

  it('round-trips a DynamicValue with unknowns', () => {
    const value: TfObject = { name: UNKNOWN, count: 3, on: true, labels: { a: 'b' }, items: [] };
    const encoded = encodeDynamicValue(OBJECT, value);

    expect(decodeDynamicValue(OBJECT, encoded)).toEqual(value);
    // Every attribute is on the wire, unknown as the cty extension.
    expect(Object.keys(decodeMsgpack(encoded.msgpack) as object).sort()).toEqual([
      'count',
      'items',
      'labels',
      'name',
      'on',
    ]);
  });

  it('decodes JSON DynamicValues (stored state) and treats empty values as null', () => {
    expect(decodeDynamicValue(OBJECT, { json: Buffer.from('{"name":"n","extra":1}') })).toMatchObject({
      name: 'n',
      count: null,
    });
    expect(decodeDynamicValue(OBJECT, {})).toBeNull();
    expect(decodeDynamicValue(OBJECT, { msgpack: encodeMsgpack(null) })).toBeNull();
  });

  it('finds unknowns and compares values', () => {
    expect(containsUnknown({ a: [1, { b: UNKNOWN }] })).toBe(true);
    expect(containsUnknown({ a: [1, { b: null }] })).toBe(false);
    expect(tfEqual({ a: [1, 'x'], b: null }, { a: [1, 'x'] })).toBe(true);
    expect(tfEqual({ a: UNKNOWN }, { a: UNKNOWN })).toBe(true);
    expect(tfEqual({ a: UNKNOWN }, { a: 'x' })).toBe(false);
    expect(tfEqual([1], [1, 2])).toBe(false);
  });
});
