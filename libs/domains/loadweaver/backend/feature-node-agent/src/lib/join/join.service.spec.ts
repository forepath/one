import { assertSafeServerUrl, caHash, randomJoinToken } from './join.service';

describe('join safety', () => {
  it('only sends tokens over https, or plain http to the local control plane', () => {
    expect(assertSafeServerUrl('https://cp.example.com').origin).toBe('https://cp.example.com');
    expect(assertSafeServerUrl('http://127.0.0.1:3400').port).toBe('3400');
    expect(() => assertSafeServerUrl('http://cp.example.com')).toThrow('must use https');
    expect(() => assertSafeServerUrl('ftp://cp.example.com')).toThrow();
  });

  it('hashes the CA certificate DER for pinning', () => {
    const pem = `-----BEGIN CERTIFICATE-----\n${Buffer.from('hello').toString('base64')}\n-----END CERTIFICATE-----\n`;

    expect(caHash(pem)).toBe('sha256:2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
  });

  it('generates tokens in the control plane format', () => {
    expect(randomJoinToken()).toMatch(/^lwj_[a-z0-9]{12}\.[A-Za-z0-9_-]{43}$/);
  });
});
