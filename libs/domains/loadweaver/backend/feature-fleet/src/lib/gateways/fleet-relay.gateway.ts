import { randomUUID } from 'node:crypto';

import { buildRequestFromSocketUser, SocketAuthService, type SocketUserInfo } from '@forepath/identity/backend';
import { createCorrelationAwareSocketIoClient } from '@forepath/shared/backend/util-http-context';
import { resolveWebsocketCorsOrigin } from '@forepath/shared/shared/util-network-address';
import { Logger, type OnModuleDestroy, Optional } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import type { Subscription } from 'rxjs';
import type { Socket as ClientSocket } from 'socket.io-client';

import { FLEET_ON_BEHALF_OF_HEADER, FLEET_SOCKET_NAMESPACE } from '../constants/fleet.constants';
import { FleetAccessEvents } from '../services/fleet-access-events.service';
import { FleetAccessService, fleetCallerFromRequest } from '../services/fleet-access.service';
import { FleetAuditService } from '../services/fleet-audit.service';
import { FleetIdentityService } from '../services/fleet-identity.service';
import { createClusterAgent } from '../services/fleet-cluster-client.service';
import type { FleetCaller } from '../utils/fleet-access.utils';
import { clusterTlsRejectUnauthorized, normalizeClusterEndpoint } from '../utils/fleet-endpoint-security';
import { authorizeSocketNamespace } from '../utils/relay-rules';
import { sanitizeHeaderValue } from '../utils/relay-headers';

const MAX_ATTACHMENTS = 8;
const INTERNAL_EVENTS = new Set([
  'connect',
  'disconnect',
  'connect_error',
  'reconnect',
  'reconnect_attempt',
  'reconnecting',
  'reconnect_error',
  'reconnect_failed',
  'ping',
  'pong',
]);
const EVENT_NAME = /^[A-Za-z][A-Za-z0-9:_-]{0,63}$/;

type FleetSocket = Socket & { data: { userInfo?: SocketUserInfo; authorization?: string } };

interface Attachment {
  id: string;
  clusterId: string;
  namespace: string;
  remote: ClientSocket;
  /** The console socket that attached (re-checks close attachments on it). */
  socket: Socket;
  agent?: { destroy(): void };
}

/** How often attached callers are re-checked (token still valid, grant / grace still allow the namespace). */
export function fleetSocketRecheckMs(env: NodeJS.ProcessEnv = process.env): number {
  const parsed = Number.parseInt(env['FLEET_SOCKET_RECHECK_MS'] ?? '', 10);

  return Number.isFinite(parsed) && parsed >= 5_000 ? parsed : 60_000;
}

/** Socket.IO URL + path of a control-plane namespace behind `endpoint` (which may carry a base path). */
export function socketTarget(endpoint: string, namespace: string): { url: string; path: string } {
  const url = new URL(endpoint);
  const base = url.pathname.replace(/\/+$/, '');

  return { url: `${url.protocol}//${url.host}/socket/${namespace}`, path: `${base}/socket.io` };
}

/**
 * Socket relay (3.24, Agenstra's controller ↔ manager socket proxy): a console socket on `socket/fleet` attaches
 * to live namespaces of clusters (`plans`, `topology`, `logs`, `terminals`), each attachment an isolated remote
 * socket authenticated with the cluster's service credential. Remote events reach only the socket that attached;
 * cluster-wide grants are required (streams carry data of every project the service user sees), terminals need
 * operator and are closed during the read-only grace.
 *
 * Events: `attach {clusterId, namespace}` → `attached {attachmentId, …}`; `emit {attachmentId, event, args}` →
 * remote; remote events → `event {attachmentId, event, args}`; `detach {attachmentId}`; failures → `relayError`.
 *
 * Attachments are long-lived, so access is re-checked every {@link fleetSocketRecheckMs} (and right away when
 * grants / the connection / the grace of a cluster change in this replica): the caller's token is validated again
 * and each attachment re-authorised; whatever is no longer allowed is closed (`detached` with reason
 * `access-revoked`, or the whole console socket when the token is gone). Remote connections use the SSRF-guarded
 * agent (`lookup` validates the resolved addresses), like the REST relay.
 */
@WebSocketGateway({ namespace: FLEET_SOCKET_NAMESPACE, cors: { origin: resolveWebsocketCorsOrigin() } })
export class FleetRelayGateway implements OnGatewayInit, OnGatewayDisconnect, OnModuleDestroy {
  private readonly logger = new Logger(FleetRelayGateway.name);
  private readonly attachments = new Map<string, Map<string, Attachment>>();
  private timer?: ReturnType<typeof setInterval>;
  private subscription?: Subscription;
  private rechecking = false;
  private recheckPending = false;

