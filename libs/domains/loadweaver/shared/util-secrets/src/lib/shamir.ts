import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Shamir secret sharing over GF(2^8) (AES field, polynomial 0x11b). Used for the split cluster master key
 * (3.22) and the backup recovery kit (3.20). Any `threshold` shares reconstruct the secret; fewer reveal nothing.
 */

const EXP = new Uint8Array(510);
const LOG = new Uint8Array(256);

(() => {
  let x = 1;

  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    // multiply by the generator 3 = x * 2 xor x
    x ^= (x << 1) ^ (x & 0x80 ? 0x11b : 0);
    x &= 0xff;
  }

  for (let i = 255; i < 510; i++) EXP[i] = EXP[i - 255];
})();

function mul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

function div(a: number, b: number): number {
  if (b === 0) throw new RangeError('division by zero');

  return a === 0 ? 0 : EXP[LOG[a] + 255 - LOG[b]];
}

export interface Share {
  /** Number of shares needed to reconstruct. */
  threshold: number;
  /** x coordinate, 1..255. */
  index: number;
  /** First 8 bytes of SHA-256 over the secret: groups shares and verifies the reconstruction. */
  secretId: string;
  value: Buffer;
}

/** Id of a secret (first 8 bytes of SHA-256), as carried by its shares; also names KMS-wrapped master keys. */
export function secretId(secret: Buffer): string {
  return createHash('sha256').update(secret).digest('hex').slice(0, 16);
}

export function splitSecret(secret: Buffer, shares: number, threshold: number): Share[] {
  if (secret.length === 0) throw new RangeError('secret must not be empty');

  if (
    !Number.isInteger(shares) ||
    !Number.isInteger(threshold) ||
    threshold < 1 ||
    shares < threshold ||
    shares > 255
  ) {
    throw new RangeError('need 1 <= threshold <= shares <= 255');
  }

  const id = secretId(secret);
  const result: Share[] = Array.from({ length: shares }, (_, i) => ({
    threshold,
    index: i + 1,
    secretId: id,
    value: Buffer.alloc(secret.length),
  }));

  for (let byte = 0; byte < secret.length; byte++) {
    const coefficients = [secret[byte], ...randomBytes(threshold - 1)];

    for (const share of result) {
      // Horner evaluation of the polynomial at x = share.index.
      let y = 0;

      for (let c = coefficients.length - 1; c >= 0; c--) y = mul(y, share.index) ^ coefficients[c];

      share.value[byte] = y;
    }
  }

  return result;
}

export function combineShares(shares: readonly Share[]): Buffer {
  if (shares.length === 0) throw new RangeError('no shares');

  const { threshold, secretId: id } = shares[0];
  const length = shares[0].value.length;

  if (shares.some((s) => s.threshold !== threshold || s.secretId !== id || s.value.length !== length)) {
    throw new Error('shares belong to different secrets');
  }

  const unique = [...new Map(shares.map((s) => [s.index, s])).values()];

  if (unique.length < threshold) throw new Error(`need ${threshold} shares, got ${unique.length}`);

  const used = unique.slice(0, threshold);
  const secret = Buffer.alloc(length);

  for (let byte = 0; byte < length; byte++) {
    // Lagrange interpolation at x = 0.
    let value = 0;

    for (let i = 0; i < used.length; i++) {
      let basis = 1;

      for (let j = 0; j < used.length; j++) {
        if (i !== j) basis = mul(basis, div(used[j].index, used[j].index ^ used[i].index));
      }

      value ^= mul(used[i].value[byte], basis);
    }

    secret[byte] = value;
  }

  if (!timingSafeEqual(Buffer.from(secretId(secret)), Buffer.from(id)))
    throw new Error('shares do not reconstruct the secret');

  return secret;
}

/** Text form for storage and the printable recovery kit: `lws1.<threshold>.<index>.<secretId>.<base64url>`. */
export function encodeShare(share: Share): string {
  return `lws1.${share.threshold}.${share.index}.${share.secretId}.${share.value.toString('base64url')}`;
}

export function decodeShare(text: string): Share {
  const match = /^lws1\.(\d{1,3})\.(\d{1,3})\.([0-9a-f]{16})\.([A-Za-z0-9_-]+)$/.exec(text.trim());

  if (!match) throw new Error('invalid share');

  const threshold = Number(match[1]);
  const index = Number(match[2]);

  if (threshold < 1 || threshold > 255 || index < 1 || index > 255) throw new Error('invalid share');

  return { threshold, index, secretId: match[3], value: Buffer.from(match[4], 'base64url') };
}
