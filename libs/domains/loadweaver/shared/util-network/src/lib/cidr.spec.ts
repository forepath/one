import { mustParseIp } from './ip';
import {
  allocateAddress,
  allocateSubnet,
  cidrContains,
  cidrContainsIp,
  cidrOverlaps,
  cidrSize,
  formatCidr,
  hostCidr,
  isCidr,
  mustParseCidr,
  parseCidr,
} from './cidr';

describe('cidr', () => {
  it('parses and formats both families', () => {
    expect(formatCidr(mustParseCidr('10.20.0.0/16'))).toBe('10.20.0.0/16');
    expect(formatCidr(mustParseCidr('2001:db8::/48'))).toBe('2001:db8::/48');
    expect(formatCidr(mustParseCidr('0.0.0.0/0'))).toBe('0.0.0.0/0');
  });

  it('rejects host bits in strict mode and masks them otherwise', () => {
    expect(parseCidr('10.0.0.1/24')).toBeNull();
    expect(formatCidr(mustParseCidr('10.0.0.1/24', false))).toBe('10.0.0.0/24');
  });

  it.each(['10.0.0.0', '10.0.0.0/33', '::/129', '10.0.0.0/08', 'x/8'])('rejects %s', (input) => {
    expect(isCidr(input)).toBe(false);
  });

  it('checks containment and overlap', () => {
    const big = mustParseCidr('10.0.0.0/8');
    const small = mustParseCidr('10.1.0.0/16');
    const other = mustParseCidr('192.168.0.0/16');

    expect(cidrContains(big, small)).toBe(true);
    expect(cidrContains(small, big)).toBe(false);
    expect(cidrOverlaps(big, small)).toBe(true);
    expect(cidrOverlaps(big, other)).toBe(false);
    expect(cidrOverlaps(big, mustParseCidr('::/0'))).toBe(false);
    expect(cidrContainsIp(small, mustParseIp('10.1.255.255'))).toBe(true);
    expect(cidrContainsIp(small, mustParseIp('10.2.0.0'))).toBe(false);
  });

  it('computes sizes and host routes', () => {
    expect(cidrSize(mustParseCidr('10.0.0.0/24'))).toBe(256n);
    expect(formatCidr(hostCidr(mustParseIp('2001:db8::5')))).toBe('2001:db8::5/128');
  });

  it('allocates the lowest free subnet deterministically', () => {
    const pool = mustParseCidr('10.42.0.0/16');
    const used = [mustParseCidr('10.42.0.0/24'), mustParseCidr('10.42.2.0/23')];

    expect(formatCidr(allocateSubnet(pool, 24, used)!)).toBe('10.42.1.0/24');
    expect(formatCidr(allocateSubnet(pool, 23, used)!)).toBe('10.42.4.0/23');
    expect(formatCidr(allocateSubnet(mustParseCidr('fd00:10::/48'), 64, [])!)).toBe('fd00:10::/64');
  });

  it('returns null when the pool is exhausted and throws on impossible sizes', () => {
    const pool = mustParseCidr('10.0.0.0/30');

    expect(allocateSubnet(pool, 31, [mustParseCidr('10.0.0.0/31'), mustParseCidr('10.0.0.2/31')])).toBeNull();
    expect(() => allocateSubnet(pool, 29, [])).toThrow(RangeError);
  });

  it('allocates single addresses skipping reserved, used and broadcast', () => {
    const pool = mustParseCidr('10.0.0.0/30');

    expect(allocateAddress(pool, [], 1n)?.value).toBe(mustParseIp('10.0.0.1').value);
    expect(allocateAddress(pool, [mustParseIp('10.0.0.1')], 1n)?.value).toBe(mustParseIp('10.0.0.2').value);
    expect(allocateAddress(pool, [mustParseIp('10.0.0.1'), mustParseIp('10.0.0.2')], 1n)).toBeNull();
    expect(allocateAddress(mustParseCidr('fd00::/127'), [], 0n)?.value).toBe(mustParseIp('fd00::').value);
  });
});
