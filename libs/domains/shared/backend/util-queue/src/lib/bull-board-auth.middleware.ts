import { timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

export interface BullBoardAuthCredentials {
  username: string;
  password: string;
}

function safeEqualString(left: string, right: string): boolean {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);

  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }

  return timingSafeEqual(leftBuffer, rightBuffer);
}

function parseBasicAuthHeader(header: string | undefined): { username: string; password: string } | null {
  if (!header?.startsWith('Basic ')) {
    return null;
  }

  const encoded = header.slice('Basic '.length).trim();
  let decoded: string;

  try {
    decoded = Buffer.from(encoded, 'base64').toString('utf8');
  } catch {
    return null;
  }

  const separatorIndex = decoded.indexOf(':');

  if (separatorIndex < 0) {
    return null;
  }

  return {
    username: decoded.slice(0, separatorIndex),
    password: decoded.slice(separatorIndex + 1),
  };
}

function sendUnauthorized(res: Response): void {
  res.setHeader('WWW-Authenticate', 'Basic realm="Bull Board"');
  res.status(401).send('Authentication required');
}

/**
 * HTTP Basic authentication for Bull Board (Express adapter).
 * Rejects all requests when password is not configured (fail closed).
 */
export function createBullBoardAuthMiddleware(
  credentials: BullBoardAuthCredentials,
): (req: Request, res: Response, next: NextFunction) => void {
  const expectedUsername = credentials.username;
  const expectedPassword = credentials.password;

  return (req, res, next) => {
    if (!expectedPassword) {
      sendUnauthorized(res);

      return;
    }

    const provided = parseBasicAuthHeader(req.headers.authorization);

    if (
      !provided ||
      !safeEqualString(provided.username, expectedUsername) ||
      !safeEqualString(provided.password, expectedPassword)
    ) {
      sendUnauthorized(res);

      return;
    }

    next();
  };
}
