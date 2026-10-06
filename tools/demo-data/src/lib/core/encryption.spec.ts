import { randomBytes } from 'crypto';

import { ColumnEncryptor } from './encryption';

describe('ColumnEncryptor', () => {
  const key = randomBytes(32).toString('base64');

  it('should produce iv:tag:ciphertext that decrypts to the original value', () => {
    const encryptor = new ColumnEncryptor(key);
    const stored = encryptor.encrypt('secret value');

    expect(stored.split(':')).toHaveLength(3);
    expect(encryptor.decrypt(stored)).toBe('secret value');
  });

  it('should round-trip JSON payloads', () => {
    const encryptor = new ColumnEncryptor(key);

    expect(JSON.parse(encryptor.decrypt(encryptor.encryptJson({ a: 1 })))).toEqual({ a: 1 });
  });

  it('should keep null and empty strings untouched', () => {
    const encryptor = new ColumnEncryptor(key);

    expect(encryptor.encrypt(null)).toBeNull();
    expect(encryptor.encrypt('')).toBe('');
  });

  it('should fall back to the development key when no key is configured', () => {
    const withFallback = new ColumnEncryptor(undefined);
    const explicit = new ColumnEncryptor(Buffer.alloc(32, 0x11).toString('base64'));

    expect(explicit.decrypt(withFallback.encrypt('x'))).toBe('x');
  });

  it('should reject keys that are not 32 bytes', () => {
    expect(() => new ColumnEncryptor(Buffer.alloc(16).toString('base64'))).toThrow('32-byte');
  });

  it('should fail to decrypt values encrypted with another key', () => {
    const stored = new ColumnEncryptor(key).encrypt('x');

    expect(() => new ColumnEncryptor(randomBytes(32).toString('base64')).decrypt(stored)).toThrow();
  });
});
