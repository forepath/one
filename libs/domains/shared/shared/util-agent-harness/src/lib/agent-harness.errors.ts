import type { AgentHarnessErrorBody } from './agent-harness.types';

/** Base class of every error raised by the harness. */
export class AgentHarnessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentHarnessError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

/** Invalid harness configuration or tool registration (programming error; never sent to the agent). */
export class AgentHarnessConfigError extends AgentHarnessError {
  constructor(message: string) {
    super(message);
    this.name = 'AgentHarnessConfigError';
  }
}

/** Error answer of the OpenAI-compatible API (`{ error: { message, type, param, code } }`). */
export class AgentHarnessApiError extends AgentHarnessError {
  constructor(
    readonly status: number,
    message: string,
    readonly type: string,
    readonly code: string | null = null,
    readonly param: string | null = null,
  ) {
    super(message);
    this.name = 'AgentHarnessApiError';
  }

  /** Builds the error from a response body; non-OpenAI bodies (proxies, HTML error pages) become a generic message. */
  static fromBody(status: number, body: unknown): AgentHarnessApiError {
    const error = (body as Partial<AgentHarnessErrorBody> | null | undefined)?.error;

    if (error && typeof error === 'object' && typeof error.message === 'string') {
      return new AgentHarnessApiError(
        status,
        error.message,
        typeof error.type === 'string' ? error.type : 'api_error',
        typeof error.code === 'string' ? error.code : null,
        typeof error.param === 'string' ? error.param : null,
      );
    }

    return new AgentHarnessApiError(status, `Agenstra API request failed with status ${status}`, 'api_error');
  }

  /** Error event of a stream (`{ type: 'error', code, message, param }` or an OpenAI error envelope). */
  static fromStreamEvent(event: Record<string, unknown>): AgentHarnessApiError {
    if (event['error'] && typeof event['error'] === 'object') {
      return AgentHarnessApiError.fromBody(500, event);
    }

    return new AgentHarnessApiError(
      500,
      typeof event['message'] === 'string' ? event['message'] : 'The agent turn failed',
      'server_error',
      typeof event['code'] === 'string' ? event['code'] : null,
      typeof event['param'] === 'string' ? event['param'] : null,
    );
  }

  get retryable(): boolean {
    return this.status === 429 || this.status === 502 || this.status === 503;
  }
}

/** The turn was aborted through the caller's `AbortSignal`. */
export class AgentHarnessAbortError extends AgentHarnessError {
  constructor(message = 'The agent turn was aborted') {
    super(message);
    this.name = 'AgentHarnessAbortError';
  }
}

/**
 * Throw from a tool handler to report a failure **to the agent** with this message. Any other error thrown by a handler
 * is reported to the agent as a generic failure, so internal details (stack traces, SQL, hostnames) never reach the
 * agent transcript.
 */
export class AgentToolError extends Error {
  constructor(
    message: string,
    /** Optional machine-readable code the agent can react to (e.g. `not_found`, `validation_failed`). */
    readonly code?: string,
  ) {
    super(message);
    this.name = 'AgentToolError';
    Object.setPrototypeOf(this, new.target.prototype);
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    error instanceof AgentHarnessAbortError ||
    (!!error && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError')
  );
}
