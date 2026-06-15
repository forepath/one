import type { Socket as IoClientSocket } from 'socket.io-client';

import { getCorrelationId } from './correlation-id.storage';

export const CORRELATION_ID_HEADER_OUTBOUND = 'X-Correlation-Id';

/**
 * Builds `extraHeaders` (or similar) with `X-Correlation-Id` from {@link getCorrelationId}
 * when not already present.
 */
export function buildOutboundCorrelationHeaders(existing: Record<string, string> = {}): Record<string, string> {
  const correlationId = getCorrelationId();

  if (!correlationId) {
    return existing;
  }

  if (existing['X-Correlation-Id'] || existing['x-correlation-id']) {
    return existing;
  }

  return { ...existing, [CORRELATION_ID_HEADER_OUTBOUND]: correlationId };
}

/** Merges correlation into socket.io-client options (`extraHeaders` HTTP handshake). */
export function applySocketIoClientCorrelationHeaders<O extends { extraHeaders?: Record<string, string> }>(
  options: O,
): O {
  const extra = options.extraHeaders ?? {};
  const merged = buildOutboundCorrelationHeaders(extra);

  if (merged === extra) {
    return options;
  }

  return { ...options, extraHeaders: merged };
}

/**
 * `io(url, options)` with `X-Correlation-Id` on the handshake when {@link getCorrelationId} is set.
 * Uses dynamic `require` so consumers/tests can mock `socket.io-client`.
 */
export function createCorrelationAwareSocketIoClient(
  url: string,
  options: { extraHeaders?: Record<string, string> } & Record<string, unknown>,
): IoClientSocket {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const { io } = require('socket.io-client') as { io: (u: string, o: object) => IoClientSocket };

  return io(url, applySocketIoClientCorrelationHeaders(options));
}

function hasOutboundCorrelationHeader(headers: unknown): boolean {
  if (!headers || typeof headers !== 'object') {
    return false;
  }

  const anyHeaders = headers as Record<string, unknown> & {
    get?: (name: string) => unknown;
  };

  if (typeof anyHeaders.get === 'function') {
    return Boolean(anyHeaders.get('X-Correlation-Id') ?? anyHeaders.get('x-correlation-id'));
  }

  return anyHeaders['X-Correlation-Id'] !== undefined || anyHeaders['x-correlation-id'] !== undefined;
}

/** Minimal request config shape used by Axios request interceptors. */
export type AxiosRequestConfigLike = {
  headers?: unknown;
};

function applyOutboundCorrelationHeader(config: AxiosRequestConfigLike, correlationId: string): void {
  if (!config.headers) {
    config.headers = { [CORRELATION_ID_HEADER_OUTBOUND]: correlationId };
    return;
  }

  const h = config.headers as Record<string, unknown> & {
    set?: (name: string, value: string) => void;
  };

  if (typeof h.set === 'function') {
    h.set(CORRELATION_ID_HEADER_OUTBOUND, correlationId);
    return;
  }

  Object.assign(h, { [CORRELATION_ID_HEADER_OUTBOUND]: correlationId });
}

/**
 * Adds `X-Correlation-Id` to Axios outbound requests from {@link getCorrelationId}
 * (HTTP middleware / socket adapter). Call once at app bootstrap on the `axios` default instance.
 *
 * Skips when the request already sets `X-Correlation-Id` / `x-correlation-id`.
 *
 * @param axiosInstance Default `axios` or an instance from `axios.create()` (typed loosely for Axios overload compatibility).
 */
export function registerAxiosCorrelationIdPropagation(axiosInstance: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Axios `use()` overloads are not assignable to a narrow callback type
  interceptors: { request: { use: (onFulfilled: any) => any } };
}): void {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  axiosInstance.interceptors.request.use((config: any) => {
    const correlationId = getCorrelationId();

    if (!correlationId) {
      return config;
    }

    const cfg = config as AxiosRequestConfigLike;

    if (hasOutboundCorrelationHeader(cfg.headers)) {
      return config;
    }

    applyOutboundCorrelationHeader(cfg, correlationId);

    return config;
  });
}
