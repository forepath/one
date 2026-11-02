import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { JoinTokenEntity } from '../entities/join-token.entity';

/**
 * Repository for node join tokens.
 */
@Injectable()
export class JoinTokensRepository {
  constructor(
    @InjectRepository(JoinTokenEntity)
    private readonly repository: Repository<JoinTokenEntity>,
  ) {}

  async findActive(): Promise<JoinTokenEntity[]> {
    return await this.repository
      .createQueryBuilder('t')
      .where('t.used_at IS NULL AND t.revoked_at IS NULL AND t.expires_at > now()')
      .orderBy('t.created_at', 'DESC')
      .getMany();
  }

  async findById(id: string): Promise<JoinTokenEntity | null> {
    return await this.repository.findOne({ where: { id } });
  }

  async save(token: JoinTokenEntity): Promise<JoinTokenEntity> {
    return await this.repository.save(token);
  }

  create(values: Partial<JoinTokenEntity>): JoinTokenEntity {
    return this.repository.create(values);
  }
}
