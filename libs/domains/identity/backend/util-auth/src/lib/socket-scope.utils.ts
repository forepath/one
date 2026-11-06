import { getMissingPatScopes, type PatScopeLevel } from './identity-pat.scopes';

/**
 * Scope rules for Socket.IO gateways, shared by every product.
 *
 * Interactive sessions (password, OIDC or SAML) and the static API key are unaffected: they keep full access to
 * whatever their user access rules allow. Machine sessions (PAT and app access tokens, `amr` includes `pat`) are
 * fail-closed, exactly like `PatScopesGuard` on HTTP routes:
 *
 * - connecting needs `websocket:<socket>:read` (see {@link websocketScope}); write-type inbound events need
 *   `websocket:<socket>:write` in their event scopes
 * - every inbound event must be listed in the gateway's inbound {@link SocketEventScopes} and all its scopes granted
 *   (unlisted events are rejected)
 * - every outbound event must be listed in the gateway's outbound {@link SocketEventScopes}; machine sockets only
 *   join per-event rooms ({@link socketRoomsForUser}) and receive per-socket emits only when permitted, so an emitter
 *   that is not scope-aware never reaches them
 */

/** Required scopes per Socket.IO event name (all must be granted; `[]` = no scope beyond the socket scope). */
export type SocketEventScopes = Readonly<Record<string, readonly string[]>>;

/** Minimal identity shape the socket scope checks need (structurally matches {@link SocketUserInfo}). */
export interface SocketScopeSubject {
  isApiKeyAuth?: boolean;
  amr?: string[];
  scopes?: string[];
  user?: { amr?: string[]; scopes?: string[] };
}

/** Resource prefix of websocket scopes (`websocket:<socket>:<level>`). */
export const WEBSOCKET_SCOPE_RESOURCE_PREFIX = 'websocket:';

const WEBSOCKET_NAME_PATTERN = /^[a-z][a-z0-9_]*$/;

/**
 * Websocket scope in the shared `<resource>:<level>` grammar, e.g. `websocket:clients:read`.
 * `read` connects and subscribes; `write` additionally allows events that change state.
 */
export function websocketScope(socketName: string, level: Extract<PatScopeLevel, 'read' | 'write'> = 'read'): string {
  if (!WEBSOCKET_NAME_PATTERN.test(socketName)) {
    throw new Error(`Invalid websocket name for scope: ${socketName}`);
  }

  return `${WEBSOCKET_SCOPE_RESOURCE_PREFIX}${socketName}:${level}`;
}

function socketAmr(subject: SocketScopeSubject): string[] {
  return subject.amr ?? subject.user?.amr ?? [];
}

function socketScopes(subject: SocketScopeSubject): string[] {
  return subject.scopes ?? subject.user?.scopes ?? [];
}

/** Whether the socket was authenticated with a machine token (PAT or app access token). */
export function isMachineSocketUser(subject: SocketScopeSubject | null | undefined): boolean {
  if (!subject || subject.isApiKeyAuth) {
    return false;
  }

  return socketAmr(subject).includes('pat');
}

/**
 * Whether the socket may send / receive `event`. Interactive and API-key sockets always may;
 * machine sockets only for listed events whose scopes are all granted (fail-closed).
 */
export function isSocketEventPermitted(
  subject: SocketScopeSubject | null | undefined,
  event: string,
  eventScopes: SocketEventScopes,
): boolean {
  if (!subject) {
    return false;
  }

  if (!isMachineSocketUser(subject)) {
    return true;
  }

  if (!Object.prototype.hasOwnProperty.call(eventScopes, event)) {
    return false;
  }

  return getMissingPatScopes(socketScopes(subject), eventScopes[event]).length === 0;
}

/** Events of `eventScopes` the socket may receive / send. */
export function getPermittedSocketEvents(
  subject: SocketScopeSubject | null | undefined,
  eventScopes: SocketEventScopes,
): string[] {
  return Object.keys(eventScopes).filter((event) => isSocketEventPermitted(subject, event, eventScopes));
}

/** Room that only machine sockets permitted to receive `event` of `room` join. */
export function socketEventRoom(room: string, event: string): string {
  return `${room}#event:${event}`;
}

/**
 * Rooms a socket joins (and leaves) for a broadcast room: interactive / API-key sockets join `room` itself,
 * machine sockets only the per-event rooms of events they are permitted to receive (never `room`).
 */
export function socketRoomsForUser(
  subject: SocketScopeSubject | null | undefined,
  room: string,
  outboundEventScopes: SocketEventScopes,
): string[] {
  if (!isMachineSocketUser(subject)) {
    return [room];
  }

  return getPermittedSocketEvents(subject, outboundEventScopes).map((event) => socketEventRoom(room, event));
}

/** Target rooms of a broadcast of `event` to `room` (interactive members plus permitted machine sockets). */
export function socketBroadcastRooms(room: string, event: string): string[] {
  return [room, socketEventRoom(room, event)];
}

/** Minimal Socket.IO socket shape for {@link emitToSocketIfPermitted}. */
export interface ScopedEmitSocket {
  connected?: boolean;
  data?: { userInfo?: SocketScopeSubject };
  emit(event: string, ...args: unknown[]): unknown;
}

/**
 * Emit `event` to one socket when its identity may receive it.
 * @returns whether the event was emitted
 */
export function emitToSocketIfPermitted(
  socket: ScopedEmitSocket,
  event: string,
  outboundEventScopes: SocketEventScopes,
  ...args: unknown[]
): boolean {
  const subject = socket.data?.userInfo;

  // Only machine sockets are filtered; every other socket keeps its pre-existing behaviour.
  if (isMachineSocketUser(subject) && !isSocketEventPermitted(subject, event, outboundEventScopes)) {
    return false;
  }

  socket.emit(event, ...args);

  return true;
}

/** Stable message when a machine socket lacks the scope for an event. */
export function socketScopeDeniedMessage(event: string): string {
  return `Insufficient token scope for event: ${event}`;
}
