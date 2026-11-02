import type { ErrorRequestHandler } from 'express';

/** What body-parser attaches to its errors (`entity.parse.failed`, `entity.too.large`, …). */
interface BodyParserError {
  type?: unknown;
  status?: unknown;
  statusCode?: unknown;
}

const MESSAGES: Readonly<Record<string, string>> = {
  'entity.parse.failed': 'request body is not valid JSON',
  'entity.too.large': 'request body too large',
  'entity.verify.failed': 'request body could not be verified',
  'encoding.unsupported': 'unsupported request body encoding',
  'charset.unsupported': 'unsupported request body charset',
  'request.aborted': 'request aborted',
  'request.size.invalid': 'request body size mismatch',
  'parameters.too.many': 'too many request body parameters',
};

/**
 * Answers body-parser failures before any controller runs (3.40): a fixed message instead of the parser's, which can
 * quote the submitted body (Node's `JSON.parse` errors include a snippet — a secret value on `PUT …/secrets/:name`),
 * `Cache-Control: no-store`, and a log line with the error type only. Everything else goes on to Nest / Express.
 */
export function bodyParserErrorHandler(log: (message: string) => void): ErrorRequestHandler {
  return (error: unknown, req, res, next) => {
    const type = (error as BodyParserError | null)?.type;

    if (typeof type !== 'string' || !Object.prototype.hasOwnProperty.call(MESSAGES, type)) return next(error);

    const raw = (error as BodyParserError).status ?? (error as BodyParserError).statusCode;
    const status = typeof raw === 'number' && raw >= 400 && raw < 500 ? raw : 400;

    log(`${req.method} ${req.path}: body rejected (${type}, ${status})`);

    if (res.headersSent) return next(error);

    res.setHeader('Cache-Control', 'no-store');
    res.status(status).json({
      statusCode: status,
      message: MESSAGES[type],
      error: status === 413 ? 'Payload Too Large' : 'Bad Request',
    });
  };
}
