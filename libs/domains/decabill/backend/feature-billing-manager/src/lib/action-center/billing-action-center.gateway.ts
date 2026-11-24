import {
  isMachineSocketUser,
  normalizeConsoleUserRole,
  SocketAuthService,
  UsersRepository,
} from '@forepath/identity/backend';
import {
  ACTION_CENTER_DEFAULT_NAMESPACE,
  ActionCenterGatewayBase,
  ActionCenterRealtimeService,
  readIncomingTenantIdFromHandshake,
  toActionCenterViewerRole,
  type ActionCenterSocketAuthResult,
  type ActionCenterViewer,
} from '@forepath/shared/backend';
import { resolveWebsocketCorsOrigin } from '@forepath/shared/shared/util-network-address';
import { WebSocketGateway } from '@nestjs/websockets';
import type { Socket } from 'socket.io';

/**
 * Live action center of the billing console (`socket/action-center`). Interactive admin / manager sessions of the
 * handshake tenant only; PATs, app tokens and the static credential are rejected. Sessions are re-validated
 * periodically (token expiry / revocation, lock, current role in the users table).
 */
@WebSocketGateway({
  namespace: process.env.ACTION_CENTER_WEBSOCKET_NAMESPACE || ACTION_CENTER_DEFAULT_NAMESPACE,
  cors: { origin: resolveWebsocketCorsOrigin() },
})
export class BillingActionCenterGateway extends ActionCenterGatewayBase {
  constructor(
    realtime: ActionCenterRealtimeService,
    private readonly socketAuthService: SocketAuthService,
    private readonly usersRepository: UsersRepository,
  ) {
    super(realtime);
  }

  protected async authenticate(socket: Socket): Promise<ActionCenterSocketAuthResult | null> {
    const tenantId = readIncomingTenantIdFromHandshake(
      socket.handshake?.headers as Record<string, unknown> | undefined,
      socket.handshake?.auth as Record<string, unknown> | undefined,
    );
    const rawHeader = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.['Authorization'];
    const authHeader = typeof rawHeader === 'string' ? rawHeader : undefined;

    if (!tenantId) {
      return null;
    }

    const check = async (): Promise<ActionCenterViewer | null> => {
      // No `websocket` option: machine tokens (PAT / app tokens) are rejected by the auth service itself.
      const userInfo = await this.socketAuthService.validateAndGetUser(authHeader, tenantId, {
        transportSocket: socket.request?.socket,
      });

      if (!userInfo || userInfo.isApiKeyAuth || isMachineSocketUser(userInfo) || !userInfo.userId) {
        return null;
      }

      // The current role from the users table (a token may still carry a role that was revoked meanwhile).
      const user = await this.usersRepository.findByIdForTenant(userInfo.userId, tenantId);
      const role = user && !user.lockedAt ? toActionCenterViewerRole(normalizeConsoleUserRole(user.role)) : null;

      return role ? { userId: userInfo.userId, role, scopeKey: tenantId } : null;
    };
    const viewer = await check();

    return viewer ? { viewer, revalidate: check } : null;
  }
}
