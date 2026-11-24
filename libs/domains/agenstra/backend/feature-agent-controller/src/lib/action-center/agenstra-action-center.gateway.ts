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
  INSTANCE_SCOPE_KEY,
  toActionCenterViewerRole,
  type ActionCenterSocketAuthResult,
  type ActionCenterViewer,
} from '@forepath/shared/backend';
import { resolveWebsocketCorsOrigin } from '@forepath/shared/shared/util-network-address';
import { WebSocketGateway } from '@nestjs/websockets';
import type { Socket } from 'socket.io';

/**
 * Live action center of the agent console (`socket/action-center`). Interactive admin / manager sessions only; PATs,
 * app tokens and the static credential are rejected. Sessions are re-validated periodically (token expiry /
 * revocation, lock, current role in the users table).
 */
@WebSocketGateway({
  namespace: process.env.ACTION_CENTER_WEBSOCKET_NAMESPACE || ACTION_CENTER_DEFAULT_NAMESPACE,
  cors: { origin: resolveWebsocketCorsOrigin() },
})
export class AgenstraActionCenterGateway extends ActionCenterGatewayBase {
  constructor(
    realtime: ActionCenterRealtimeService,
    private readonly socketAuthService: SocketAuthService,
    private readonly usersRepository: UsersRepository,
  ) {
    super(realtime);
  }

  protected async authenticate(socket: Socket): Promise<ActionCenterSocketAuthResult | null> {
    const rawHeader = socket.handshake?.headers?.authorization ?? socket.handshake?.auth?.['Authorization'];
    const authHeader = typeof rawHeader === 'string' ? rawHeader : undefined;
    const check = async (): Promise<ActionCenterViewer | null> => {
      // No `websocket` option: machine tokens (PAT / app tokens) are rejected by the auth service itself.
      const userInfo = await this.socketAuthService.validateAndGetUser(authHeader, undefined, {
        transportSocket: socket.request?.socket,
      });

      if (!userInfo || userInfo.isApiKeyAuth || isMachineSocketUser(userInfo) || !userInfo.userId) {
        return null;
      }

      // The current role from the users table (a token may still carry a role that was revoked meanwhile).
      const user = await this.usersRepository.findById(userInfo.userId);
      const role = user && !user.lockedAt ? toActionCenterViewerRole(normalizeConsoleUserRole(user.role)) : null;

      return role ? { userId: userInfo.userId, role, scopeKey: INSTANCE_SCOPE_KEY } : null;
    };
    const viewer = await check();

    return viewer ? { viewer, revalidate: check } : null;
  }
}
