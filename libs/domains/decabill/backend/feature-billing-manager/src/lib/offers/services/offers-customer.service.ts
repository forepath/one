import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';

import { OfferStatus } from '../constants/offer-status.constants';
import type {
  CustomerOfferDetailResponseDto,
  CustomerOfferListItemDto,
  OffersSummaryResponseDto,
} from '../dto/offer.dto';
import { OffersRepository } from '../repositories/offers.repository';
import { OfferLineItemsRepository } from '../repositories/offer-line-items.repository';
import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { BillingEmailPublisher } from '../../email/billing-email.publisher';
import { CustomerProfilesService } from '../../services/customer-profiles.service';
import { BillingNotificationPublisher } from '../../notifications/billing-notification.publisher';
import { mapOfferToSearchDocument } from '../../search/billing-search-document.mapper';
import { BillingSearchIndexService } from '../../search/billing-search-index.service';
import { getRequiredTenantId } from '../../utils/tenant-query.utils';
import { mapOfferLineItemToResponse } from '../utils/map-offer-line-items.util';

import { OfferFulfillmentService } from './offer-fulfillment.service';
import { OfferPdfService } from './offer-pdf.service';

@Injectable()
export class OffersCustomerService {
  constructor(
    private readonly offersRepository: OffersRepository,
    private readonly offerLineItemsRepository: OfferLineItemsRepository,
    private readonly customerProfilesService: CustomerProfilesService,
    private readonly offerPdfService: OfferPdfService,
    private readonly offerFulfillmentService: OfferFulfillmentService,
    private readonly billingEmailPublisher: BillingEmailPublisher,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly billingSearchIndexService: BillingSearchIndexService,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  async getSummary(userId: string): Promise<OffersSummaryResponseDto> {
    const [pendingCount, acceptedCount, historyCount] = await Promise.all([
      this.offersRepository.countPendingForUser(userId),
      this.offersRepository.countByUserAndStatus(userId, [OfferStatus.ACCEPTED]),
      this.offersRepository.countByUserAndStatus(userId, [
        OfferStatus.ACCEPTED,
        OfferStatus.DECLINED,
        OfferStatus.EXPIRED,
      ]),
    ]);

    return {
      pendingCount,
      actionRequiredCount: pendingCount,
      acceptedCount,
      historyCount,
    };
  }

  async listPending(userId: string, search?: string): Promise<CustomerOfferListItemDto[]> {
    const items = await this.offersRepository.findPendingByUserId(userId, search);

    return items.map((item) => this.mapListItem(item));
  }

  async listHistory(userId: string, search?: string): Promise<CustomerOfferListItemDto[]> {
    const items = await this.offersRepository.findHistoryByUserId(userId, search);

    return items.map((item) => this.mapListItem(item));
  }

  async getDetail(userId: string, offerId: string): Promise<CustomerOfferDetailResponseDto> {
    const offer = await this.assertCustomerOffer(userId, offerId);
    const lines = await this.offerLineItemsRepository.findByOfferId(offerId);

    return {
      ...this.mapListItem(offer),
      subtotalNet: Number(offer.subtotalNet),
      taxTotal: Number(offer.taxTotal),
      billToOpenPositions: offer.billToOpenPositions,
      lineItems: lines.map((line) => mapOfferLineItemToResponse(line)),
    };
  }

  async readPdf(userId: string, offerId: string): Promise<{ buffer: Buffer; filename: string }> {
    const offer = await this.assertCustomerOffer(userId, offerId);

    if (!offer.pdfStorageKey) {
      throw new NotFoundException('Offer PDF is not available');
    }

    const buffer = await this.offerPdfService.readPdf(offer.pdfStorageKey);

    return {
      buffer,
      filename: `${offer.offerNumber ?? offer.id}.pdf`,
    };
  }

  async accept(userId: string, offerId: string): Promise<CustomerOfferDetailResponseDto> {
    const offer = await this.assertCustomerOffer(userId, offerId, [OfferStatus.ARCHIVED]);

    if (offer.expiresAt && offer.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException('Offer has expired');
    }

    const profile = await this.customerProfilesService.getByUserId(userId);

    if (!this.customerProfilesService.isProfileComplete(profile)) {
      throw new BadRequestException('Customer profile must be complete before accepting offer');
    }

    const acceptedAt = new Date();
    const accepted = await this.offersRepository.update(offerId, {
      status: OfferStatus.ACCEPTED,
      acceptedAt,
    });

    await this.auditLog.log({
      process: 'offer.accept',
      level: 'info',
      message: 'Customer accepted offer',
      offerId,
      userId,
      context: { offerNumber: accepted.offerNumber },
    });

    await this.offerFulfillmentService.fulfillAcceptedOffer(accepted.id);
    await this.billingEmailPublisher.publishOfferAcceptedConfirmation(accepted);
    this.billingNotificationPublisher.publishOffer('offer.accepted', accepted);
    this.billingSearchIndexService.scheduleUpsert('offers', mapOfferToSearchDocument(accepted, getRequiredTenantId()));

    return await this.getDetail(userId, offerId);
  }

  async decline(userId: string, offerId: string): Promise<CustomerOfferDetailResponseDto> {
    const offer = await this.assertCustomerOffer(userId, offerId, [OfferStatus.ARCHIVED]);
    const declined = await this.offersRepository.update(offerId, {
      status: OfferStatus.DECLINED,
      declinedAt: new Date(),
    });

    await this.auditLog.log({
      process: 'offer.decline',
      level: 'info',
      message: 'Customer declined offer',
      offerId,
      userId,
      context: { offerNumber: declined.offerNumber },
    });

    this.billingNotificationPublisher.publishOffer('offer.declined', declined);
    this.billingSearchIndexService.scheduleUpsert('offers', mapOfferToSearchDocument(declined, getRequiredTenantId()));

    return await this.getDetail(userId, offerId);
  }

  private async assertCustomerOffer(userId: string, offerId: string, allowedStatuses?: OfferStatus[]) {
    const offer = await this.offersRepository.findByIdOrThrow(offerId);

    if (offer.userId !== userId) {
      throw new ForbiddenException('Offer not found');
    }

    if (!this.isCustomerVisibleStatus(offer.status)) {
      throw new NotFoundException('Offer not found');
    }

    if (allowedStatuses && !allowedStatuses.includes(offer.status)) {
      throw new BadRequestException('Offer cannot be modified in its current status');
    }

    return offer;
  }

  private isCustomerVisibleStatus(status: OfferStatus): boolean {
    return [OfferStatus.ARCHIVED, OfferStatus.ACCEPTED, OfferStatus.DECLINED, OfferStatus.EXPIRED].includes(status);
  }

  private mapListItem(offer: Awaited<ReturnType<OffersRepository['findByIdOrThrow']>>): CustomerOfferListItemDto {
    return {
      id: offer.id,
      offerNumber: offer.offerNumber ?? null,
      status: offer.status,
      currency: offer.currency,
      totalGross: Number(offer.totalGross),
      expiresAt: offer.expiresAt?.toISOString() ?? null,
      archivedAt: offer.archivedAt?.toISOString() ?? null,
      acceptedAt: offer.acceptedAt?.toISOString() ?? null,
      declinedAt: offer.declinedAt?.toISOString() ?? null,
    };
  }
}
