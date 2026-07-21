/**
 * Decode a JWT payload without verifying the signature (client-side session checks only).
 */
export function parseJwtPayload(jwt: string): Record<string, unknown> | null {
  try {
    const payloadPart = jwt.split('.')[1];

    if (!payloadPart) {
      return null;
    }

    return JSON.parse(atob(payloadPart)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

/**
 * Personal access token sessions carry `amr: ["pat"]` and must not be used in the console.
 */
export function jwtPayloadHasPatAmr(payload: Record<string, unknown> | null | undefined): boolean {
  if (!payload) {
    return false;
  }

  const amr = payload['amr'];

  return Array.isArray(amr) && amr.some((value) => value === 'pat');
}

/**
 * True when a users-mode JWT is present, unexpired, and not issued from a personal access token.
 */
export function isUsersConsoleJwtValid(jwt: string | null | undefined): boolean {
  if (!jwt) {
    return false;
  }

  const payload = parseJwtPayload(jwt);

  if (!payload || jwtPayloadHasPatAmr(payload)) {
    return false;
  }

  const exp = typeof payload['exp'] === 'number' ? payload['exp'] * 1000 : 0;

  return exp > Date.now();
}
