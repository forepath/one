import { UserEntity, UserRole } from '@forepath/identity/backend';
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

  async findByKeycloakSub(keycloakSub: string, tenantId: string = getTenantIdOrDefault()): Promise<UserEntity | null> {
    return this.repository.findOne({ where: { keycloakSub, tenantId } });
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
