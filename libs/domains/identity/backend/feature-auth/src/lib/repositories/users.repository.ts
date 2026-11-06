import { type ExternalIdentityProvider, UserEntity, UserRole } from '@forepath/identity/backend';
import { DEFAULT_TENANT, getTenantIdOrDefault } from '@forepath/shared/backend';
import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

@Injectable()
export class UsersRepository {
  constructor(
    @InjectRepository(UserEntity)
    private readonly repository: Repository<UserEntity>,
  ) {}

  async findByIdOrThrow(id: string): Promise<UserEntity> {
    const user = await this.repository.findOne({ where: { id } });

    if (!user) {
      throw new Error(`User not found: ${id}`);
    }

    return user;
  }

  async findById(id: string): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findByIdForTenant(id: string, tenantId: string = getTenantIdOrDefault()): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { id, tenantId } });
  }

  async findByEmail(email: string, tenantId: string = getTenantIdOrDefault()): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { email: email.toLowerCase(), tenantId } });
  }

  async findByExternalIdentity(
    externalProvider: ExternalIdentityProvider,
    externalSubject: string,
    tenantId: string = getTenantIdOrDefault(),
  ): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { externalProvider, externalSubject, tenantId } });
  }

  async count(): Promise<number> {
    return this.repository.count();
  }

  async countByTenant(tenantId: string = getTenantIdOrDefault()): Promise<number> {
    return this.repository.count({ where: { tenantId } });
  }

  async findAll(
    limit = 10,
    offset = 0,
    search?: string,
    tenantId: string = getTenantIdOrDefault(),
  ): Promise<UserEntity[]> {
    const qb = this.repository
      .createQueryBuilder('user')
      .where('user.tenantId = :tenantId', { tenantId })
      .orderBy('user.createdAt', 'DESC')
      .take(limit)
      .skip(offset);
    const trimmedSearch = search?.trim();

    if (trimmedSearch) {
      const term = `%${trimmedSearch}%`;

      qb.andWhere('(user.email ILIKE :term OR CAST(user.id AS text) ILIKE :term)', { term });
    }

    return qb.getMany();
  }

  /**
   * Get all user ids and roles for statistics mirror sync.
   * Returns minimal data for efficient batch processing.
   */
  async findAllIdsAndRoles(): Promise<{ id: string; role: string }[]> {
    return this.repository.find({
      select: ['id', 'role'],
    });
  }

  async create(data: Partial<UserEntity>): Promise<UserEntity> {
    const entity = this.repository.create({
      ...data,
      email: data.email?.toLowerCase(),
      tenantId: data.tenantId ?? getTenantIdOrDefault(),
    });

    return this.repository.save(entity);
  }

  /**
   * Links an external identity to a local account only if the account is not linked yet (atomic compare-and-set).
   * Only called for trusted (IdP-verified) emails, so the account's email becomes confirmed.
   *
   * A never-confirmed account may have been pre-registered by someone else with the victim's address: its local
   * credentials (password, pending confirmation / reset tokens, 2FA material) are discarded and its token version is
   * bumped, so the identity provider becomes the only way into it. Confirmed accounts keep their credentials.
   * Returns false when another identity won a concurrent link (or the confirmation state changed meanwhile).
   */
  async linkExternalIdentityIfUnlinked(
    user: Pick<UserEntity, 'id' | 'emailConfirmedAt'>,
    externalProvider: ExternalIdentityProvider,
    externalSubject: string,
  ): Promise<boolean> {
    const query = this.repository.createQueryBuilder().update(UserEntity);

    if (user.emailConfirmedAt) {
      query
        .set({ externalProvider, externalSubject })
        .where('id = :id AND external_subject IS NULL AND email_confirmed_at IS NOT NULL', { id: user.id });
    } else {
      query
        .set({
          externalProvider,
          externalSubject,
          emailConfirmedAt: new Date(),
          passwordHash: () => 'NULL',
          emailConfirmationToken: () => 'NULL',
          passwordResetToken: () => 'NULL',
          passwordResetTokenExpiresAt: () => 'NULL',
          totpSecret: () => 'NULL',
          totpEnabledAt: () => 'NULL',
          email2faEnabledAt: () => 'NULL',
          login2faEmailToken: () => 'NULL',
          login2faEmailTokenExpiresAt: () => 'NULL',
          tokenVersion: () => '"token_version" + 1',
        })
        .where('id = :id AND external_subject IS NULL AND email_confirmed_at IS NULL', { id: user.id });
    }

    const result = await query.execute();

    return (result.affected ?? 0) === 1;
  }

  /**
   * Creates a user while deciding atomically whether it is the first user of its tenant (who becomes admin).
   * The tenant's user count and the insert run in one transaction under a per-tenant advisory lock, so concurrent
   * first sign-ups / sign-ins can never both become admin.
   */
  async createWithTenantBootstrap(
    build: (isFirstUser: boolean) => Partial<UserEntity>,
    tenantId: string = getTenantIdOrDefault(),
  ): Promise<{ user: UserEntity; isFirstUser: boolean }> {
    return this.repository.manager.transaction(async (manager) => {
      await manager.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`users:tenant-bootstrap:${tenantId}`]);

      const isFirstUser = (await manager.count(UserEntity, { where: { tenantId } })) === 0;
      const data = build(isFirstUser);
      const entity = manager.create(UserEntity, {
        ...data,
        email: data.email?.toLowerCase(),
        tenantId,
      });

      return { user: await manager.save(entity), isFirstUser };
    });
  }

  async update(id: string, data: Partial<UserEntity>): Promise<UserEntity> {
    await this.repository.update(id, {
      ...data,
      ...(data.email && { email: data.email.toLowerCase() }),
    });

    return this.findByIdOrThrow(id);
  }

  async updateRole(id: string, role: UserRole): Promise<UserEntity> {
    await this.repository.update(id, { role });

    return this.findByIdOrThrow(id);
  }

  async remove(id: string): Promise<void> {
    await this.repository.delete(id);
  }

  async incrementTokenVersion(id: string): Promise<number> {
    const result = await this.repository
      .createQueryBuilder()
      .update(UserEntity)
      .set({ tokenVersion: () => 'token_version + 1' })
      .where('id = :id', { id })
      .returning(['tokenVersion'])
      .execute();
    const tokenVersion = result.raw?.[0]?.token_version;

    if (tokenVersion === undefined || tokenVersion === null) {
      throw new Error(`User not found: ${id}`);
    }

    return Number(tokenVersion);
  }

  /**
   * Atomically set a new password and clear the reset token when the stored hash still matches.
   * Returns false when another request already consumed the token (or it expired).
   */
  async consumePasswordResetToken(id: string, expectedTokenHash: string, passwordHash: string): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(UserEntity)
      .set({
        passwordHash,
        passwordResetToken: () => 'NULL',
        passwordResetTokenExpiresAt: () => 'NULL',
      })
      .where('id = :id', { id })
      .andWhere('password_reset_token = :expectedTokenHash', { expectedTokenHash })
      .andWhere('password_reset_token_expires_at >= :now', { now: new Date() })
      .execute();

    return (result.affected ?? 0) === 1;
  }

  /**
   * Atomically confirm email and clear the confirmation token when the stored hash still matches.
   * Returns false when another request already consumed the token.
   */
  async consumeEmailConfirmationToken(id: string, expectedTokenHash: string): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(UserEntity)
      .set({
        emailConfirmedAt: new Date(),
        emailConfirmationToken: () => 'NULL',
      })
      .where('id = :id', { id })
      .andWhere('email_confirmation_token = :expectedTokenHash', { expectedTokenHash })
      .execute();

    return (result.affected ?? 0) === 1;
  }

  /**
   * Atomically clear the login email 2FA token when the stored hash still matches.
   * Optionally applies extra SET fields (e.g. email2faEnabledAt when enabling).
   * Returns false when another request already consumed the token (or it expired).
   */
  async consumeLogin2faEmailToken(
    id: string,
    expectedTokenHash: string,
    extraSet: Partial<Pick<UserEntity, 'email2faEnabledAt'>> = {},
  ): Promise<boolean> {
    const result = await this.repository
      .createQueryBuilder()
      .update(UserEntity)
      .set({
        ...extraSet,
        login2faEmailToken: () => 'NULL',
        login2faEmailTokenExpiresAt: () => 'NULL',
      })
      .where('id = :id', { id })
      .andWhere('login_2fa_email_token = :expectedTokenHash', { expectedTokenHash })
      .andWhere('login_2fa_email_token_expires_at >= :now', { now: new Date() })
      .execute();

    return (result.affected ?? 0) === 1;
  }
}

export { DEFAULT_TENANT };
