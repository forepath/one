import { compareIp, formatIp, isIp, mustParseIp, parseIp } from './ip';

describe('ip', () => {
  it.each([
    ['192.0.2.1', '192.0.2.1'],
    ['0.0.0.0', '0.0.0.0'],
    ['2001:DB8::1', '2001:db8::1'],
    ['2001:db8:0:0:1:0:0:1', '2001:db8::1:0:0:1'],
    ['::', '::'],
    ['::1', '::1'],
    ['fe80::', 'fe80::'],
    ['2001:db8:1:2:3:4:5:6', '2001:db8:1:2:3:4:5:6'],
    ['2001:0:0:1::1', '2001:0:0:1::1'],
    ['::ffff:192.0.2.1', '::ffff:c000:201'],
  ])('round-trips %s to canonical %s', (input, expected) => {
    expect(formatIp(mustParseIp(input))).toBe(expected);
  });

  it.each([
    '',
    '1.2.3',
    '1.2.3.4.5',
    '256.0.0.1',
    '01.2.3.4',
    '1:2:3:4:5:6:7:8:9',
    '1::2::3',
    'gggg::1',
    '::1.2.3',
    '1.2.3.4/24',
  ])('rejects %s', (input) => {
    expect(parseIp(input)).toBeNull();
    expect(isIp(input)).toBe(false);
  });

  it('throws on invalid input in mustParseIp', () => {
    expect(() => mustParseIp('nope')).toThrow('invalid IP address');
  });

  it('orders by family first, then value', () => {
    expect(compareIp(mustParseIp('10.0.0.2'), mustParseIp('10.0.0.1'))).toBe(1);
    expect(compareIp(mustParseIp('255.255.255.255'), mustParseIp('::'))).toBe(-2);
    expect(compareIp(mustParseIp('::1'), mustParseIp('::1'))).toBe(0);
  });
});
