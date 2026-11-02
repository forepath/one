import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

/**
 * Envelope encryption (3.22): every secret has its own data key (AES-256-GCM); data keys are wrapped with the
 * cluster master key. Additional authenticated data binds a ciphertext to its secret, so ciphertexts can't be
 * swapped between rows.
 */

export const KEY_BYTES = 32;
const IV_BYTES = 12;
const TAG_BYTES = 16;
const VERSION = 1;

export function generateKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/** `version(1) | iv(12) | tag(16) | ciphertext` */
export function seal(key: Buffer, plaintext: Buffer, aad: string): Buffer {
  if (key.length !== KEY_BYTES) throw new RangeError('key must be 32 bytes');

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv('aes-256-gcm', key, iv);

  cipher.setAAD(Buffer.from(aad, 'utf8'));

  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);

  return Buffer.concat([Buffer.from([VERSION]), iv, cipher.getAuthTag(), ciphertext]);
}

export function open(key: Buffer, sealed: Buffer, aad: string): Buffer {
  if (key.length !== KEY_BYTES) throw new RangeError('key must be 32 bytes');

  if (sealed.length < 1 + IV_BYTES + TAG_BYTES || sealed[0] !== VERSION) throw new Error('unsupported ciphertext');

  const iv = sealed.subarray(1, 1 + IV_BYTES);
  const tag = sealed.subarray(1 + IV_BYTES, 1 + IV_BYTES + TAG_BYTES);
  const decipher = createDecipheriv('aes-256-gcm', key, iv);

  decipher.setAAD(Buffer.from(aad, 'utf8'));
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(sealed.subarray(1 + IV_BYTES + TAG_BYTES)), decipher.final()]);
}

export interface EnvelopeCiphertext {
  /** Data key wrapped with the master key. */
  wrappedKey: Buffer;
  ciphertext: Buffer;
}

export function envelopeEncrypt(masterKey: Buffer, plaintext: Buffer, aad: string): EnvelopeCiphertext {
  const dataKey = generateKey();

  try {
    return { wrappedKey: seal(masterKey, dataKey, `dek:${aad}`), ciphertext: seal(dataKey, plaintext, aad) };
  } finally {
    dataKey.fill(0);
  }
}

export function envelopeDecrypt(masterKey: Buffer, envelope: EnvelopeCiphertext, aad: string): Buffer {
  const dataKey = open(masterKey, envelope.wrappedKey, `dek:${aad}`);

  try {
    return open(dataKey, envelope.ciphertext, aad);
  } finally {
    dataKey.fill(0);
  }
}

/** Re-wraps a data key under a new master key (master key rotation never touches the secret ciphertexts). */
export function rewrapKey(oldMaster: Buffer, newMaster: Buffer, wrappedKey: Buffer, aad: string): Buffer {
  const dataKey = open(oldMaster, wrappedKey, `dek:${aad}`);

  try {
    return seal(newMaster, dataKey, `dek:${aad}`);
  } finally {
    dataKey.fill(0);
  }
}
