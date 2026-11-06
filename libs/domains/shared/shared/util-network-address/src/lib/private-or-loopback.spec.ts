import { isPrivateOrLoopbackHost, isPrivateOrLoopbackIp } from './private-or-loopback';

describe('isPrivateOrLoopbackIp', () => {
  it('detects RFC1918 IPv4', () => {
    expect(isPrivateOrLoopbackIp('10.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIp('192.168.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIp('172.16.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIp('203.0.113.1')).toBe(false);
  });

  it('detects IPv4-mapped private IPv6', () => {
    expect(isPrivateOrLoopbackIp('::ffff:10.0.0.1')).toBe(true);
    expect(isPrivateOrLoopbackIp('::ffff:203.0.113.1')).toBe(false);
  });

  it('detects IPv6 loopback and ULA', () => {
    expect(isPrivateOrLoopbackIp('::1')).toBe(true);
    expect(isPrivateOrLoopbackIp('fd12::1')).toBe(true);
    expect(isPrivateOrLoopbackIp('fe80::1')).toBe(true);
  });
});

describe('isPrivateOrLoopbackHost', () => {
  it('detects localhost-style names', () => {
    expect(isPrivateOrLoopbackHost('localhost')).toBe(true);
    expect(isPrivateOrLoopbackHost('app.localhost')).toBe(true);
    expect(isPrivateOrLoopbackHost('machine.local')).toBe(true);
  });

  describe('special-purpose ranges and IPv4 embedded in IPv6 (SSRF)', () => {
    it.each([
      '0.0.0.0',
      '0.1.2.3',
      '100.64.0.1',
      '100.100.100.200',
      '169.254.169.254',
      '192.0.0.8',
      '198.18.0.1',
      '224.0.0.1',
      '255.255.255.255',
      '::',
      'fec0::1',
      'ff02::1',
      'fe80::1%eth0',
      '::ffff:7f00:1',
      '::ffff:a9fe:a9fe',
      '::127.0.0.1',
      '::7f00:1',
      '64:ff9b::a9fe:a9fe',
      '64:ff9b::127.0.0.1',
      '2002:7f00:1::',
      '2002:a9fe:a9fe::1',
      '2001:0:4136:e378:8000:63bf:80ff:fffe',
      '[::1]',
      '[::ffff:10.0.0.1]',
    ])('blocks %s', (ip) => {
      expect(isPrivateOrLoopbackIp(ip)).toBe(true);
    });

    it.each([
      '8.8.8.8',
      '93.184.216.34',
      '172.32.0.1',
      '100.128.0.1',
      '2606:4700:4700::1111',
      '2a00:1450:4001:82a::200e',
      '::ffff:8.8.8.8',
      '64:ff9b::808:808',
      '2002:808:808::1',
    ])('allows public %s', (ip) => {
      expect(isPrivateOrLoopbackIp(ip)).toBe(false);
    });

    it('treats bracketed literals as hosts', () => {
      expect(isPrivateOrLoopbackHost('[::1]')).toBe(true);
      expect(isPrivateOrLoopbackHost('0.0.0.0')).toBe(true);
      expect(isPrivateOrLoopbackHost('[2606:4700:4700::1111]')).toBe(false);
    });
  });
});
