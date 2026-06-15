import { randomUUID } from 'node:crypto';

import type { NextFunction, Request, Response } from 'express';

import './express-request-augmentation';
import { runWithCorrelationId } from './correlation-id.storage';
import { redactSecretsInString, sanitizeRequestUrlForLog } from './sanitize-request-log';

export const CORRELATION_ID_HEADER = 'x-correlation-id';
export const REQUEST_ID_HEADER = 'x-request-id';

const MAX_INCOMING_ID_LENGTH = 128;

export interface HttpAccessLogger {
  log(message: string): void;
}

function readIncomingCorrelationId(req: Request): string | undefined {
  const a = req.headers[CORRELATION_ID_HEADER];
  const b = req.headers[REQUEST_ID_HEADER];
  const raw =
    (typeof a === 'string' ? a : Array.isArray(a) ? a[0] : undefined) ??
    (typeof b === 'string' ? b : Array.isArray(b) ? b[0] : undefined);
  const trimmed = raw?.trim();

  if (!trimmed) {
    return undefined;
  }

  return trimmed.length > MAX_INCOMING_ID_LENGTH ? trimmed.slice(0, MAX_INCOMING_ID_LENGTH) : trimmed;
}

/**
 * - Propagates or generates `X-Correlation-Id` (also accepts `X-Request-Id`).
 * - Sets `req.correlationId` and response header `X-Correlation-Id`.
 * - Binds AsyncLocalStorage for `getCorrelationId()` during the request.
 * - On response `finish`, logs one access line (path only, no query; redacted patterns).
 *
 * Install **before** other middleware so all handlers share the same id.
 */
export function createCorrelationIdMiddleware(accessLogger?: HttpAccessLogger) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const id = readIncomingCorrelationId(req) ?? randomUUID();

    req.correlationId = id;
    res.setHeader('X-Correlation-Id', id);

    const startedAt = Date.now();

    if (accessLogger) {
      res.on('finish', () => {
        const durationMs = Date.now() - startedAt;
        const path = sanitizeRequestUrlForLog(req.originalUrl ?? req.url);
        const line = `${req.method} ${path} ${res.statusCode} ${durationMs}ms corr=${id}`;

        accessLogger.log(redactSecretsInString(line));
      });
    }

    runWithCorrelationId(id, () => next());
  };
}
