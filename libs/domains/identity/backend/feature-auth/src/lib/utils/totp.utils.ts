import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const TOTP_DIGITS = 6;
const TOTP_PERIOD_SECONDS = 30;
const TOTP_WINDOW = 1;

function encodeBase32(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = '';

  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;

    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }

  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }

  return output;
}

function decodeBase32(secret: string): Buffer {
  const normalized = secret
    .replace(/=+$/, '')
    .toUpperCase()
    .replace(/[^A-Z2-7]/g, '');
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of normalized) {
    const idx = BASE32_ALPHABET.indexOf(char);

    if (idx === -1) {
      throw new Error('Invalid base32 secret');
    }

    value = (value << 5) | idx;
    bits += 5;

    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }

  return Buffer.from(bytes);
}

function hotp(secret: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);

  counterBuffer.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac('sha1', secret).update(counterBuffer).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);
  const otp = binary % 10 ** TOTP_DIGITS;

  return otp.toString().padStart(TOTP_DIGITS, '0');
}

/**
 * Generates a new Base32 TOTP secret for authenticator enrollment.
 */
export function createTotpSecret(): string {
  return encodeBase32(randomBytes(20));
}

/**
 * Builds an otpauth:// URI for authenticator apps.
 */
export function buildTotpOtpauthUrl(secret: string, email: string, issuer: string): string {
  const label = encodeURIComponent(`${issuer}:${email}`);
  const params = new URLSearchParams({
    secret,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SECONDS),
  });

  return `otpauth://totp/${label}?${params.toString()}`;
}

/**
 * Generates the current TOTP token (tests / smoke helpers).
 */
export function generateTotpCode(secret: string, atMs: number = Date.now()): string {
  const counter = Math.floor(atMs / 1000 / TOTP_PERIOD_SECONDS);

  return hotp(decodeBase32(secret), counter);
}

/**
 * Verifies a 6-digit TOTP token against a Base32 secret (allows ±1 window).
 */
export async function verifyTotpCode(code: string, secret: string): Promise<boolean> {
  if (!/^[0-9]{6}$/.test(code) || !secret) {
    return false;
  }

  const now = Date.now();

  for (let offset = -TOTP_WINDOW; offset <= TOTP_WINDOW; offset++) {
    const candidate = generateTotpCode(secret, now + offset * TOTP_PERIOD_SECONDS * 1000);
    const a = Buffer.from(candidate);
    const b = Buffer.from(code);

    if (a.length === b.length && timingSafeEqual(a, b)) {
      return true;
    }
  }

  return false;
}
