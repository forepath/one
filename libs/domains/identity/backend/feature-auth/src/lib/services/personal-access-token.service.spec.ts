import { UserRole } from '@forepath/identity/backend';
import { BadRequestException, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';

import { PersonalAccessTokenService } from './personal-access-token.service';

describe('PersonalAccessTokenService', () => {
  const catalog = ['usage:write', 'webhooks:admin', 'invoices:read'] as const;
  const mockTokensRepository = {
    create: jest.fn(),
    findByPrefix: jest.fn(),
    findById: jest.fn(),
    findActiveByUserId: jest.fn(),
    findAllByUserId: jest.fn(),
    save: jest.fn(),
    touchLastUsedAtIfActive: jest.fn().mockResolvedValue(true),
  };
  const mockUsersRepository = {
    findByIdOrThrow: jest.fn(),
    findById: jest.fn(),
  };
  let service: PersonalAccessTokenService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new PersonalAccessTokenService(mockTokensRepository as any, mockUsersRepository as any, catalog);
  });

  it('filters admin-only scopes for non-admin catalog', () => {
    expect(service.getCatalogForRole(UserRole.USER)).toEqual(['invoices:read']);
    expect(service.getCatalogForRole(UserRole.ADMIN)).toEqual([...catalog]);
  });

  it('getCatalogForUser uses DB role', async () => {
    mockUsersRepository.findByIdOrThrow.mockResolvedValue({ id: 'u1', role: UserRole.USER });

    await expect(service.getCatalogForUser('u1')).resolves.toEqual(['invoices:read']);
  });

  it('creates a token with plaintext once', async () => {
    mockUsersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'u1',
      passwordHash: 'hash',
      role: UserRole.ADMIN,
    });
    mockTokensRepository.create.mockImplementation(async (data: Record<string, unknown>) => ({
      ...data,
      id: 't1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      revokedAt: null,
      lastUsedAt: null,
      expiresAt: null,
    }));

    const result = await service.create('u1', {
      name: 'CI',
      scopes: ['usage:write'],
    });

    expect(result.token.startsWith('fp_pat_')).toBe(true);
    expect(result.scopes).toEqual(['usage:write']);
    expect(mockTokensRepository.create).toHaveBeenCalled();
  });

  it('creates a token for keycloak-linked users without passwordHash', async () => {
    mockUsersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'u1',
      passwordHash: null,
      keycloakSub: 'kc-sub-1',
      role: UserRole.ADMIN,
    });
    mockTokensRepository.create.mockImplementation(async (data: Record<string, unknown>) => ({
      ...data,
      id: 't1',
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
      revokedAt: null,
      lastUsedAt: null,
      expiresAt: null,
    }));

    const result = await service.create('u1', {
      name: 'CI',
      scopes: ['usage:write'],
    });

    expect(result.token.startsWith('fp_pat_')).toBe(true);
  });

  it('rejects create when account has neither passwordHash nor keycloakSub', async () => {
    mockUsersRepository.findByIdOrThrow.mockResolvedValue({
      id: 'u1',
      passwordHash: null,
      keycloakSub: null,
      role: UserRole.ADMIN,
    });

    await expect(service.create('u1', { name: 'x', scopes: ['usage:write'] })).rejects.toThrow(BadRequestException);
  });

  it('rejects unknown scopes', async () => {
    mockUsersRepository.findByIdOrThrow.mockResolvedValue({ id: 'u1', passwordHash: 'hash', role: UserRole.ADMIN });

    await expect(service.create('u1', { name: 'x', scopes: ['nope:write'] })).rejects.toThrow(BadRequestException);
  });

  it('rejects admin scopes when DB role is non-admin', async () => {
    mockUsersRepository.findByIdOrThrow.mockResolvedValue({ id: 'u1', passwordHash: 'hash', role: UserRole.USER });

    await expect(service.create('u1', { name: 'x', scopes: ['usage:write'] })).rejects.toThrow(ForbiddenException);
  });

  it('updates name and scopes for an owned active token', async () => {
    mockUsersRepository.findByIdOrThrow.mockResolvedValue({ id: 'u1', role: UserRole.ADMIN });
    mockTokensRepository.findById.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      name: 'Old',
      scopes: ['invoices:read'],
      revokedAt: null,
      tokenPrefix: 'fp_pat_x',
      expiresAt: null,
      lastUsedAt: null,
      createdAt: new Date('2026-01-01T00:00:00.000Z'),
    });
    mockTokensRepository.save.mockImplementation(async (entity) => entity);

    const result = await service.update('u1', 't1', {
      name: '  Renamed  ',
      scopes: ['usage:write', 'invoices:read'],
    });

    expect(result.name).toBe('Renamed');
    expect(result.scopes).toEqual(['usage:write', 'invoices:read']);
    expect(mockTokensRepository.save).toHaveBeenCalled();
  });

  it('rejects update when token belongs to another user', async () => {
    mockUsersRepository.findByIdOrThrow.mockResolvedValue({ id: 'u1', role: UserRole.ADMIN });
    mockTokensRepository.findById.mockResolvedValue({
      id: 't1',
      userId: 'other',
      revokedAt: null,
    });

    await expect(service.update('u1', 't1', { name: 'x', scopes: ['invoices:read'] })).rejects.toThrow(
      'Token not found',
    );
  });

  it('rejects update of revoked tokens', async () => {
    mockUsersRepository.findByIdOrThrow.mockResolvedValue({ id: 'u1', role: UserRole.ADMIN });
    mockTokensRepository.findById.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      revokedAt: new Date(),
    });

    await expect(service.update('u1', 't1', { name: 'x', scopes: ['invoices:read'] })).rejects.toThrow(
      'Token not found',
    );
  });

  it('rejects admin scopes on update when DB role is non-admin', async () => {
    mockUsersRepository.findByIdOrThrow.mockResolvedValue({ id: 'u1', role: UserRole.USER });
    mockTokensRepository.findById.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      name: 'CI',
      scopes: ['invoices:read'],
      revokedAt: null,
    });

    await expect(service.update('u1', 't1', { name: 'CI', scopes: ['usage:write'] })).rejects.toThrow(
      ForbiddenException,
    );
  });

  it('verifies a valid token', async () => {
    const plaintext = 'fp_pat_abcdefghijklmnopqr';
    const tokenHash = await bcrypt.hash(plaintext, 4);

    mockTokensRepository.findByPrefix.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      tokenHash,
      scopes: ['usage:write'],
      revokedAt: null,
      expiresAt: null,
    });
    mockTokensRepository.touchLastUsedAtIfActive.mockResolvedValue(true);
    mockUsersRepository.findById.mockResolvedValue({
      id: 'u1',
      passwordHash: 'hash',
      emailConfirmedAt: new Date(),
      lockedAt: null,
      role: UserRole.ADMIN,
    });

    const verified = await service.verifyToken(plaintext);

    expect(verified.patId).toBe('t1');
    expect(verified.scopes).toEqual(['usage:write']);
    expect(mockTokensRepository.touchLastUsedAtIfActive).toHaveBeenCalled();
  });

  it('strips admin-only scopes at verify when user is demoted', async () => {
    const plaintext = 'fp_pat_abcdefghijklmnopqr';
    const tokenHash = await bcrypt.hash(plaintext, 4);

    mockTokensRepository.findByPrefix.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      tokenHash,
      scopes: ['usage:write', 'invoices:read'],
      revokedAt: null,
      expiresAt: null,
    });
    mockTokensRepository.touchLastUsedAtIfActive.mockResolvedValue(true);
    mockUsersRepository.findById.mockResolvedValue({
      id: 'u1',
      passwordHash: 'hash',
      emailConfirmedAt: new Date(),
      lockedAt: null,
      role: UserRole.USER,
    });

    const verified = await service.verifyToken(plaintext);

    expect(verified.scopes).toEqual(['invoices:read']);
  });

  it('rejects create with blank name after trim', async () => {
    mockUsersRepository.findByIdOrThrow.mockResolvedValue({ id: 'u1', passwordHash: 'hash', role: UserRole.ADMIN });

    await expect(service.create('u1', { name: '   ', scopes: ['usage:write'] })).rejects.toThrow(BadRequestException);
  });

  it('rejects create with past expiresAt', async () => {
    mockUsersRepository.findByIdOrThrow.mockResolvedValue({ id: 'u1', passwordHash: 'hash', role: UserRole.ADMIN });

    await expect(
      service.create('u1', {
        name: 'CI',
        scopes: ['usage:write'],
        expiresAt: new Date('2020-01-01T00:00:00.000Z'),
      }),
    ).rejects.toThrow(BadRequestException);
  });

  it('assertPatJwtActive rejects revoked tokens', async () => {
    mockTokensRepository.findById.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      scopes: ['usage:write'],
      revokedAt: new Date(),
      expiresAt: null,
    });

    await expect(service.assertPatJwtActive('t1', 'u1', ['usage:write'])).rejects.toThrow(UnauthorizedException);
  });

  it('assertPatJwtActive rejects when JWT scopes diverge from DB', async () => {
    mockTokensRepository.findById.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      scopes: ['invoices:read'],
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: null,
    });
    mockUsersRepository.findById.mockResolvedValue({
      id: 'u1',
      passwordHash: 'hash',
      emailConfirmedAt: new Date(),
      lockedAt: null,
      role: UserRole.ADMIN,
    });

    await expect(service.assertPatJwtActive('t1', 'u1', ['usage:write'])).rejects.toThrow(UnauthorizedException);
  });

  it('assertPatJwtActive rejects when email is unconfirmed', async () => {
    mockTokensRepository.findById.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      scopes: ['usage:write'],
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: null,
    });
    mockUsersRepository.findById.mockResolvedValue({
      id: 'u1',
      passwordHash: 'hash',
      emailConfirmedAt: null,
      lockedAt: null,
      role: UserRole.ADMIN,
    });

    await expect(service.assertPatJwtActive('t1', 'u1', ['usage:write'])).rejects.toThrow(UnauthorizedException);
  });

  it('assertPatJwtActive allows keycloak-linked users without passwordHash', async () => {
    mockTokensRepository.findById.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      scopes: ['usage:write'],
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: null,
    });
    mockUsersRepository.findById.mockResolvedValue({
      id: 'u1',
      passwordHash: null,
      keycloakSub: 'kc-sub-1',
      emailConfirmedAt: new Date(),
      lockedAt: null,
      role: UserRole.ADMIN,
    });

    await expect(service.assertPatJwtActive('t1', 'u1', ['usage:write'])).resolves.toEqual({
      scopes: ['usage:write'],
    });
  });

  it('assertPatJwtActive rejects when account has neither passwordHash nor keycloakSub', async () => {
    mockTokensRepository.findById.mockResolvedValue({
      id: 't1',
      userId: 'u1',
      scopes: ['usage:write'],
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: null,
    });
    mockUsersRepository.findById.mockResolvedValue({
      id: 'u1',
      passwordHash: null,
      keycloakSub: null,
      emailConfirmedAt: new Date(),
      lockedAt: null,
      role: UserRole.ADMIN,
    });

    await expect(service.assertPatJwtActive('t1', 'u1', ['usage:write'])).rejects.toThrow(UnauthorizedException);
  });

  it('assertPatJwtActive touches lastUsedAt when stale', async () => {
    const entity = {
      id: 't1',
      userId: 'u1',
      scopes: ['usage:write'],
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: new Date(Date.now() - 10 * 60 * 1000),
    };

    mockTokensRepository.findById.mockResolvedValue(entity);
    mockUsersRepository.findById.mockResolvedValue({
      id: 'u1',
      passwordHash: 'hash',
      emailConfirmedAt: new Date(),
      lockedAt: null,
      role: UserRole.ADMIN,
    });

    await expect(service.assertPatJwtActive('t1', 'u1', ['usage:write'])).resolves.toEqual({
      scopes: ['usage:write'],
    });
    expect(mockTokensRepository.touchLastUsedAtIfActive).toHaveBeenCalledWith('t1', expect.any(Date));
    expect(mockTokensRepository.save).not.toHaveBeenCalled();
  });

  it('assertPatJwtActive skips lastUsedAt touch when recent', async () => {
    const entity = {
      id: 't1',
      userId: 'u1',
      scopes: ['usage:write'],
      revokedAt: null,
      expiresAt: null,
      lastUsedAt: new Date(),
    };

    mockTokensRepository.findById.mockResolvedValue(entity);
    mockUsersRepository.findById.mockResolvedValue({
      id: 'u1',
      passwordHash: 'hash',
      emailConfirmedAt: new Date(),
      lockedAt: null,
      role: UserRole.ADMIN,
    });

    await expect(service.assertPatJwtActive('t1', 'u1', ['usage:write'])).resolves.toEqual({
      scopes: ['usage:write'],
    });
    expect(mockTokensRepository.touchLastUsedAtIfActive).not.toHaveBeenCalled();
  });

  it('rejects invalid token', async () => {
    mockTokensRepository.findByPrefix.mockResolvedValue(null);

    await expect(service.verifyToken('fp_pat_notarealtokenvaluexx')).rejects.toThrow(UnauthorizedException);
  });
});
