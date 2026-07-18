import { ForbiddenException } from '@nestjs/common';

import {
  assertPatScopes,
  assertWorkspaceManagementAccessForUser,
  buildRequestFromSocketUser,
  canManageWorkspaceConfiguration,
  checkClientAccess,
  ensureClientAccess,
  ensureWorkspaceManagementAccess,
  getUserFromRequest,
  WORKSPACE_MANAGEMENT_FORBIDDEN_MESSAGE,
  type RequestWithUser,
  type UserInfoFromRequest,
} from './client-access.utils';
import { ClientUserRole } from './entities/client-user.entity';
import { UserRole } from './entities/user.entity';

describe('client-access.utils', () => {
  const mockClientsRepository = {
    findById: jest.fn(),
  };
  const mockClientUsersRepository = {
    findUserClientAccess: jest.fn(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getUserFromRequest', () => {
    it('should return isApiKeyAuth when apiKeyAuthenticated is true', () => {
      const req = { apiKeyAuthenticated: true } as RequestWithUser;
      const result = getUserFromRequest(req);

      expect(result).toEqual({ isApiKeyAuth: true });
    });

    it('should return userId and userRole when user is present', () => {
      const req = {
        apiKeyAuthenticated: false,
        user: { id: 'user-1', email: 'test@example.com', roles: ['user'] },
      } as RequestWithUser;
      const result = getUserFromRequest(req);

      expect(result).toEqual({
        userId: 'user-1',
        userRole: UserRole.USER,
        isApiKeyAuth: false,
      });
    });

    it('should return ADMIN role when user has admin in roles', () => {
      const req = {
        apiKeyAuthenticated: false,
        user: { id: 'user-1', roles: ['admin'] },
      } as RequestWithUser;
      const result = getUserFromRequest(req);

      expect(result.userRole).toBe(UserRole.ADMIN);
    });

    it('should include amr and scopes from the request user', () => {
      const req = {
        apiKeyAuthenticated: false,
        user: { id: 'user-1', roles: ['user'], amr: ['pat'], scopes: ['usage:write'] },
      } as RequestWithUser;

      expect(getUserFromRequest(req)).toEqual({
        userId: 'user-1',
        userRole: UserRole.USER,
        isApiKeyAuth: false,
        amr: ['pat'],
        scopes: ['usage:write'],
      });
    });

    it('should return isApiKeyAuth false when no user', () => {
      const req = {} as RequestWithUser;
      const result = getUserFromRequest(req);

      expect(result).toEqual({ isApiKeyAuth: false });
    });
  });

  describe('buildRequestFromSocketUser', () => {
    it('builds a request from socket user payload and amr', () => {
      const request = buildRequestFromSocketUser({
        userId: 'user-1',
        isApiKeyAuth: false,
        amr: ['pwd'],
        user: { id: 'user-1', email: 'a@b.c', roles: ['user'], amr: ['pwd'] },
      });

      expect(request.apiKeyAuthenticated).toBe(false);
      expect(request.user).toEqual({
        id: 'user-1',
        email: 'a@b.c',
        roles: ['user'],
        amr: ['pwd'],
      });
    });

    it('falls back to userId when socket.user is absent', () => {
      const request = buildRequestFromSocketUser({
        userId: 'user-2',
        isApiKeyAuth: false,
        amr: ['pat'],
      });

      expect(request.user).toEqual({ id: 'user-2', roles: [], amr: ['pat'] });
    });
  });

  describe('assertPatScopes', () => {
    it('no-ops for password and API-key sessions', () => {
      expect(() =>
        assertPatScopes({ userId: 'u1', userRole: UserRole.USER, isApiKeyAuth: false, amr: ['pwd'] }, 'usage:write'),
      ).not.toThrow();
      expect(() => assertPatScopes({ isApiKeyAuth: true }, 'usage:write')).not.toThrow();
    });

    it('allows PAT sessions that include required scopes', () => {
      expect(() =>
        assertPatScopes(
          {
            userId: 'u1',
            userRole: UserRole.USER,
            isApiKeyAuth: false,
            amr: ['pat'],
            scopes: ['usage:write', 'tickets:read'],
          },
          'usage:write',
        ),
      ).not.toThrow();
    });

    it('throws when PAT session is missing required scopes', () => {
      expect(() =>
        assertPatScopes(
          {
            userId: 'u1',
            userRole: UserRole.USER,
            isApiKeyAuth: false,
            amr: ['pat'],
            scopes: ['tickets:read'],
          },
          'usage:write',
          'webhooks:admin',
        ),
      ).toThrow(/Insufficient token scope\. Missing: usage:write, webhooks:admin/);
    });
  });

  describe('checkClientAccess', () => {
    it('should grant access for API key auth', async () => {
      const result = await checkClientAccess(
        mockClientsRepository as any,
        mockClientUsersRepository as any,
        'client-1',
        undefined,
        undefined,
        true,
      );

      expect(result).toEqual({ hasAccess: true, isClientCreator: false });
      expect(mockClientsRepository.findById).not.toHaveBeenCalled();
    });

    it('should deny access when no userId or userRole', async () => {
      const result = await checkClientAccess(
        mockClientsRepository as any,
        mockClientUsersRepository as any,
        'client-1',
        undefined,
        undefined,
        false,
      );

      expect(result).toEqual({ hasAccess: false, isClientCreator: false });
    });

    it('should grant access for global admin', async () => {
      const result = await checkClientAccess(
        mockClientsRepository as any,
        mockClientUsersRepository as any,
        'client-1',
        'user-1',
        UserRole.ADMIN,
        false,
      );

      expect(result).toEqual({ hasAccess: true, isClientCreator: false });
      expect(mockClientsRepository.findById).not.toHaveBeenCalled();
    });

    it('should not grant global-admin bypass for PAT sessions', async () => {
      mockClientsRepository.findById.mockResolvedValue(null);

      const result = await checkClientAccess(
        mockClientsRepository as any,
        mockClientUsersRepository as any,
        'client-1',
        'user-1',
        UserRole.ADMIN,
        false,
        { amr: ['pat'] },
      );

      expect(result).toEqual({ hasAccess: false, isClientCreator: false });
      expect(mockClientsRepository.findById).toHaveBeenCalled();
    });

    it('should grant access when user is client creator', async () => {
      mockClientsRepository.findById.mockResolvedValue({ id: 'client-1', userId: 'user-1' });
      mockClientUsersRepository.findUserClientAccess.mockResolvedValue(null);

      const result = await checkClientAccess(
        mockClientsRepository as any,
        mockClientUsersRepository as any,
        'client-1',
        'user-1',
        UserRole.USER,
        false,
      );

      expect(result).toEqual({ hasAccess: true, isClientCreator: true });
    });

    it('should grant access when user has client_user relationship', async () => {
      mockClientsRepository.findById.mockResolvedValue({ id: 'client-1', userId: 'other-user' });
      mockClientUsersRepository.findUserClientAccess.mockResolvedValue({
        userId: 'user-1',
        clientId: 'client-1',
        role: ClientUserRole.USER,
      });

      const result = await checkClientAccess(
        mockClientsRepository as any,
        mockClientUsersRepository as any,
        'client-1',
        'user-1',
        UserRole.USER,
        false,
      );

      expect(result).toEqual({
        hasAccess: true,
        isClientCreator: false,
        clientUserRole: ClientUserRole.USER,
      });
    });

    it('should deny access when user has no relationship', async () => {
      mockClientsRepository.findById.mockResolvedValue({ id: 'client-1', userId: 'other-user' });
      mockClientUsersRepository.findUserClientAccess.mockResolvedValue(null);

      const result = await checkClientAccess(
        mockClientsRepository as any,
        mockClientUsersRepository as any,
        'client-1',
        'user-1',
        UserRole.USER,
        false,
      );

      expect(result).toEqual({ hasAccess: false, isClientCreator: false });
    });

    it('should deny access when client not found', async () => {
      mockClientsRepository.findById.mockResolvedValue(null);

      const result = await checkClientAccess(
        mockClientsRepository as any,
        mockClientUsersRepository as any,
        'client-1',
        'user-1',
        UserRole.USER,
        false,
      );

      expect(result).toEqual({ hasAccess: false, isClientCreator: false });
    });
  });

  describe('ensureClientAccess', () => {
    it('should not throw when access is granted', async () => {
      mockClientsRepository.findById.mockResolvedValue({ id: 'client-1', userId: 'user-1' });
      mockClientUsersRepository.findUserClientAccess.mockResolvedValue(null);

      const req = { apiKeyAuthenticated: true } as RequestWithUser;
      const result = await ensureClientAccess(
        mockClientsRepository as any,
        mockClientUsersRepository as any,
        'client-1',
        req,
      );

      expect(result).toEqual({ isClientCreator: false });
    });

    it('should throw ForbiddenException when access is denied', async () => {
      mockClientsRepository.findById.mockResolvedValue({ id: 'client-1', userId: 'other-user' });
      mockClientUsersRepository.findUserClientAccess.mockResolvedValue(null);

      const req = { apiKeyAuthenticated: false, user: { id: 'user-1', roles: ['user'] } } as RequestWithUser;

      await expect(
        ensureClientAccess(mockClientsRepository as any, mockClientUsersRepository as any, 'client-1', req),
      ).rejects.toThrow(ForbiddenException);
    });
  });

  describe('canManageWorkspaceConfiguration', () => {
    it('returns true for API key auth regardless of access shape', () => {
      const userInfo: UserInfoFromRequest = { isApiKeyAuth: true };

      expect(canManageWorkspaceConfiguration(userInfo, { hasAccess: false, isClientCreator: false })).toBe(true);
    });

    it('returns true for global admin', () => {
      const userInfo: UserInfoFromRequest = {
        userId: 'u1',
        userRole: UserRole.ADMIN,
        isApiKeyAuth: false,
      };

      expect(canManageWorkspaceConfiguration(userInfo, { hasAccess: true, isClientCreator: false })).toBe(true);
    });

    it('returns false for PAT global admin without workspace membership', () => {
      const userInfo: UserInfoFromRequest = {
        userId: 'u1',
        userRole: UserRole.ADMIN,
        isApiKeyAuth: false,
        amr: ['pat'],
        scopes: ['usage:write'],
      };

      expect(canManageWorkspaceConfiguration(userInfo, { hasAccess: false, isClientCreator: false })).toBe(false);
    });

    it('returns true for workspace creator', () => {
      const userInfo: UserInfoFromRequest = {
        userId: 'u1',
        userRole: UserRole.USER,
        isApiKeyAuth: false,
      };

      expect(canManageWorkspaceConfiguration(userInfo, { hasAccess: true, isClientCreator: true })).toBe(true);
    });

    it('returns true for client_users admin', () => {
      const userInfo: UserInfoFromRequest = {
        userId: 'u1',
        userRole: UserRole.USER,
        isApiKeyAuth: false,
      };

      expect(
        canManageWorkspaceConfiguration(userInfo, {
          hasAccess: true,
          isClientCreator: false,
          clientUserRole: ClientUserRole.ADMIN,
        }),
      ).toBe(true);
    });

    it('returns false for plain client user', () => {
      const userInfo: UserInfoFromRequest = {
        userId: 'u1',
        userRole: UserRole.USER,
        isApiKeyAuth: false,
      };

      expect(
        canManageWorkspaceConfiguration(userInfo, {
          hasAccess: true,
          isClientCreator: false,
          clientUserRole: ClientUserRole.USER,
        }),
      ).toBe(false);
    });

    it('returns false when no access', () => {
      const userInfo: UserInfoFromRequest = {
        userId: 'u1',
        userRole: UserRole.USER,
        isApiKeyAuth: false,
      };

      expect(canManageWorkspaceConfiguration(userInfo, { hasAccess: false, isClientCreator: false })).toBe(false);
    });
  });

  describe('ensureWorkspaceManagementAccess', () => {
    it('throws workspace management message for plain client user with access', async () => {
      mockClientsRepository.findById.mockResolvedValue({ id: 'client-1', userId: 'other' });
      mockClientUsersRepository.findUserClientAccess.mockResolvedValue({
        userId: 'user-1',
        clientId: 'client-1',
        role: ClientUserRole.USER,
      });

      const req = { apiKeyAuthenticated: false, user: { id: 'user-1', roles: ['user'] } } as RequestWithUser;

      await expect(
        ensureWorkspaceManagementAccess(
          mockClientsRepository as any,
          mockClientUsersRepository as any,
          'client-1',
          req,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ message: WORKSPACE_MANAGEMENT_FORBIDDEN_MESSAGE }),
      });
    });

    it('does not throw for client admin', async () => {
      mockClientsRepository.findById.mockResolvedValue({ id: 'client-1', userId: 'other' });
      mockClientUsersRepository.findUserClientAccess.mockResolvedValue({
        userId: 'user-1',
        clientId: 'client-1',
        role: ClientUserRole.ADMIN,
      });

      const req = { apiKeyAuthenticated: false, user: { id: 'user-1', roles: ['user'] } } as RequestWithUser;

      await expect(
        ensureWorkspaceManagementAccess(
          mockClientsRepository as any,
          mockClientUsersRepository as any,
          'client-1',
          req,
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe('assertWorkspaceManagementAccessForUser', () => {
    it('throws workspace management message for plain client user', async () => {
      mockClientsRepository.findById.mockResolvedValue({ id: 'client-1', userId: 'other' });
      mockClientUsersRepository.findUserClientAccess.mockResolvedValue({
        userId: 'user-1',
        clientId: 'client-1',
        role: ClientUserRole.USER,
      });

      await expect(
        assertWorkspaceManagementAccessForUser(
          mockClientsRepository as any,
          mockClientUsersRepository as any,
          'client-1',
          'user-1',
          UserRole.USER,
          false,
        ),
      ).rejects.toMatchObject({
        response: expect.objectContaining({ message: WORKSPACE_MANAGEMENT_FORBIDDEN_MESSAGE }),
      });
    });
  });
});
