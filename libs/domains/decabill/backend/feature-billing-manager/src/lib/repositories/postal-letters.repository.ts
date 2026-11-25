import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';

import type { DeliverableDocumentType } from '../constants/document-delivery.constants';
import type { PostalLetterStatus } from '../constants/postal-letter.constants';
import { PostalLetterEntity } from '../entities/postal-letter.entity';
import { getRequiredTenantId } from '../utils/tenant-query.utils';

@Injectable()
export class PostalLettersRepository {
  constructor(
    @InjectRepository(PostalLetterEntity)
    private readonly repository: Repository<PostalLetterEntity>,
  ) {}

  async create(dto: Partial<PostalLetterEntity>): Promise<PostalLetterEntity> {
    return await this.repository.save(this.repository.create(dto));
  }

  /**
   * Webhook lookup: provider events carry no tenant, so the letter is resolved by its provider id across tenants. The
   * caller verifies the event signature with the resolved tenant's signing key before trusting anything else in it.
   */
  async findByProviderExternalId(provider: string, externalId: string): Promise<PostalLetterEntity | null> {
    return await this.repository.findOne({ where: { provider, externalId } });
  }

  /** Letters of one document in the current tenant, newest first. */
  async findByDocument(documentType: DeliverableDocumentType, documentId: string): Promise<PostalLetterEntity[]> {
    return await this.repository.find({
      where: { tenantId: getRequiredTenantId(), documentType, documentId },
      order: { createdAt: 'DESC' },
    });
  }

  /** Letter already submitted for this delivery claim (spool retries must not post it twice). */
  async findByDocumentClaim(
    documentType: DeliverableDocumentType,
    documentId: string,
    claimedAt: Date,
  ): Promise<PostalLetterEntity | null> {
    return await this.repository.findOne({
      where: { tenantId: getRequiredTenantId(), documentType, documentId, claimedAt },
    });
  }

  /** Letters needing attention in the current tenant (action center), newest first. */
  async findByStatuses(statuses: readonly PostalLetterStatus[], limit: number): Promise<PostalLetterEntity[]> {
    return await this.repository.find({
      where: { tenantId: getRequiredTenantId(), status: In([...statuses]) },
      order: { updatedAt: 'DESC' },
      take: limit,
    });
  }

  /** Moves a letter from `from` to `to` only while it is still in `from` (concurrent webhook deliveries apply once). */
  async transitionStatus(
    id: string,
    from: PostalLetterStatus,
    to: PostalLetterStatus,
    reason: string | null,
  ): Promise<boolean> {
    const result = await this.repository.update({ id, status: from }, { status: to, statusReason: reason });

    return (result.affected ?? 0) === 1;
  }
}
