import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ProviderPriceSnapshotEntity } from '../entities/provider-price-snapshot.entity';

@Injectable()
export class ProviderPriceSnapshotsRepository {
  constructor(
    @InjectRepository(ProviderPriceSnapshotEntity)
    private readonly repository: Repository<ProviderPriceSnapshotEntity>,
  ) {}

  async create(dto: Partial<ProviderPriceSnapshotEntity>): Promise<ProviderPriceSnapshotEntity> {
    const entity = this.repository.create(dto);

    return await this.repository.save(entity);
  }
}
