import { HttpException, HttpStatus } from '@nestjs/common';

/** OpenAI error envelope (`{ error: { message, type, param, code } }`). */
export interface OpenAiErrorBody {
  error: {
    message: string;
    type: string;
    param: string | null;
    code: string | null;
  };
}

/** Request error raised by the OpenAI-compatible API with OpenAI's `type` / `param` / `code` fields. */
export class OpenAiApiError extends HttpException {
  constructor(
    status: number,
    message: string,
    readonly errorType: string,
    readonly errorCode: string | null = null,
    readonly param: string | null = null,
  ) {
    super(message, status);
  }

  static invalidRequest(message: string, param: string | null = null, code: string | null = null): OpenAiApiError {
    return new OpenAiApiError(HttpStatus.BAD_REQUEST, message, 'invalid_request_error', code, param);
  }

  static unsupported(message: string, param: string | null = null): OpenAiApiError {
    return new OpenAiApiError(HttpStatus.BAD_REQUEST, message, 'invalid_request_error', 'unsupported_parameter', param);
  }

  static notFound(message: string, code = 'not_found', param: string | null = null): OpenAiApiError {
    return new OpenAiApiError(HttpStatus.NOT_FOUND, message, 'invalid_request_error', code, param);
  }
}

function errorTypeForStatus(status: number): { type: string; code: string | null } {
  switch (status) {
    case HttpStatus.BAD_REQUEST:
    case HttpStatus.PAYLOAD_TOO_LARGE:
    case HttpStatus.UNPROCESSABLE_ENTITY:
      return { type: 'invalid_request_error', code: null };
    case HttpStatus.UNAUTHORIZED:
      return { type: 'invalid_request_error', code: 'invalid_api_key' };
    case HttpStatus.FORBIDDEN:
      return { type: 'permission_error', code: 'insufficient_permissions' };
    case HttpStatus.NOT_FOUND:
      return { type: 'invalid_request_error', code: 'not_found' };
    case HttpStatus.CONFLICT:
      return { type: 'invalid_request_error', code: 'conflict' };
    case HttpStatus.TOO_MANY_REQUESTS:
      return { type: 'rate_limit_error', code: 'rate_limit_exceeded' };
    case HttpStatus.GATEWAY_TIMEOUT:
      return { type: 'server_error', code: 'timeout' };
    default:
      return status >= 500 ? { type: 'server_error', code: null } : { type: 'invalid_request_error', code: null };
  }
}

function httpExceptionMessage(exception: HttpException): string {
  const response = exception.getResponse();

  if (typeof response === 'string') {
    return response;
  }

  const message = (response as { message?: unknown })?.message;

  if (Array.isArray(message)) {
    return message.map((entry) => String(entry)).join('; ');
  }

  return typeof message === 'string' && message ? message : exception.message;
}

/**
 * Maps any thrown value to an HTTP status and an OpenAI error envelope. Unknown (non-HTTP) errors become a generic
 * 500 without internal details.
 */
export function toOpenAiError(exception: unknown): { status: number; body: OpenAiErrorBody } {
  if (exception instanceof OpenAiApiError) {
    return {
      status: exception.getStatus(),
      body: {
        error: {
          message: httpExceptionMessage(exception),
          type: exception.errorType,
          param: exception.param,
          code: exception.errorCode,
        },
      },
    };
  }

  if (exception instanceof HttpException) {
    const status = exception.getStatus();
    const { type, code } = errorTypeForStatus(status);

    return { status, body: { error: { message: httpExceptionMessage(exception), type, param: null, code } } };
  }

  // body-parser errors (e.g. payload too large, malformed JSON) carry a numeric status.
  const parserStatus = (exception as { status?: unknown; type?: unknown })?.status;

  if (typeof parserStatus === 'number' && parserStatus >= 400 && parserStatus < 500) {
    const { type, code } = errorTypeForStatus(parserStatus);

    return {
      status: parserStatus,
      body: { error: { message: (exception as Error).message || 'Invalid request', type, param: null, code } },
    };
  }

  return {
    status: HttpStatus.INTERNAL_SERVER_ERROR,
    body: { error: { message: 'Internal server error', type: 'server_error', param: null, code: null } },
  };
}
