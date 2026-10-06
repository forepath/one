import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

/**
 * Mirrors `libs/domains/shared/backend/util-crypto/src/lib/encryption.transformer.ts`:
 * AES-256-GCM, 12-byte IV, stored as `base64(iv):base64(tag):base64(ciphertext)`.
 * Each backend uses its own ENCRYPTION_KEY, so build one encryptor per database.
 */
export class ColumnEncryptor {
  private readonly key: Buffer;

  constructor(base64Key: string | undefined) {
    const trimmed = base64Key?.trim();

    // The transformer falls back to a fixed development key when ENCRYPTION_KEY is unset.
    this.key = trimmed ? Buffer.from(trimmed, 'base64') : Buffer.alloc(32, 0x11);

    if (this.key.length !== 32) {
      throw new Error('ENCRYPTION_KEY must be a base64-encoded 32-byte key');
    }
  }

  encrypt(plain: string): string;
  encrypt(plain: string | null): string | null;
  encrypt(plain: string | null): string | null {
    if (plain === null) {
      return null;
    }

    if (plain === '') {
      return '';
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();

    return `${iv.toString('base64')}:${tag.toString('base64')}:${ciphertext.toString('base64')}`;
  }

  encryptJson(value: unknown): string {
    return this.encrypt(JSON.stringify(value));
  }

  decrypt(stored: string): string {
    const parts = stored.split(':');

    if (parts.length !== 3) {
      return stored;
    }

    const [ivB64, tagB64, dataB64] = parts;
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(ivB64, 'base64'));

    decipher.setAuthTag(Buffer.from(tagB64, 'base64'));

    return Buffer.concat([decipher.update(Buffer.from(dataB64, 'base64')), decipher.final()]).toString('utf8');
  }
}
