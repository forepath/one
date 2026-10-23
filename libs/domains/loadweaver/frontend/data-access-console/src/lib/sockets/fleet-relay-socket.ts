import type { Socket } from 'socket.io-client';

type Listener = (...args: unknown[]) => void;

interface AttachedPayload {
  attachmentId?: string;
  clusterId?: string;
  namespace?: string;
}

interface EventPayload {
  attachmentId?: string;
  event?: string;
  args?: unknown[];
}

interface DetachedPayload {
  attachmentId?: string;
  reason?: string;
  message?: string;
}

interface RelayErrorPayload {
  attachmentId?: string | null;
  clusterId?: string;
  namespace?: string;
  message?: string;
}

/** The notice of a stream the fleet closed after re-checking access (`detached { reason: 'access-revoked' }`). */
export function fleetAccessRevokedMessage(detail?: string): string {
  const text = $localize`:@@lwConsoleFleet-accessRevoked:Your access to this live view through the fleet was revoked.`;

  return detail ? `${text} (${detail})` : text;
}

/**
 * One live namespace of a cluster through the fleet's socket relay (`socket/fleet`, see the fleet AsyncAPI), shaped
 * like the Socket.IO client socket the console's live features use (`on` / `off` / `emit` / `disconnect` /
 * `connected` / `active`), so plans, topology, logs and terminals work unchanged against the active cluster. A stream the fleet
 * closes after re-checking access (`detached { reason: 'access-revoked' }`) ends with `disconnect` + `connect_error`
 * (the notice) and no retry.
 *
 * The fleet socket attaches on every (re)connect (`attach {clusterId, namespace}` → `attached`); remote events arrive
 * as `event {attachmentId, event, args}` and are re-emitted under their own name; `emit` goes out as
 * `emit {attachmentId, event, args}` (queued until attached). `attached` maps to `connect`, `detached` and the fleet
 * socket's disconnect to `disconnect`, `relayError` to `connect_error` (e.g. a project-only grant or a namespace the
 * relay doesn't carry). When the cluster side reconnects on its own, the next event re-signals `connect`.
 */
export class FleetRelaySocket {
  connected = false;
  active = true;

  private attachmentId: string | null = null;
  private readonly listeners = new Map<string, Set<Listener>>();
  private queue: { event: string; args: unknown[] }[] = [];

  constructor(
    private readonly fleet: Socket,
    readonly clusterId: string,
    readonly namespace: string,
  ) {
    fleet.on('connect', () => fleet.emit('attach', { clusterId, namespace }));
    fleet.on('attached', (payload: AttachedPayload) => this.onAttached(payload));
    fleet.on('event', (payload: EventPayload) => this.onEvent(payload));
    fleet.on('detached', (payload: DetachedPayload) => this.onDetached(payload));
    fleet.on('relayError', (payload: RelayErrorPayload) => this.onRelayError(payload));
    fleet.on('disconnect', (reason: unknown) => {
      this.attachmentId = null;
      this.setDisconnected(reason);
    });
    fleet.on('connect_error', (error: unknown) => this.fire('connect_error', error));
  }

  on(event: string, listener: Listener): this {
    const set = this.listeners.get(event) ?? new Set<Listener>();

    set.add(listener);
    this.listeners.set(event, set);

    return this;
  }

  off(event?: string, listener?: Listener): this {
    if (!event) this.listeners.clear();
    else if (!listener) this.listeners.delete(event);
    else this.listeners.get(event)?.delete(listener);

    return this;
  }

  emit(event: string, ...args: unknown[]): this {
    if (this.attachmentId) this.fleet.emit('emit', { attachmentId: this.attachmentId, event, args });
    else this.queue.push({ event, args });

    return this;
  }

  disconnect(): this {
    if (this.attachmentId && this.fleet.connected) this.fleet.emit('detach', { attachmentId: this.attachmentId });

    this.attachmentId = null;
    this.queue = [];
    this.active = false;
    this.connected = false;
    this.fleet.disconnect();

    return this;
  }

  /** The adapter as the console's socket type (the members the live features use are implemented). */
  asSocket(): Socket {
    return this as unknown as Socket;
  }

  private onAttached(payload: AttachedPayload): void {
    if (this.attachmentId || payload?.clusterId !== this.clusterId || payload?.namespace !== this.namespace) return;

    if (typeof payload.attachmentId !== 'string') return;

    this.attachmentId = payload.attachmentId;

    const queued = this.queue;

    this.queue = [];
    this.setConnected();

    for (const { event, args } of queued) this.emit(event, ...args);
  }

  private onEvent(payload: EventPayload): void {
    if (!this.attachmentId || payload?.attachmentId !== this.attachmentId || typeof payload.event !== 'string') return;

    // The cluster side reconnected by itself after a `detached`: the feature re-subscribes on `connect`.
    if (!this.connected) this.setConnected();

    this.fire(payload.event, ...(Array.isArray(payload.args) ? payload.args : []));
  }

  private onDetached(payload: DetachedPayload): void {
    if (!this.attachmentId || payload?.attachmentId !== this.attachmentId) return;

    if (payload.reason === 'access-revoked') {
      // The fleet re-checked the grant and closed the stream: no retry; the view shows the error.
      this.attachmentId = null;
      this.active = false;
      this.setDisconnected('access-revoked');
      this.fire('connect_error', new Error(fleetAccessRevokedMessage(payload.message)));

      return;
    }

    if (payload.reason === 'detached') this.attachmentId = null;

    this.setDisconnected(payload.reason ?? 'detached');
  }

  private onRelayError(payload: RelayErrorPayload): void {
    const mine = this.attachmentId
      ? payload?.attachmentId === this.attachmentId
      : !payload?.attachmentId && payload?.clusterId === this.clusterId && payload?.namespace === this.namespace;

    if (!mine) return;

    // An attach that was refused (grant, grace, namespace not relayed) won't succeed by retrying.
    if (!this.attachmentId) this.active = false;

    this.fire('connect_error', new Error(payload.message || 'relay error'));
  }

  private setConnected(): void {
    this.connected = true;
    this.active = true;
    this.fire('connect');
  }

  private setDisconnected(reason: unknown): void {
    if (!this.connected) return;

    this.connected = false;
    this.fire('disconnect', reason);
  }

  private fire(event: string, ...args: unknown[]): void {
    for (const listener of [...(this.listeners.get(event) ?? [])]) listener(...args);
  }
}
