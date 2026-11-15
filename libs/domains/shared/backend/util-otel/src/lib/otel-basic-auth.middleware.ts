import { createHash, timingSafeEqual } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import type { OtelAuthCredentials } from './otel-runtime.config';

function safeEqualString(left: string, right: string): boolean {
  const leftDigest = createHash('sha256').update(left, 'utf8').digest();
  const rightDigest = createHash('sha256').update(right, 'utf8').digest();

  return timingSafeEqual(leftDigest, rightDigest);
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
  res.setHeader('WWW-Authenticate', 'Basic realm="OpenTelemetry"');
  res.status(401).send('Authentication required');
}

/**
 * HTTP Basic authentication for the OpenTelemetry Prometheus metrics endpoint.
 */
export function createOtelBasicAuthMiddleware(
  credentials: OtelAuthCredentials,
): (req: Request, res: Response, next: NextFunction) => void {
  const expectedUsername = credentials.username;
  const expectedPassword = credentials.password;

  return (req, res, next) => {
    if (!expectedUsername || !expectedPassword) {
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
