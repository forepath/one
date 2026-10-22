const SCRIPT_PREFIXES = ['#!/bin/bash', '#!/bin/sh', '#cloud-config'];

function isPlainUserData(value: string): boolean {
  return SCRIPT_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/**
 * Plain-text cloud-init user data: contributors build base64-encoded user data; providers that take the
 * script as text get it decoded. Values that are neither a script nor base64 of a script are returned as is.
 */
export function resolvePlainTextUserData(userData: string): string {
  const trimmed = userData?.trim() ?? '';

  if (!trimmed) {
    return userData ?? '';
  }

  if (isPlainUserData(trimmed)) {
    return userData;
  }

  const decoded = Buffer.from(trimmed, 'base64').toString('utf8');

  return isPlainUserData(decoded) ? decoded : userData;
}
