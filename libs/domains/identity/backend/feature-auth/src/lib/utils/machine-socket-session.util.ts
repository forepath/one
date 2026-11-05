import {
  isMachineSocketUser,
  isSocketEventPermitted,
  socketScopeDeniedMessage,
  type SocketEventScopes,
  type SocketUserInfo,
} from '@forepath/identity/backend';

/** Default interval of the live session re-check of machine sockets. */
export const MACHINE_SOCKET_REVALIDATE_DEFAULT_MS = 60_000;

const MACHINE_SOCKET_REVALIDATE_MIN_MS = 5_000;

/** Message sent before a machine socket is closed because its token / session is no longer valid. */
export const MACHINE_SOCKET_SESSION_INVALID_MESSAGE = 'Session is no longer valid.';

/** Minimal Socket.IO server-side socket shape (keeps feature-auth free of a socket.io dependency). */
export interface MachineSessionSocket {
  id: string;
  use(fn: (packet: unknown[], next: (err?: Error) => void) => void): unknown;
  on(event: 'disconnect', listener: () => void): unknown;
  emit(event: string, ...args: unknown[]): unknown;
  disconnect(close?: boolean): unknown;
}

export interface MachineSocketSessionOptions {
  /** Inbound events machine sockets may send, with their required scopes (unlisted → rejected). */
  inboundEvents: SocketEventScopes;
  /** Re-runs the handshake authentication (live PAT / app session, user, websocket scope). */
  revalidate: () => Promise<SocketUserInfo | null>;
  /** Periodic re-check interval; defaults to `SOCKET_MACHINE_SESSION_REVALIDATE_MS` or 60s. */
  revalidateIntervalMs?: number;
  logger?: { warn(message: string): void };
}

export function resolveMachineSocketRevalidateIntervalMs(): number {
  const raw = parseInt(process.env.SOCKET_MACHINE_SESSION_REVALIDATE_MS || '', 10);

  if (Number.isNaN(raw)) {
    return MACHINE_SOCKET_REVALIDATE_DEFAULT_MS;
  }

  return Math.max(MACHINE_SOCKET_REVALIDATE_MIN_MS, raw);
}

function sameScopes(a: readonly string[] | undefined, b: readonly string[] | undefined): boolean {
  const left = new Set(a ?? []);
  const right = new Set(b ?? []);

  return left.size === right.size && [...left].every((scope) => right.has(scope));
}

/**
 * Enforce machine-token (PAT / app access token) rules on an authenticated socket; no-op for interactive and
 * API-key sockets. HTTP checks the token on every request, so machine sockets get the same guarantees:
 *
 * - every inbound event must be permitted by `inboundEvents` (rejected events never reach a handler)
 * - every inbound event re-validates the session first (revoked PAT / app grant, scope change, lock, demotion)
 * - listen-only sockets are re-validated periodically and closed when the session ends or the JWT expires
 *
 * Inbound events are dispatched in arrival order.
 */
export function attachMachineSocketSession(
  socket: MachineSessionSocket,
  userInfo: SocketUserInfo,
  options: MachineSocketSessionOptions,
): void {
  if (!isMachineSocketUser(userInfo)) {
    return;
  }

  const intervalMs = options.revalidateIntervalMs ?? resolveMachineSocketRevalidateIntervalMs();
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let queue: Promise<void> = Promise.resolve();
  const clearTimer = () => {
    if (timer) {
      clearTimeout(timer);
      timer = undefined;
    }
  };
  const terminate = (reason: string) => {
    if (closed) {
      return;
    }

    closed = true;
    clearTimer();
    options.logger?.warn(`Closing machine socket ${socket.id}: ${reason}`);

    try {
      socket.emit('error', { message: MACHINE_SOCKET_SESSION_INVALID_MESSAGE });
    } finally {
      socket.disconnect(true);
    }
  };
  const isExpired = () => typeof userInfo.exp === 'number' && userInfo.exp * 1000 <= Date.now();
  /** Live check; closes the socket and returns false when the session is gone or its scopes changed. */
  const checkSession = async (): Promise<boolean> => {
    if (closed) {
      return false;
    }

    if (isExpired()) {
      terminate('token expired');

      return false;
    }

    let fresh: SocketUserInfo | null = null;

    try {
      fresh = await options.revalidate();
    } catch {
      fresh = null;
    }

    if (!fresh || fresh.userId !== userInfo.userId || !sameScopes(fresh.scopes, userInfo.scopes)) {
      terminate('session no longer valid');

      return false;
    }

    return !closed;
  };
  const schedule = () => {
    if (closed) {
      return;
    }

    const untilExpiryMs = typeof userInfo.exp === 'number' ? userInfo.exp * 1000 - Date.now() : Infinity;
    const delay = Math.max(0, Math.min(intervalMs, untilExpiryMs));

    timer = setTimeout(() => {
      timer = undefined;
      void checkSession().then((ok) => {
        if (ok) {
          schedule();
        }
      });
    }, delay);
    (timer as { unref?: () => void }).unref?.();
  };

  socket.use((packet, next) => {
    const event = typeof packet[0] === 'string' ? packet[0] : '';

    queue = queue
      .then(async () => {
        if (closed) {
          return;
        }

        if (!isSocketEventPermitted(userInfo, event, options.inboundEvents)) {
          socket.emit('error', { message: socketScopeDeniedMessage(event) });

          return;
        }

        if (await checkSession()) {
          next();
        }
      })
      .catch(() => undefined);
  });

  socket.on('disconnect', () => {
    closed = true;
    clearTimer();
  });

  schedule();
}
