import { Injectable, Logger } from '@nestjs/common';

import { OfferFulfillmentStatus } from '../constants/offer-fulfillment-status.constants';
import { OfferLineType } from '../constants/offer-line-type.constants';
import { OfferStatus } from '../constants/offer-status.constants';
import type { OfferLineItemEntity } from '../entities/offer-line-item.entity';
import type { OfferEntity } from '../entities/offer.entity';
import { OfferLineItemsRepository } from '../repositories/offer-line-items.repository';
import { OffersRepository } from '../repositories/offers.repository';
import { OpenPositionsRepository } from '../../repositories/open-positions.repository';
import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import { InvoiceIssuanceService } from '../../services/invoice-issuance.service';
import { InvoiceService } from '../../services/invoice.service';
import { SubscriptionService } from '../../services/subscription.service';
import { BillingNotificationPublisher } from '../../notifications/billing-notification.publisher';
import { ProjectsAdminService } from '../../projects/services/projects-admin.service';
import type { CreateAdminProjectDto } from '../../projects/dto/project.dto';
import { SubscriptionOrderPreparationService } from './subscription-order-preparation.service';

@Injectable()
export class OfferFulfillmentService {
  private readonly logger = new Logger(OfferFulfillmentService.name);

  constructor(
    private readonly offersRepository: OffersRepository,
    private readonly offerLineItemsRepository: OfferLineItemsRepository,
    private readonly subscriptionService: SubscriptionService,
    private readonly subscriptionOrderPreparationService: SubscriptionOrderPreparationService,
    private readonly projectsAdminService: ProjectsAdminService,
    private readonly invoiceService: InvoiceService,
    private readonly invoiceIssuanceService: InvoiceIssuanceService,
    private readonly openPositionsRepository: OpenPositionsRepository,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
    private readonly auditLog: BillingAuditLogService,
  ) {}

  async fulfillAcceptedOffer(offerId: string): Promise<void> {
    const offer = await this.offersRepository.findByIdOrThrow(offerId, true);
    const lines = offer.lineItems ?? (await this.offerLineItemsRepository.findByOfferId(offerId));
    let anchorSubscriptionId: string | undefined;

    for (const line of lines) {
      if (line.fulfillmentStatus === OfferFulfillmentStatus.COMPLETED) {
        if (line.resultSubscriptionId) {
          anchorSubscriptionId = line.resultSubscriptionId;
        }

        continue;
      }

      if (line.scheduledAt && line.scheduledAt.getTime() > Date.now()) {
        await this.markScheduled(offer, line);
        continue;
      }

      if (line.lineType === OfferLineType.PLAN_TEMPLATE) {
        anchorSubscriptionId = await this.fulfillPlanLine(offer, line);
        continue;
      }

      if (line.lineType === OfferLineType.PROJECT_TEMPLATE) {
        await this.fulfillProjectLine(offer, line);
        continue;
      }
    }

    const standardLines = lines.filter(
      (line) =>
        line.lineType === OfferLineType.STANDARD &&
        line.fulfillmentStatus !== OfferFulfillmentStatus.COMPLETED &&
        !(line.scheduledAt && line.scheduledAt.getTime() > Date.now()),
    );

    if (standardLines.length > 0) {
      await this.fulfillStandardLines(offer, standardLines, anchorSubscriptionId);
    }
  }

  async fulfillLine(offerId: string, lineItemId: string): Promise<void> {
    const offer = await this.offersRepository.findByIdOrThrow(offerId, true);
    const line = await this.offerLineItemsRepository.findByIdOrThrow(lineItemId);

    if (line.offerId !== offerId) {
      throw new Error('Offer line does not belong to offer');
    }

    if (line.fulfillmentStatus === OfferFulfillmentStatus.COMPLETED) {
      return;
    }

    if (offer.status !== OfferStatus.ACCEPTED) {
      throw new Error('Offer is not accepted');
    }

    switch (line.lineType) {
      case OfferLineType.PLAN_TEMPLATE:
        await this.fulfillPlanLine(offer, line);
        break;
      case OfferLineType.PROJECT_TEMPLATE:
        await this.fulfillProjectLine(offer, line);
        break;
      case OfferLineType.STANDARD:
        await this.fulfillStandardLines(offer, [line]);
        break;
      default:
        throw new Error(`Unsupported offer line type: ${line.lineType as string}`);
    }
  }

  private async markScheduled(offer: OfferEntity, line: OfferLineItemEntity): Promise<void> {
    await this.offerLineItemsRepository.update(line.id, {
      fulfillmentStatus: OfferFulfillmentStatus.SCHEDULED,
    });

    await this.auditLog.log({
      process: 'offer.line.scheduled',
      level: 'info',
      message: 'Offer line scheduled for deferred fulfillment',
      offerId: offer.id,
      userId: offer.userId,
      correlationId: `offer-fulfillment:${offer.id}:${line.id}`,
      context: { lineId: line.id, scheduledAt: line.scheduledAt?.toISOString() },
    });
  }

  private async fulfillPlanLine(offer: OfferEntity, line: OfferLineItemEntity): Promise<string | undefined> {
    try {
      if (!line.planId) {
        throw new Error('Plan template line is missing planId');
      }

      const prepared = await this.subscriptionOrderPreparationService.prepareForUser(
        offer.userId,
        {
          planId: line.planId,
          requestedConfig: line.effectiveConfigSnapshot ?? undefined,
          addonIds: line.addonIds ?? undefined,
          addonConfigs: line.addonConfigsSnapshot ?? undefined,
          preferredAlternatives: (line.preferredAlternatives as Record<string, unknown> | undefined) ?? undefined,
          autoBackorder: line.autoBackorder,
          promotionCode: line.promotionCode ?? undefined,
        },
        { throwOnUnavailable: !line.autoBackorder, lineDescription: line.description },
      );
      const subscription = await this.subscriptionService.createSubscriptionFromPrepared(offer.userId, prepared, {
        promotionCode: line.promotionCode ?? undefined,
        autoBackorder: line.autoBackorder,
      });

      await this.completeLine(offer, line, { resultSubscriptionId: subscription.id });
      this.billingNotificationPublisher.publishOfferLineFulfilled(offer, line, {
        resultSubscriptionId: subscription.id,
      });

      return subscription.id;
    } catch (error) {
      await this.failLine(offer, line, error as Error);
      throw error;
    }
  }

