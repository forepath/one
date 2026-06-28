import { randomInt } from 'crypto';

export const MIN_RANDOM_DEFAULT_LENGTH = 21;
export const DEFAULT_RANDOM_DEFAULT_LENGTH = 21;

const LOWERCASE = 'abcdefghijklmnopqrstuvwxyz';
const UPPERCASE = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
const DIGITS = '0123456789';
const SPECIAL = '!@#$%^&*()-_=+[]{}|;:,.<>?';

function pickRandomChar(charset: string): string {
  return charset[randomInt(charset.length)] ?? 'a';
}

function shuffle(values: string[]): string[] {
  const result = [...values];

  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = randomInt(index + 1);
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }

  return result;
}

/**
 * Generates a password-like random string with at least one lowercase, uppercase, and digit.
 */
export function generateSecureRandomString(length: number, includeSpecialChars: boolean): string {
  if (!Number.isInteger(length) || length < MIN_RANDOM_DEFAULT_LENGTH) {
    throw new Error(`Length must be an integer of at least ${MIN_RANDOM_DEFAULT_LENGTH}`);
  }

  const requiredChars = [pickRandomChar(LOWERCASE), pickRandomChar(UPPERCASE), pickRandomChar(DIGITS)];

  if (includeSpecialChars) {
    requiredChars.push(pickRandomChar(SPECIAL));
  }

  const charset = includeSpecialChars
    ? `${LOWERCASE}${UPPERCASE}${DIGITS}${SPECIAL}`
    : `${LOWERCASE}${UPPERCASE}${DIGITS}`;
  const remainingLength = length - requiredChars.length;
  const generated = [...requiredChars];

  for (let index = 0; index < remainingLength; index += 1) {
    generated.push(pickRandomChar(charset));
  }

  return shuffle(generated).join('');
}

export function normalizeRandomDefaultLength(length: number | undefined): number {
  if (length === undefined || length === null || Number.isNaN(length)) {
    return DEFAULT_RANDOM_DEFAULT_LENGTH;
  }

  const normalized = Math.floor(Number(length));

  return normalized < MIN_RANDOM_DEFAULT_LENGTH ? MIN_RANDOM_DEFAULT_LENGTH : normalized;
}
