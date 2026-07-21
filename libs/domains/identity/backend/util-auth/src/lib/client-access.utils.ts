import { ForbiddenException } from '@nestjs/common';
import { Request } from 'express';

import type { ClientUserEntity } from './entities/client-user.entity';
import { ClientUserRole } from './entities/client-user.entity';
import type { ClientEntityLike } from './entities/client.entity.types';
import { UserRole } from './entities/user.entity';

/** Minimal interface for client access check - findById */
export interface ClientAccessClientsRepository {
  findById(id: string): Promise<ClientEntityLike | null>;
}

/** Minimal interface for client access check - findUserClientAccess */
export interface ClientAccessClientUsersRepository {
  findUserClientAccess(userId: string, clientId: string): Promise<ClientUserEntity | null>;
}

export interface RequestWithUser extends Request {
  user?: {
    id: string;
    email?: string;
    roles?: string[];
    username?: string;
    amr?: string[];
    scopes?: string[];
  };
  apiKeyAuthenticated?: boolean;
  /** Set when Keycloak-mode accepts an app-signed PAT JWT instead of an OIDC token. */
  patAuthenticated?: boolean;
}

/** User info from socket auth (stored in socket.data) */
export interface SocketUserInfo {
  userId?: string;
  userRole?: UserRole;
  isApiKeyAuth: boolean;
  /** Present for users-mode JWT sockets (`pwd`; PAT sessions are rejected). */
  amr?: string[];
  user?: { id: string; email?: string; roles?: string[]; amr?: string[] };
}

/**
 * Build a RequestWithUser-like object from socket auth data for use with ensureClientAccess.
 */
export function buildRequestFromSocketUser(socketUser: SocketUserInfo): RequestWithUser {
  const user =
    socketUser.user ??
    (socketUser.userId ? { id: socketUser.userId, roles: [] as string[], amr: socketUser.amr } : undefined);

  return {
    user: user
      ? {
          ...user,
          amr: user.amr ?? socketUser.amr,
        }
      : undefined,
    apiKeyAuthenticated: socketUser.isApiKeyAuth,
  } as RequestWithUser;
}

export interface UserInfoFromRequest {
  userId?: string;
  userRole?: UserRole;
  isApiKeyAuth: boolean;
  amr?: string[];
  scopes?: string[];
}

export interface ClientAccessResult {
  hasAccess: boolean;
  isClientCreator: boolean;
  clientUserRole?: ClientUserRole;
}

/** Stable message when a workspace member lacks permission to change configuration. */
export const WORKSPACE_MANAGEMENT_FORBIDDEN_MESSAGE = 'Workspace admin or owner role required';

/**
 * Whether the caller may mutate workspace configuration (autonomy, env vars, agents, client settings).
 * API key and global admins may always manage; otherwise workspace creator or client_users admin may manage.
 */
export function canManageWorkspaceConfiguration(userInfo: UserInfoFromRequest, access: ClientAccessResult): boolean {
  if (userInfo.isApiKeyAuth) {
    return true;
  }

  // PAT sessions must not inherit console admin powers from the JWT role claim alone.
  if (userInfo.userRole === UserRole.ADMIN && !(userInfo.amr ?? []).includes('pat')) {
    return true;
  }

  if (!access.hasAccess) {
    return false;
  }

  if (access.isClientCreator) {
    return true;
  }

  if (access.clientUserRole === ClientUserRole.ADMIN) {
    return true;
  }

  return false;
}

/**
 * Ensure the user may mutate workspace configuration; throws {@link ForbiddenException} if not.
 */
export async function ensureWorkspaceManagementAccess(
  clientsRepository: ClientAccessClientsRepository,
  clientUsersRepository: ClientAccessClientUsersRepository,
  clientId: string,
  req?: RequestWithUser,
): Promise<void> {
  const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
  const access = await checkClientAccess(
    clientsRepository,
    clientUsersRepository,
    clientId,
    userInfo.userId,
    userInfo.userRole,
    userInfo.isApiKeyAuth,
    { amr: userInfo.amr },
  );

  if (!access.hasAccess) {
    throw new ForbiddenException('You do not have access to this client');
  }

  if (!canManageWorkspaceConfiguration(userInfo, access)) {
    throw new ForbiddenException(WORKSPACE_MANAGEMENT_FORBIDDEN_MESSAGE);
  }
}

/**
 * Same as {@link ensureWorkspaceManagementAccess} but with explicit user fields (for services without a Request).
 */