  constructor(
    private readonly socketAuth: SocketAuthService,
    private readonly access: FleetAccessService,
    private readonly audit: FleetAuditService,
    @Optional() private readonly accessEvents?: FleetAccessEvents,
    @Optional() private readonly identity?: FleetIdentityService,
  ) {}

  afterInit(server: Server): void {
    server.use(async (socket, next) => {
      const header = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.['Authorization'];
      const authorization = typeof header === 'string' ? header : undefined;
      const userInfo = await this.socketAuth.validateAndGetUser(authorization);

      if (!userInfo) {
        next(new Error('Unauthorized'));

        return;
      }

      (socket as FleetSocket).data = { userInfo, authorization };
      next();
    });

    this.timer = setInterval(() => void this.recheckAll(), fleetSocketRecheckMs());
    this.timer.unref?.();
    this.subscription = this.accessEvents?.changed.subscribe((clusterId) => void this.recheckAll(clusterId));
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);

    this.subscription?.unsubscribe();
  }

  handleDisconnect(socket: Socket): void {
    for (const attachment of this.attachments.get(socket.id)?.values() ?? []) this.close(attachment);

    this.attachments.delete(socket.id);
  }

  private close(attachment: Attachment): void {
    try {
      attachment.remote.removeAllListeners();
      attachment.remote.disconnect();
    } catch {
      // already gone
    }

    attachment.agent?.destroy();
  }

  private revoke(attachment: Attachment, reason: string): void {
    this.close(attachment);
    this.attachments.get(attachment.socket.id)?.delete(attachment.id);
    attachment.socket.emit('detached', { attachmentId: attachment.id, reason: 'access-revoked', message: reason });
  }

  /** Is the attachment still allowed for this caller (cluster visible, grant / grace allow the namespace)? */
  private async stillAllowed(caller: FleetCaller, attachment: Attachment): Promise<string | null> {
    try {
      const { access } = await this.access.visibleCluster(caller, attachment.clusterId);
      const decision = authorizeSocketNamespace(attachment.namespace, access);

      return decision.allowed === true ? null : (decision as { reason: string }).reason;
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
  }

  /**
   * Re-checks every attached console socket (or only attachments of one cluster): token, grant, grace. Sockets
   * whose token no longer validates are disconnected; attachments no longer allowed are closed.
   */
  async recheckAll(clusterId?: string): Promise<void> {
    if (this.rechecking) {
      // A change arrived during a run: one full run afterwards covers it.
      this.recheckPending = true;

      return;
    }

    this.rechecking = true;

    try {
      for (const own of [...this.attachments.values()]) {
        const attachments = [...own.values()].filter((a) => !clusterId || a.clusterId === clusterId);

        if (!attachments.length) continue;

        const socket = attachments[0].socket as FleetSocket;
        const userInfo = await this.socketAuth.validateAndGetUser(socket.data?.authorization).catch(() => null);

        if (!userInfo) {
          for (const attachment of [...own.values()]) this.revoke(attachment, 'the session is no longer valid');

          this.attachments.delete(socket.id);
          socket.disconnect(true);
          continue;
        }

        socket.data.userInfo = userInfo;

        const caller = fleetCallerFromRequest(buildRequestFromSocketUser(userInfo));

        for (const attachment of attachments) {
          const reason = await this.stillAllowed(caller, attachment);

          if (reason !== null) this.revoke(attachment, reason);
        }
      }
    } catch (error) {
      this.logger.warn(`Socket access re-check failed: ${error instanceof Error ? error.message : error}`);
    } finally {
      this.rechecking = false;
    }

    if (this.recheckPending) {
      this.recheckPending = false;
      await this.recheckAll();
    }
  }

  @SubscribeMessage('attach')
  async attach(
    @MessageBody() body: { clusterId?: unknown; namespace?: unknown },
    @ConnectedSocket() socket: Socket,
  ): Promise<void> {
    const s = socket as FleetSocket;
    const clusterId = typeof body?.clusterId === 'string' ? body.clusterId : '';
    const namespace = typeof body?.namespace === 'string' ? body.namespace : '';

    try {
      if (!s.data?.userInfo) throw new Error('Unauthorized');

      const own = this.attachments.get(socket.id) ?? new Map<string, Attachment>();

      if (own.size >= MAX_ATTACHMENTS) throw new Error(`at most ${MAX_ATTACHMENTS} attachments per socket`);

      const caller = fleetCallerFromRequest(buildRequestFromSocketUser(s.data.userInfo));
      const { cluster, access } = await this.access.visibleCluster(caller, clusterId);
      const decision = authorizeSocketNamespace(namespace, access);

      if (decision.allowed !== true) throw new Error((decision as { reason: string }).reason);

      // Project grants on person-scoped streams (2026-10-27): only to clusters that verify this fleet's claims, with a
      // fresh signed claim of the person on every (re)connect — the cluster forwards only that person's events.
      const needsClaim = !!(decision as { needsClaim?: boolean }).needsClaim;

      if (needsClaim) {
        if (cluster.health?.identity !== 'verified' || !this.identity)
          throw new Error('live updates for project grants need the cluster to trust this fleet');

        if (!caller.userId || caller.isApiKey) throw new Error('live updates for project grants need a signed-in user');
      }

      const identity = this.identity;
      const audience = cluster.health?.clusterId ?? '';
      const claim = (): Promise<string | null> =>
        needsClaim && identity
          ? identity.claimFor(caller, access, { audience, method: 'SOCKET', url: `/socket/${namespace}`, body: null })
          : Promise.resolve(null);

      const { endpoint } = normalizeClusterEndpoint(cluster.endpoint);
      const target = socketTarget(endpoint, namespace);
      // Same SSRF guard as the REST relay: the agent's lookup refuses private / loopback answers (DNS rebinding).
      const agent = createClusterAgent(cluster, endpoint.startsWith('https:'));
      const remote = createCorrelationAwareSocketIoClient(target.url, {
        path: target.path,
        transports: ['websocket'],
        agent,
        extraHeaders: {
          Authorization: `Bearer ${cluster.credential}`,
          [FLEET_ON_BEHALF_OF_HEADER]: sanitizeHeaderValue(caller.label),
        },
        // The signed claim travels in the handshake's auth, minted anew for every (re)connect (short-lived).
        ...(needsClaim
          ? {
              auth: (cb: (data: object) => void) =>
                void claim()
                  .then((token) => cb(token ? { fleetIdentity: token } : {}))
                  .catch(() => cb({})),
            }
          : {}),
        rejectUnauthorized: clusterTlsRejectUnauthorized(),
        ...(cluster.caCertificate ? { ca: cluster.caCertificate } : {}),
        reconnection: true,
        reconnectionAttempts: 5,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
      }) as unknown as ClientSocket;
      const attachment: Attachment = { id: randomUUID(), clusterId: cluster.id, namespace, remote, socket, agent };

      remote.on('error', () => undefined);
      remote.on('connect_error', (error: Error) =>
        socket.emit('relayError', { attachmentId: attachment.id, message: `cluster: ${error.message}` }),
      );
      remote.on('disconnect', (reason: string) => socket.emit('detached', { attachmentId: attachment.id, reason }));
      // SECURITY: the closure binds remote events to the socket that attached (Agenstra's isolation rule).
      remote.onAny((event: string, ...args: unknown[]) => {
        if (INTERNAL_EVENTS.has(event) || (event === 'error' && args[0] instanceof Error)) return;

        socket.emit('event', { attachmentId: attachment.id, event, args });
      });

      own.set(attachment.id, attachment);
      this.attachments.set(socket.id, own);
      socket.emit('attached', { attachmentId: attachment.id, clusterId: cluster.id, namespace });

      if (namespace === 'terminals' || namespace === 'consoles')
        await this.audit.recordQuietly(
          caller,
          'relay.socket-attached',
          `cluster/${cluster.id}/socket/${namespace}`,
          {},
          cluster.id,
        );
    } catch (error) {
      socket.emit('relayError', {
        clusterId,
        namespace,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  @SubscribeMessage('emit')
  forward(
    @MessageBody() body: { attachmentId?: unknown; event?: unknown; args?: unknown },
    @ConnectedSocket() socket: Socket,
  ): void {
    const attachment = this.attachments.get(socket.id)?.get(String(body?.attachmentId ?? ''));
    const event = typeof body?.event === 'string' ? body.event : '';

    if (!attachment || !EVENT_NAME.test(event) || INTERNAL_EVENTS.has(event)) {
      socket.emit('relayError', { attachmentId: body?.attachmentId ?? null, message: 'unknown attachment or event' });

      return;
    }

    attachment.remote.emit(event, ...(Array.isArray(body.args) ? body.args : []));
  }

  @SubscribeMessage('detach')
  detach(@MessageBody() body: { attachmentId?: unknown }, @ConnectedSocket() socket: Socket): void {
    const own = this.attachments.get(socket.id);
    const attachment = own?.get(String(body?.attachmentId ?? ''));

    if (!attachment) return;

    this.close(attachment);
    own?.delete(attachment.id);
    socket.emit('detached', { attachmentId: attachment.id, reason: 'detached' });
  }
}