  private async fulfillProjectLine(offer: OfferEntity, line: OfferLineItemEntity): Promise<void> {
    try {
      const payload = (line.projectTemplatePayload ?? {}) as Record<string, unknown>;
      const dto: CreateAdminProjectDto = {
        userId: offer.userId,
        name: String(payload.name ?? line.description),
        description: payload.description != null ? String(payload.description) : undefined,
        hourlyRateNet: Number(payload.hourlyRateNet ?? line.unitPriceNet),
        targetHours: payload.targetHours != null ? Number(payload.targetHours) : undefined,
        currency: payload.currency != null ? String(payload.currency) : offer.currency,
      };
      const project = await this.projectsAdminService.create(dto);

      await this.completeLine(offer, line, { resultProjectId: project.id });
      this.billingNotificationPublisher.publishOfferLineFulfilled(offer, line, {
        resultProjectId: project.id,
      });
    } catch (error) {
      await this.failLine(offer, line, error as Error);
      throw error;
    }
  }

  private async fulfillStandardLines(
    offer: OfferEntity,
    lines: OfferLineItemEntity[],
    anchorSubscriptionId?: string,
  ): Promise<void> {
    try {
      if (offer.billToOpenPositions && anchorSubscriptionId) {
        for (const line of lines) {
          await this.openPositionsRepository.createUniqueBySourceRef({
            subscriptionId: anchorSubscriptionId,
            userId: offer.userId,
            description: line.description,
            billUntil: new Date(),
            skipIfNoBillableAmount: false,
            adjustmentNet: Number(line.lineNet).toFixed(4),
            adjustmentKind: 'offer_standard_line',
            sourceRef: `offer:${offer.id}:line:${line.id}`,
          });

          await this.completeLine(offer, line, {});
          await this.auditLog.log({
            process: 'offer.open_position.created',
            level: 'info',
            message: 'Created open position from accepted offer line',
            offerId: offer.id,
            userId: offer.userId,
            correlationId: `offer-fulfillment:${offer.id}:${line.id}`,
            context: { lineId: line.id, subscriptionId: anchorSubscriptionId },
          });
          this.billingNotificationPublisher.publishOfferLineFulfilled(offer, line, {});
        }

        return;
      }

      const draft = await this.invoiceService.createDraft({
        userId: offer.userId,
        currency: offer.currency,
        offerId: offer.id,
        lineInputs: lines.map((line) => ({
          description: line.description,
          quantity: Number(line.quantity),
          unitPriceNet: Number(line.unitPriceNet),
          taxCategory: line.taxCategory,
        })),
      });

      await this.offersRepository.update(offer.id, {});
      const issued = await this.invoiceIssuanceService.issueDraft(draft.id);

      for (const line of lines) {
        await this.completeLine(offer, line, { resultInvoiceId: issued.id });
        await this.auditLog.log({
          process: 'offer.invoice.created',
          level: 'info',
          message: 'Created invoice from accepted offer',
          offerId: offer.id,
          invoiceId: issued.id,
          userId: offer.userId,
          correlationId: `offer-fulfillment:${offer.id}:${line.id}`,
          context: { lineId: line.id, invoiceNumber: issued.invoiceNumber },
        });
        this.billingNotificationPublisher.publishOfferLineFulfilled(offer, line, {
          resultInvoiceId: issued.id,
        });
      }
    } catch (error) {
      for (const line of lines) {
        await this.failLine(offer, line, error as Error);
      }

      throw error;
    }
  }

  private async completeLine(
    offer: OfferEntity,
    line: OfferLineItemEntity,
    result: Partial<Pick<OfferLineItemEntity, 'resultSubscriptionId' | 'resultProjectId' | 'resultInvoiceId'>>,
  ): Promise<void> {
    await this.offerLineItemsRepository.update(line.id, {
      fulfillmentStatus: OfferFulfillmentStatus.COMPLETED,
      fulfilledAt: new Date(),
      fulfillmentError: null,
      ...result,
    });

    await this.auditLog.log({
      process: 'offer.line.fulfilled',
      level: 'info',
      message: 'Offer line fulfilled',
      offerId: offer.id,
      userId: offer.userId,
      correlationId: `offer-fulfillment:${offer.id}:${line.id}`,
      context: { lineId: line.id, lineType: line.lineType, ...result },
    });
  }

  private async failLine(offer: OfferEntity, line: OfferLineItemEntity, error: Error): Promise<void> {
    this.logger.error(`Offer line ${line.id} fulfillment failed: ${error.message}`);

    await this.offerLineItemsRepository.update(line.id, {
      fulfillmentStatus: OfferFulfillmentStatus.FAILED,
      fulfillmentError: error.message,
    });

    await this.auditLog.log({
      process: 'offer.line.fulfillment_failed',
      level: 'error',
      message: 'Offer line fulfillment failed',
      offerId: offer.id,
      userId: offer.userId,
      correlationId: `offer-fulfillment:${offer.id}:${line.id}`,
      context: { lineId: line.id, error: error.message },
    });

    this.billingNotificationPublisher.publishOfferLineFulfillmentFailed(offer, line, error.message);
  }
}
