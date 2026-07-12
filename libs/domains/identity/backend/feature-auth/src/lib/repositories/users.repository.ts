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

  async findAll(limit = 10, offset = 0, tenantId: string = getTenantIdOrDefault()): Promise<UserEntity[]> {
    return this.repository.find({
      where: { tenantId },
      order: { createdAt: 'DESC' },
      take: limit,
      skip: offset,
    });
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
}

export { DEFAULT_TENANT };
