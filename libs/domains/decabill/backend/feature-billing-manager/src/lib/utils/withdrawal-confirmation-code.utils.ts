import { randomInt, timingSafeEqual } from 'crypto';

const CONFIRMATION_CODE_LENGTH = 6;
const ALPHANUMERIC_CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const CODE_PATTERN = /^[A-Z0-9]{6}$/;

export function generateWithdrawalConfirmationCode(): string {
  let code = '';

  for (let i = 0; i < CONFIRMATION_CODE_LENGTH; i++) {
    code += ALPHANUMERIC_CHARS[randomInt(0, ALPHANUMERIC_CHARS.length)];
  }

  return code;
}

export function validateWithdrawalConfirmationCode(code: string, storedCode: string | null | undefined): boolean {
  const normalized = code.trim().toUpperCase();

  if (!storedCode || !CODE_PATTERN.test(normalized)) {
    return false;
  }

  const storedNormalized = storedCode.trim().toUpperCase();
  const inputBuffer = Buffer.from(normalized, 'utf8');
  const storedBuffer = Buffer.from(storedNormalized, 'utf8');

  if (inputBuffer.length !== storedBuffer.length) {
    return false;
  }

  return timingSafeEqual(inputBuffer, storedBuffer);
}
