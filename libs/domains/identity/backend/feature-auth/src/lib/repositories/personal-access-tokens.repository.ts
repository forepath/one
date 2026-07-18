import { UserPersonalAccessTokenEntity } from '@forepath/identity/backend';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';

export class PersonalAccessTokensRepository {
  constructor(
    @InjectRepository(UserPersonalAccessTokenEntity)
    private readonly repository: Repository<UserPersonalAccessTokenEntity>,
  ) {}

  async create(data: Partial<UserPersonalAccessTokenEntity>): Promise<UserPersonalAccessTokenEntity> {
    const entity = this.repository.create(data);

    return this.repository.save(entity);
  }

  async findByPrefix(tokenPrefix: string): Promise<UserPersonalAccessTokenEntity | null> {
    return this.repository.findOne({ where: { tokenPrefix } });
  }

  async findById(id: string): Promise<UserPersonalAccessTokenEntity | null> {
    return this.repository.findOne({ where: { id } });
  }

  async findActiveByUserId(userId: string): Promise<UserPersonalAccessTokenEntity[]> {
    return this.repository.find({
      where: { userId, revokedAt: IsNull() },
      order: { createdAt: 'DESC' },
    });
  }

  async findAllByUserId(userId: string): Promise<UserPersonalAccessTokenEntity[]> {
    return this.repository.find({
      where: { userId },
      order: { createdAt: 'DESC' },
    });
  }

  async save(entity: UserPersonalAccessTokenEntity): Promise<UserPersonalAccessTokenEntity> {
    return this.repository.save(entity);
  }

  /**
   * Touch lastUsedAt only if the token is still active (avoids resurrecting revoked rows).
   * Returns true when a row was updated.
   */
  async touchLastUsedAtIfActive(id: string, lastUsedAt: Date): Promise<boolean> {
    const result = await this.repository.update({ id, revokedAt: IsNull() }, { lastUsedAt });

    return (result.affected ?? 0) > 0;
  }
}
