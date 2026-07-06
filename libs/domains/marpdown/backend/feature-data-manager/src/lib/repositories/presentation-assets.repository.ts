import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { PresentationAssetEntity } from '../entities/presentation-asset.entity';

@Injectable()
export class PresentationAssetsRepository {
  constructor(
    @InjectRepository(PresentationAssetEntity)
    private readonly repository: Repository<PresentationAssetEntity>,
  ) {}

  async findAllByPresentation(presentationId: string): Promise<PresentationAssetEntity[]> {
    return await this.repository.find({ where: { presentationId }, order: { path: 'ASC' } });
  }

  async findByPath(presentationId: string, path: string): Promise<PresentationAssetEntity | null> {
    return await this.repository.findOne({ where: { presentationId, path } });
  }

  async save(entity: PresentationAssetEntity): Promise<PresentationAssetEntity> {
    return await this.repository.save(entity);
  }

  async delete(entity: PresentationAssetEntity): Promise<void> {
    await this.repository.remove(entity);
  }

  async deleteByPresentation(presentationId: string): Promise<void> {
    await this.repository.delete({ presentationId });
  }

  async deleteByPathPrefix(presentationId: string, pathPrefix: string): Promise<void> {
    await this.repository
      .createQueryBuilder()
      .delete()
      .where('presentation_id = :presentationId', { presentationId })
      .andWhere('path = :pathPrefix OR path LIKE :pathLike', {
        pathPrefix,
        pathLike: `${pathPrefix}/%`,
      })
      .execute();
  }
}