export async function assertWorkspaceManagementAccessForUser(
  clientsRepository: ClientAccessClientsRepository,
  clientUsersRepository: ClientAccessClientUsersRepository,
  clientId: string,
  userId: string | undefined,
  userRole: UserRole | undefined,
  isApiKeyAuth: boolean,
  options?: { amr?: string[] },
): Promise<void> {
  const access = await checkClientAccess(
    clientsRepository,
    clientUsersRepository,
    clientId,
    userId,
    userRole,
    isApiKeyAuth,
    options,
  );

  if (!access.hasAccess) {
    throw new ForbiddenException('You do not have access to this client');
  }

  const userInfo: UserInfoFromRequest = isApiKeyAuth
    ? { isApiKeyAuth: true }
    : { userId, userRole, isApiKeyAuth: false, amr: options?.amr };

  if (!canManageWorkspaceConfiguration(userInfo, access)) {
    throw new ForbiddenException(WORKSPACE_MANAGEMENT_FORBIDDEN_MESSAGE);
  }
}

/**
 * Extract user information from request for permission checks.
 * @param req - The request object
 * @returns User information or undefined
 */
export function getUserFromRequest(req: RequestWithUser): UserInfoFromRequest {
  const isApiKeyAuth = !!req.apiKeyAuthenticated;

  if (isApiKeyAuth) {
    return { isApiKeyAuth: true };
  }

  const user = req.user;

  if (!user?.id) {
    return { isApiKeyAuth: false };
  }

  let userRole: UserRole = UserRole.USER;

  if (user.roles?.includes('admin') || user.roles?.includes(UserRole.ADMIN)) {
    userRole = UserRole.ADMIN;
  }

  return {
    userId: user.id,
    userRole,
    isApiKeyAuth: false,
    amr: user.amr,
    scopes: user.scopes,
  };
}

/**
 * When the caller authenticated via PAT, require all listed scopes (no-op for password/API-key).
 */
export function assertPatScopes(userInfo: UserInfoFromRequest, ...requiredScopes: string[]): void {
  if (userInfo.isApiKeyAuth || !(userInfo.amr ?? []).includes('pat')) {
    return;
  }

  const tokenScopes = new Set(userInfo.scopes ?? []);
  const missing = requiredScopes.filter((scope) => !tokenScopes.has(scope));

  if (missing.length > 0) {
    throw new ForbiddenException(`Insufficient token scope. Missing: ${missing.join(', ')}`);
  }
}

/**
 * Check if user has access to a client and get their client role.
 * @param clientsRepository - Repository for client lookup
 * @param clientUsersRepository - Repository for client-user relationship lookup
 * @param clientId - The UUID of the client
 * @param userId - The UUID of the user
 * @param userRole - The role of the user (from users table)
 * @param isApiKeyAuth - Whether the request is authenticated via API key
 * @returns Object with access status and client user role if applicable
 */
export async function checkClientAccess(
  clientsRepository: ClientAccessClientsRepository,
  clientUsersRepository: ClientAccessClientUsersRepository,
  clientId: string,
  userId: string | undefined,
  userRole: UserRole | undefined,
  isApiKeyAuth: boolean,
  options?: { amr?: string[] },
): Promise<ClientAccessResult> {
  if (isApiKeyAuth) {
    return { hasAccess: true, isClientCreator: false };
  }

  if (!userId || !userRole) {
    return { hasAccess: false, isClientCreator: false };
  }

  // Console admins bypass membership; PAT JWTs must not inherit that via role alone.
  if (userRole === UserRole.ADMIN && !(options?.amr ?? []).includes('pat')) {
    return { hasAccess: true, isClientCreator: false };
  }

  const client = await clientsRepository.findById(clientId);

  if (!client) {
    return { hasAccess: false, isClientCreator: false };
  }

  const isClientCreator = client.userId === userId;
  const clientUser = await clientUsersRepository.findUserClientAccess(userId, clientId);

  if (clientUser) {
    return { hasAccess: true, isClientCreator, clientUserRole: clientUser.role };
  }

  if (isClientCreator) {
    return { hasAccess: true, isClientCreator: true };
  }

  return { hasAccess: false, isClientCreator: false };
}

/**
 * Ensure user has access to a client, throwing ForbiddenException if not.
 * @param clientsRepository - Repository for client lookup
 * @param clientUsersRepository - Repository for client-user relationship lookup
 * @param clientId - The UUID of the client
 * @param req - The request object
 * @returns Access information including client user role
 */
export async function ensureClientAccess(
  clientsRepository: ClientAccessClientsRepository,
  clientUsersRepository: ClientAccessClientUsersRepository,
  clientId: string,
  req?: RequestWithUser,
): Promise<{ isClientCreator: boolean; clientUserRole?: ClientUserRole }> {
  const userInfo = getUserFromRequest(req || ({} as RequestWithUser));
  const access = await checkClientAccess(
    clientsRepository,
    clientUsersRepository,
    clientId,
    userInfo.userId,
    userInfo.userRole,
    userInfo.isApiKeyAuth,
    { amr: userInfo.amr },
  );

  if (!access.hasAccess) {
    throw new ForbiddenException('You do not have access to this client');
  }

  return { isClientCreator: access.isClientCreator, clientUserRole: access.clientUserRole };
}
