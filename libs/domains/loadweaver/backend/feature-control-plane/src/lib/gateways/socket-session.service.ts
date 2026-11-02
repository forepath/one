import {
  buildRequestFromSocketUser,
  getAuthenticationMethod,
  PatBearerAuthGuard,
  SocketAuthService,
  UsersAuthGuard,
  type RequestWithUser,
  type SocketUserInfo,
} from '@forepath/identity/backend';
import { Injectable, Optional, type CanActivate, type ExecutionContext } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';

import {
  fleetIdentityIgnoredReason,
  mayCarryFleetIdentity,
  type FleetIdentityRequest,
  type VerifiedFleetIdentity,
} from '../fleet-identity/fleet-identity.utils';
import { TrustedFleetsService } from '../fleet-identity/trusted-fleets.service';
import { ON_BEHALF_OF_SCOPE } from '../services/audit-log.service';

/**
 * The scope a personal access token needs per socket namespace — the scope of the matching HTTP reads (machine
 * sessions on sockets, user decision 2026-10-31): plans `GET /plans`, topology `GET /topology`, logs `GET /logs`,
 * tunnels the tunnel list; consoles like the VM power actions; terminals like machine exec (a shell in a replica).
 * `socket/exec` keeps its own check (`live:exec`, `ExecGateway.authenticate`).
 */
export const SOCKET_PAT_SCOPES: Readonly<Record<string, string>> = {
  plans: 'resources:read',
  topology: 'cluster:read',
  logs: 'logs:read',
  tunnels: 'projects:read',
  consoles: 'live:access',
  terminals: 'live:exec',
};

/** A socket's authenticated session: the connecting credential and, through a fleet, the verified person. */
export interface SocketSession {
  userInfo: SocketUserInfo;
  fleetIdentity?: VerifiedFleetIdentity;
}

/** The request the access services see for a socket: the credential plus the verified person (capped by both). */
export function socketRequest(data: {
  userInfo?: SocketUserInfo;
  fleetIdentity?: VerifiedFleetIdentity;
}): FleetIdentityRequest {
  return Object.assign(buildRequestFromSocketUser(data.userInfo as SocketUserInfo), {
    ...(data.fleetIdentity ? { fleetIdentity: data.fleetIdentity } : {}),
  });
}

function handshakeContext(req: object): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({}), getNext: () => undefined }),
    getHandler: () => handshakeContext,
    getClass: () => SocketSessionService,
    getType: () => 'http',
    getArgs: () => [req],
    getArgByIndex: () => req,
  } as unknown as ExecutionContext;
}

type MachineUser = NonNullable<RequestWithUser['user']> & {
  id?: string;
  email?: string;
  roles?: string[];
  amr?: string[];
  scopes?: string[];
  patId?: string;
};

/**
 * Socket handshakes of the Loadweaver control plane (user decision 2026-10-31; Loadweaver only — the shared
 * `SocketAuthService` and Agenstra / Decabill keep their interactive-only sockets):
 * - **machine sessions** (a personal access token exchanged for its machine JWT, users and keycloak mode) are accepted
 *   on every namespace with their own roles and the namespace's HTTP scope (`SOCKET_PAT_SCOPES`), validated by the
 *   same guards as the API (revocation, expiry, scope changes and demotion apply);
 * - interactive sessions and the static API key as before (`SocketAuthService`);
 * - a **fleet identity claim** in the handshake (`auth.fleetIdentity`, the fleet's service PAT or the delegating API
 *   key) is verified like the HTTP relay's: the socket then acts as that person, capped by the credential's roles
 *   (`capRolesToFleetIdentity` in the access services). A claim that doesn't verify — malformed, from an untrusted
 *   fleet, refused, or on a credential that can't carry one — refuses the connection instead of being ignored.
 */
@Injectable()
export class SocketSessionService {
  constructor(
    private readonly socketAuth: SocketAuthService,
    private readonly moduleRef: ModuleRef,
    @Optional() private readonly fleets?: TrustedFleetsService,
  ) {}

  /** The handshake's session, or an error whose message the socket middleware hands to `next`. */
  async authenticate(
    handshake: { headers?: Record<string, unknown>; auth?: Record<string, unknown> } | undefined,
    namespace: string,
  ): Promise<SocketSession> {
    const header = handshake?.headers?.['authorization'] ?? handshake?.auth?.['Authorization'];
    const userInfo = await this.user(typeof header === 'string' ? header : undefined, namespace).catch(() => null);

    if (!userInfo) throw new Error('Unauthorized');

    const token = handshake?.auth?.['fleetIdentity'];

    if (token === undefined || token === null || token === '') return { userInfo };

    const req = socketRequest({ userInfo });

    if (!mayCarryFleetIdentity(req, ON_BEHALF_OF_SCOPE))
      throw new Error(`fleet identity claim refused: ${fleetIdentityIgnoredReason(req, ON_BEHALF_OF_SCOPE)}`);

    if (!this.fleets) throw new Error('fleet identity claim refused: fleet identities are not available');

    const evaluation = await this.fleets
      .evaluateSocket(token, namespace)
      .catch((error: Error) => ({ result: 'refused' as const, reason: error.message }));

    if (evaluation.result !== 'verified')
      throw new Error(`fleet identity claim refused: ${'reason' in evaluation ? evaluation.reason : 'no valid claim'}`);

    return { userInfo, fleetIdentity: evaluation.identity };
  }

  private async user(header: string | undefined, namespace: string): Promise<SocketUserInfo | null> {
    if (!header) return null;

    const method = getAuthenticationMethod();

    if (method === 'users' || method === 'keycloak') {
      const machine = await this.machineUser(header, namespace, method);

      if (machine !== undefined) return machine;
    }

    // Interactive sessions (console, Keycloak) and the static API key: unchanged.
    return await this.socketAuth.validateAndGetUser(header);
  }

  /**
   * A machine (PAT) session through the API's own guard: its user, null when it lacks the namespace's scope, or
   * undefined when the credential is no machine session (then the interactive rules decide).
   */
  private async machineUser(
    header: string,
    namespace: string,
    method: 'users' | 'keycloak',
  ): Promise<SocketUserInfo | null | undefined> {
    const guard = this.moduleRef.get<CanActivate>(method === 'users' ? UsersAuthGuard : PatBearerAuthGuard, {
      strict: false,
    });
    const req = {
      headers: { authorization: header },
      url: `/socket/${namespace}`,
      originalUrl: `/socket/${namespace}`,
    } as unknown as RequestWithUser;

    try {
      await guard.canActivate(handshakeContext(req));
    } catch {
      return undefined;
    }

    const user = req.user as MachineUser | undefined;

    if (!user?.id || !(user.amr ?? []).includes('pat')) return undefined;

    const scope = SOCKET_PAT_SCOPES[namespace];

    if (!scope || !(user.scopes ?? []).includes(scope)) return null;

    return {
      userId: user.id,
      isApiKeyAuth: false,
      amr: user.amr,
      user: {
        id: user.id,
        email: user.email,
        roles: user.roles ?? [],
        amr: user.amr,
        scopes: user.scopes,
        patId: user.patId,
      } as SocketUserInfo['user'],
    };
  }
}
