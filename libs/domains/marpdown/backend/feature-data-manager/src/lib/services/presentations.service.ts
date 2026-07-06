import { Injectable } from '@nestjs/common';

import { DEFAULT_STARTER_MARKDOWN } from '@forepath/marpdown/marpdown/shared';

import type {
  PaginatedPresentationsResponseDto,
  PresentationResponseDto,
  PresentationSummaryDto,
} from '../dto/presentation.dto';
import type { PresentationEntity } from '../entities/presentation.entity';
import { PresentationsRepository } from '../repositories/presentations.repository';
import type { UserInfoFromRequest } from '../utils/marpdown-access.utils';
import { ensurePresentationOwner } from '../utils/presentation-access.utils';

@Injectable()
export class PresentationsService {
  constructor(private readonly presentationsRepository: PresentationsRepository) {}

  async listForUser(userId: string, limit: number, offset: number): Promise<PaginatedPresentationsResponseDto> {
    const { items, total } = await this.presentationsRepository.findAllByUser(userId, limit, offset);

    return {
      items: items.map((item) => this.mapSummary(item)),
      total,
      limit,
      offset,
    };
  }

  async getByIdForUser(userInfo: UserInfoFromRequest, id: string): Promise<PresentationResponseDto> {
    const presentation = await this.presentationsRepository.findByIdOrThrow(userInfo.userId!, id);

    ensurePresentationOwner(userInfo, presentation);

    return this.mapResponse(presentation);
  }

  async create(userId: string, title: string, markdown?: string): Promise<PresentationResponseDto> {
    const created = await this.presentationsRepository.create({
      userId,
      title,
      markdown: markdown ?? DEFAULT_STARTER_MARKDOWN,
    });

    return this.mapResponse(created);
  }

  async update(
    userInfo: UserInfoFromRequest,
    id: string,
    updates: { title?: string; markdown?: string },
  ): Promise<PresentationResponseDto> {
    const presentation = await this.presentationsRepository.findByIdOrThrow(userInfo.userId!, id);

    ensurePresentationOwner(userInfo, presentation);

    if (updates.title !== undefined) {
      presentation.title = updates.title;
    }

    if (updates.markdown !== undefined) {
      presentation.markdown = updates.markdown;
    }

    const saved = await this.presentationsRepository.save(presentation);

    return this.mapResponse(saved);
  }

  async importMarkdown(userInfo: UserInfoFromRequest, id: string, markdown: string): Promise<PresentationResponseDto> {
    return await this.update(userInfo, id, { markdown });
  }

  async delete(userInfo: UserInfoFromRequest, id: string): Promise<void> {
    const presentation = await this.presentationsRepository.findByIdOrThrow(userInfo.userId!, id);

    ensurePresentationOwner(userInfo, presentation);
    await this.presentationsRepository.delete(presentation);
  }

  private mapSummary(entity: PresentationEntity): PresentationSummaryDto {
    return {
      id: entity.id,
      title: entity.title,
      createdAt: entity.createdAt.toISOString(),
      updatedAt: entity.updatedAt.toISOString(),
    };
  }

  private mapResponse(entity: PresentationEntity): PresentationResponseDto {
    return {
      ...this.mapSummary(entity),
      markdown: entity.markdown,
    };
  }
}
