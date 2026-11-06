import { createHash, timingSafeEqual } from 'node:crypto';

/**
 * Constant-time comparison for shared secrets (static API keys). Both values are hashed first so neither the
 * content nor the length of the expected secret leaks through response timing.
 */
export function secretsEqual(provided: string, expected: string): boolean {
  const left = createHash('sha256').update(provided, 'utf8').digest();
  const right = createHash('sha256').update(expected, 'utf8').digest();

  return timingSafeEqual(left, right);
}
