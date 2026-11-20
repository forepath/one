import { UsersRepository } from '@forepath/identity/backend';
import { BadRequestException, ConflictException, Injectable, Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';

import type { InvoiceLineItemEntity } from '../../entities/invoice-line-item.entity';
import type { InvoiceEntity } from '../../entities/invoice.entity';
import type { ServicePlanEntity } from '../../entities/service-plan.entity';
import { BillingNotificationPublisher } from '../../notifications/billing-notification.publisher';
import type { OfferLineItemEntity } from '../../offers/entities/offer-line-item.entity';
import type { OfferEntity } from '../../offers/entities/offer.entity';
import { CustomerProfilesRepository } from '../../repositories/customer-profiles.repository';
import { BillingAuditLogService } from '../../services/billing-audit-log.service';
import {
  InventoryMovementReason,
  InventoryMovementType,
  InventoryWithdrawalRequestSource,
  InventoryWithdrawalRequestStatus,
} from '../constants/inventory.constants';
import type {
  AcceptInventoryWithdrawalRequestDto,
  InventoryWithdrawalRequestResponseDto,
  PaginatedInventoryResponseDto,
  RejectInventoryWithdrawalRequestDto,
} from '../dto/inventory.dto';
import type { InventoryMovementEntity } from '../entities/inventory-movement.entity';
import type { InventoryWithdrawalRequestEntity } from '../entities/inventory-withdrawal-request.entity';
import { InventoryArticlesRepository } from '../repositories/inventory-articles.repository';
import { InventoryMovementsRepository } from '../repositories/inventory-movements.repository';
import { InventoryWithdrawalRequestsRepository } from '../repositories/inventory-withdrawal-requests.repository';
import { mapWithdrawalRequest } from '../utils/inventory-mappers';
import { inventoryPage } from '../utils/inventory-query.utils';

import { InventoryMovementsService } from './inventory-movements.service';
import { InventoryRealtimeNotifier } from './inventory-realtime-notifier.service';

interface NewRequest {
  articleId: string;
  quantity: number;
  sourceType: InventoryWithdrawalRequestSource;
  sourceRef: string;
  sourceLabel: string;
  userId?: string | null;
  offerId?: string | null;
  invoiceId?: string | null;
  subscriptionId?: string | null;
}

/**
 * Withdrawal requests raised outside the inventory (accepted offer lines, issued invoice lines, subscription period
 * invoices). Raising never moves stock; an administrator accepts a request by choosing the source compartments,
 * which books one withdrawal document per compartment, or rejects it.
 */
@Injectable()
export class InventoryWithdrawalRequestsService {
  private readonly logger = new Logger(InventoryWithdrawalRequestsService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly requestsRepository: InventoryWithdrawalRequestsRepository,
    private readonly articlesRepository: InventoryArticlesRepository,
    private readonly movementsRepository: InventoryMovementsRepository,
    private readonly movementsService: InventoryMovementsService,
    private readonly usersRepository: UsersRepository,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
    private readonly realtime: InventoryRealtimeNotifier,
    private readonly auditLog: BillingAuditLogService,
    private readonly notifications: BillingNotificationPublisher,
  ) {}

  // ---- Raising requests (hooks of offers / invoices / subscriptions) ----

  /** Accepted offer: one request per `article` line. */
  async raiseForOfferLines(offer: OfferEntity, lines: OfferLineItemEntity[]): Promise<void> {
    await this.raiseMany(
      lines
        .filter((line) => line.inventoryArticleId)
        .map((line) => ({
          articleId: line.inventoryArticleId!,
          quantity: Number(line.quantity),
          sourceType: InventoryWithdrawalRequestSource.OFFER,
          sourceRef: `offer-line:${line.id}`,
          sourceLabel: `${offer.offerNumber ?? offer.id}, pos. ${line.position + 1}`,
          userId: offer.userId,
          offerId: offer.id,
        })),
    );
  }

  /** Issued invoice: one request per line referencing an article. */
  async raiseForInvoiceLines(invoice: InvoiceEntity, lines: InvoiceLineItemEntity[]): Promise<void> {
    await this.raiseMany(
      lines
        .filter((line) => line.inventoryArticleId)
        .map((line) => ({
          articleId: line.inventoryArticleId!,
          quantity: Number(line.quantity),
          sourceType: InventoryWithdrawalRequestSource.INVOICE,
          sourceRef: `invoice-line:${line.id}`,
          sourceLabel: `${invoice.invoiceNumber ?? invoice.id}, pos. ${line.position + 1}`,
          userId: invoice.userId,
          invoiceId: invoice.id,
          subscriptionId: invoice.subscriptionId ?? null,
        })),
    );
  }

  /**
   * Issued subscription period invoice: the plan's per-period articles. Keyed by invoice + subscription + article, so
   * a retried billing run raises nothing twice.
   */
  async raiseForSubscriptionPeriod(
    invoice: Pick<InvoiceEntity, 'id' | 'invoiceNumber' | 'userId'>,
    subscription: { id: string; number?: string | null },
    plan: Pick<ServicePlanEntity, 'inventoryArticles' | 'name'>,
  ): Promise<void> {
    await this.raiseMany(
      (plan.inventoryArticles ?? [])
        .filter((entry) => entry.articleId && Number(entry.quantity) > 0)
        .map((entry) => ({
          articleId: entry.articleId,
          quantity: Number(entry.quantity),
          sourceType: InventoryWithdrawalRequestSource.SUBSCRIPTION,
          sourceRef: `subscription-invoice:${invoice.id}:${subscription.id}:${entry.articleId}`,
          sourceLabel: `${invoice.invoiceNumber ?? invoice.id}, ${subscription.number ?? plan.name}`,
          userId: invoice.userId,
          invoiceId: invoice.id,
          subscriptionId: subscription.id,
        })),
    );
  }

  /**
   * Never fails the calling business process (offer acceptance, invoice issue): an article that vanished or a
   * duplicate is logged and skipped.
   */
  private async raiseMany(requests: NewRequest[]): Promise<void> {
    for (const request of requests) {
      try {
        const article = await this.articlesRepository.findByIdOrThrow(request.articleId);
        const created = await this.requestsRepository.createIfAbsent({ ...request, quantity: request.quantity });

        if (!created) {
          continue;
        }

        await this.auditLog.log({
          process: 'inventory.request.created',
          level: 'info',
          message: `Withdrawal of ${request.quantity} × ${article.articleNumber} requested (${request.sourceLabel})`,
          userId: request.userId ?? undefined,
          offerId: request.offerId ?? undefined,
          invoiceId: request.invoiceId ?? undefined,
          context: { requestId: created.id, articleId: article.id, sourceRef: request.sourceRef },
        });

        const response = await this.toResponse(created);

        this.notifications.publish('withdrawal_request.created', { ...response }, request.userId ?? undefined);
        this.realtime.requestChanged(response);
        await this.realtime.articlesChanged([article.id]);
      } catch (error) {
        this.logger.error(
          `Raising withdrawal request ${request.sourceRef} failed: ${(error as Error).message}`,
          (error as Error).stack,
        );
      }
    }
  }

  // ---- Administration ----

  async list(
    limit: number | undefined,
    offset: number | undefined,
    filters: { status?: InventoryWithdrawalRequestStatus; search?: string; articleId?: string },
  ): Promise<PaginatedInventoryResponseDto<InventoryWithdrawalRequestResponseDto>> {
    const page = inventoryPage(limit, offset);
    const { items, total } = await this.requestsRepository.findAll(page.limit, page.offset, filters);

    return { items: await this.toResponses(items), total };
  }

  async get(id: string): Promise<InventoryWithdrawalRequestResponseDto> {
    return await this.toResponse(await this.requestsRepository.findByIdOrThrow(id));
  }

  /**
   * Books one withdrawal per allocation in a single transaction (all or nothing) and marks the request accepted.
   * Allocations must add up to the requested quantity.
   */
  async accept(
    id: string,
    dto: AcceptInventoryWithdrawalRequestDto,
    adminUserId?: string,
  ): Promise<InventoryWithdrawalRequestResponseDto> {
    const request = await this.requestsRepository.findByIdOrThrow(id);

    if (request.status !== InventoryWithdrawalRequestStatus.PENDING) {
      throw new ConflictException('Request was already decided');
    }

    const compartmentIds = dto.allocations.map((allocation) => allocation.compartmentId);

    if (new Set(compartmentIds).size !== compartmentIds.length) {
      throw new BadRequestException('Each compartment may only be listed once');
    }

    const allocated = dto.allocations.reduce((sum, allocation) => sum + Math.round(allocation.quantity * 1000), 0);

    if (allocated !== Math.round(Number(request.quantity) * 1000)) {
      throw new BadRequestException(`Allocations must add up to the requested quantity (${Number(request.quantity)})`);
    }

    const before = await this.movementsService.articleTotal(request.articleId);
    const requestSnapshot = await this.requestSnapshot(request);
    const movements = await this.dataSource.transaction(async (manager) => {
      // Re-check under lock: a concurrent decision must not book twice.
      const locked = await this.requestsRepository.lockPending(manager, id);

      if (!locked) {
        throw new ConflictException('Request was already decided');
      }

      const booked: InventoryMovementEntity[] = [];

      for (const allocation of dto.allocations) {
        booked.push(
          await this.movementsService.book(manager, {
            type: InventoryMovementType.WITHDRAWAL,
            articleId: request.articleId,
            quantity: allocation.quantity,
            sourceCompartmentId: allocation.compartmentId,
            serialNumbers: allocation.serialNumbers,
            reason: InventoryMovementReason.FULFILLMENT,
            reference: request.sourceLabel,
            note: dto.note ?? null,
            performedByUserId: adminUserId ?? null,
            withdrawalRequestId: request.id,
            requestSnapshot,
          }),
        );
      }

      await this.requestsRepository.decide(manager, id, {
        status: InventoryWithdrawalRequestStatus.ACCEPTED,
        decidedAt: new Date(),
        decidedByUserId: adminUserId ?? null,
        decisionNote: dto.note ?? null,
      });

      return booked;
    });

    await this.movementsService.afterCommit(movements, { [request.articleId]: before });

    return await this.afterDecision(id, 'accepted', adminUserId, {
      movementIds: movements.map((movement) => movement.id),
      documentNumbers: movements.map((movement) => movement.documentNumber),
    });
  }

  async reject(
    id: string,
    dto: RejectInventoryWithdrawalRequestDto,
    adminUserId?: string,
  ): Promise<InventoryWithdrawalRequestResponseDto> {
    await this.requestsRepository.findByIdOrThrow(id);
    await this.dataSource.transaction(async (manager) => {
      if (!(await this.requestsRepository.lockPending(manager, id))) {
        throw new ConflictException('Request was already decided');
      }

      await this.requestsRepository.decide(manager, id, {
        status: InventoryWithdrawalRequestStatus.REJECTED,
        decidedAt: new Date(),
        decidedByUserId: adminUserId ?? null,
        decisionNote: dto.note ?? null,
      });
    });

    return await this.afterDecision(id, 'rejected', adminUserId, { note: dto.note ?? null });
  }

  private async afterDecision(
    id: string,
    decision: 'accepted' | 'rejected',
    adminUserId: string | undefined,
    context: Record<string, unknown>,
  ): Promise<InventoryWithdrawalRequestResponseDto> {
    const response = await this.get(id);

    await this.auditLog.log({
      process: `inventory.request.${decision}`,
      level: 'info',
      message: `Withdrawal request ${response.sourceLabel} ${decision}`,
      userId: response.userId ?? undefined,
      offerId: response.offerId ?? undefined,
      invoiceId: response.invoiceId ?? undefined,
      context: { requestId: id, adminUserId, ...context },
    });
    this.notifications.publish(`withdrawal_request.${decision}`, { ...response }, response.userId ?? undefined);
    this.realtime.requestChanged(response);
    await this.realtime.articlesChanged([response.article.id]);

    return response;
  }

  private async requestSnapshot(
    request: InventoryWithdrawalRequestEntity,
  ): Promise<NonNullable<InventoryMovementEntity['snapshot']['request']>> {
    const profile = request.userId ? await this.customerProfilesRepository.findByUserId(request.userId) : null;
    const customerName = profile
      ? profile.company?.trim() || [profile.firstName, profile.lastName].filter(Boolean).join(' ').trim() || null
      : null;

    return {
      sourceType: request.sourceType,
      reference: request.sourceLabel,
      customerNumber: profile?.customerNumber ?? null,
      customerName,
    };
  }

  private async toResponse(request: InventoryWithdrawalRequestEntity): Promise<InventoryWithdrawalRequestResponseDto> {
    const [response] = await this.toResponses([request]);

    return response!;
  }

  private async toResponses(
    requests: InventoryWithdrawalRequestEntity[],
  ): Promise<InventoryWithdrawalRequestResponseDto[]> {
    const articleIds = [...new Set(requests.map((request) => request.articleId))];
    const articles = new Map(
      (await this.articlesRepository.findByIds(articleIds)).map((article) => [article.id, article]),
    );
    const totals = await this.articlesRepository.stockTotalsFor(articleIds);
    const emails = new Map<string, string | null>();
    const responses: InventoryWithdrawalRequestResponseDto[] = [];

    for (const request of requests) {
      const article = articles.get(request.articleId);

      if (!article) {
        continue;
      }

      if (request.userId && !emails.has(request.userId)) {
        emails.set(request.userId, (await this.usersRepository.findByIdForTenant(request.userId))?.email ?? null);
      }

      const movementIds =
        request.status === InventoryWithdrawalRequestStatus.ACCEPTED
          ? (await this.movementsRepository.findAll(50, 0, { withdrawalRequestId: request.id })).items.map(
              (movement) => movement.id,
            )
          : [];

      responses.push(
        mapWithdrawalRequest(request, article, {
          availableQuantity: totals.get(article.id)?.totalQuantity ?? 0,
          customerEmail: request.userId ? (emails.get(request.userId) ?? null) : null,
          movementIds,
        }),
      );
    }

    return responses;
  }
}
