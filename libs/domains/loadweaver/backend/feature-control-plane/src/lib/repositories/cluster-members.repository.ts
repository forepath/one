import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ClusterMemberEntity } from '../entities/cluster-member.entity';

/**
 * Repository for cluster role memberships.
 */
@Injectable()
export class ClusterMembersRepository {
  constructor(
    @InjectRepository(ClusterMemberEntity)
    private readonly repository: Repository<ClusterMemberEntity>,
  ) {}

  async findByUserId(userId: string): Promise<ClusterMemberEntity | null> {
    return await this.repository.findOne({ where: { userId } });
  }

  async findAll(): Promise<ClusterMemberEntity[]> {
    return await this.repository.find({ order: { createdAt: 'ASC' } });
  }
}
