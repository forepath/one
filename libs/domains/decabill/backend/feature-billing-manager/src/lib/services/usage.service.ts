import { BadRequestException, Injectable } from '@nestjs/common';

import type { UpdateUsageMeterEntryDto } from '../dto/create-usage-record.dto';
import type { UsageMeterEntryResponseDto } from '../dto/meter-response.dto';
import type { UsageAttachmentType, UsageRecordEntity } from '../entities/usage-record.entity';
import { AddonMetersRepository } from '../repositories/addon-meters.repository';
import { ServicePlanMetersRepository } from '../repositories/service-plan-meters.repository';
import { ServicePlansRepository } from '../repositories/service-plans.repository';
import { ServiceTypeMetersRepository } from '../repositories/service-type-meters.repository';
import { SubscriptionAddonsRepository } from '../repositories/subscription-addons.repository';
import { SubscriptionsRepository } from '../repositories/subscriptions.repository';
import { UsageRecordsRepository } from '../repositories/usage-records.repository';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';

import { MeterBillingService } from './meter-billing.service';

@Injectable()
export class UsageService {
  constructor(
    private readonly usageRecordsRepository: UsageRecordsRepository,
    private readonly subscriptionsRepository: SubscriptionsRepository,
    private readonly servicePlansRepository: ServicePlansRepository,
    private readonly servicePlanMetersRepository: ServicePlanMetersRepository,
    private readonly serviceTypeMetersRepository: ServiceTypeMetersRepository,
    private readonly addonMetersRepository: AddonMetersRepository,
    private readonly subscriptionAddonsRepository: SubscriptionAddonsRepository,
    private readonly meterBillingService: MeterBillingService,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
  ) {}

  async getLatestUsage(subscriptionId: string) {
    return await this.usageRecordsRepository.findLatestForSubscription(subscriptionId);
  }

  async listMeterEntries(subscriptionId: string): Promise<UsageMeterEntryResponseDto[]> {
    const rows = await this.usageRecordsRepository.findMeteredForSubscription(subscriptionId);

    return rows.map((row) => this.mapEntry(row));
  }

  async createUsage(dto: {
    subscriptionId: string;
    periodStart: Date;
    periodEnd: Date;
    usageSource: string;
    usagePayload?: Record<string, unknown>;
    meterId?: string;
    value?: number;
    attachmentType?: UsageAttachmentType;
    addonId?: string;
  }) {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(dto.subscriptionId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);

    if (plan.billInAdvance === true) {
      throw new BadRequestException('Usage-based billing is not available for advance-billed (prepaid) subscriptions');
    }

    const hasMeterAttachments = await this.meterBillingService.hasAnyMeterAttachments(subscription, plan.serviceTypeId);
    const meterId = dto.meterId;

    if (hasMeterAttachments) {
      if (!meterId || dto.value === undefined || dto.value === null) {
        throw new BadRequestException('meterId and value are required when the subscription has meter attachments');
      }
    }

    let attachmentType: UsageAttachmentType | null = null;
    let addonId: string | null = null;

    if (meterId) {
      if (dto.value === undefined || dto.value === null || !Number.isFinite(dto.value)) {
        throw new BadRequestException('value must be a finite number when meterId is set');
      }

      if (dto.value < 0) {
        throw new BadRequestException('value must be greater than or equal to 0 when meterId is set');
      }

      attachmentType = dto.attachmentType ?? 'plan';
      addonId = attachmentType === 'addon' ? (dto.addonId ?? null) : null;
      await this.assertAttachmentAllowed(
        subscription.id,
        subscription.planId,
        plan.serviceTypeId,
        meterId,
        attachmentType,
        addonId,
      );
    }

    const record = await this.usageRecordsRepository.create({
      subscriptionId: dto.subscriptionId,
      periodStart: dto.periodStart,
      periodEnd: dto.periodEnd,
      usageSource: dto.usageSource,
      usagePayload: dto.usagePayload ?? {},
      meterId: meterId ?? null,
      value: meterId != null ? String(dto.value) : null,
      attachmentType,
      addonId,
    });

    this.billingNotificationPublisher.publish('usage.recorded', {
      usageRecordId: record.id,
      subscriptionId: record.subscriptionId,
      meterId: record.meterId ?? null,
      attachmentType: record.attachmentType ?? null,
      addonId: record.addonId ?? null,
      value: record.value ?? null,
    });

    return record;
  }

  async updateMeterEntry(
    subscriptionId: string,
    entryId: string,
    dto: UpdateUsageMeterEntryDto,
  ): Promise<UsageMeterEntryResponseDto> {
    const subscription = await this.subscriptionsRepository.findByIdOrThrow(subscriptionId);
    const plan = await this.servicePlansRepository.findByIdOrThrow(subscription.planId);

    if (plan.billInAdvance === true) {
      throw new BadRequestException('Usage-based billing is not available for advance-billed (prepaid) subscriptions');
    }

    const existing = await this.usageRecordsRepository.findByIdForSubscriptionOrThrow(subscriptionId, entryId);

    if (!existing.meterId) {
      throw new BadRequestException('Only metered usage entries can be updated via this endpoint');
    }

    const meterId = dto.meterId ?? existing.meterId;
    const attachmentType = dto.attachmentType ?? existing.attachmentType ?? 'plan';
    const addonId = attachmentType === 'addon' ? (dto.addonId !== undefined ? dto.addonId : existing.addonId) : null;

    await this.assertAttachmentAllowed(
      subscriptionId,
      subscription.planId,
      plan.serviceTypeId,
      meterId,
      attachmentType,
      addonId,
    );

    const updated = await this.usageRecordsRepository.update(existing, {
      periodStart: dto.periodStart ? new Date(dto.periodStart) : existing.periodStart,
      periodEnd: dto.periodEnd ? new Date(dto.periodEnd) : existing.periodEnd,
      value: dto.value !== undefined ? String(dto.value) : existing.value,
      usagePayload: dto.usagePayload ?? existing.usagePayload,
      meterId,
      attachmentType,
      addonId,
    });

    this.billingNotificationPublisher.publish('usage.updated', {
      usageRecordId: updated.id,
      subscriptionId: updated.subscriptionId,
      meterId: updated.meterId ?? null,
      attachmentType: updated.attachmentType ?? null,
      addonId: updated.addonId ?? null,
      value: updated.value ?? null,
    });

    return this.mapEntry(updated);
  }

  async deleteMeterEntry(subscriptionId: string, entryId: string): Promise<void> {
    const existing = await this.usageRecordsRepository.findByIdForSubscriptionOrThrow(subscriptionId, entryId);

    await this.usageRecordsRepository.delete(existing);

    this.billingNotificationPublisher.publish('usage.deleted', {
      usageRecordId: existing.id,
      subscriptionId: existing.subscriptionId,
      meterId: existing.meterId ?? null,
      attachmentType: existing.attachmentType ?? null,
      addonId: existing.addonId ?? null,
    });
  }

  private async assertAttachmentAllowed(
    subscriptionId: string,
    planId: string,
    serviceTypeId: string | null | undefined,
    meterId: string,
    attachmentType: UsageAttachmentType,
    addonId: string | null | undefined,
  ): Promise<void> {
    if (attachmentType === 'plan') {
      const planLink = await this.servicePlanMetersRepository.findByPlanAndMeter(planId, meterId);

      if (planLink) {
        return;
      }

      if (serviceTypeId) {
        const typeLink = await this.serviceTypeMetersRepository.findByServiceTypeAndMeter(serviceTypeId, meterId);

        if (typeLink) {
          return;
        }
      }

      throw new BadRequestException('Meter is not attached to the subscription plan');
    }

    if (!addonId) {
      throw new BadRequestException('addonId is required when attachmentType is addon');
    }

    const billableAddons = await this.subscriptionAddonsRepository.findBillableBySubscriptionId(subscriptionId);
    const hasAddon = billableAddons.some((row) => row.addonId === addonId);

    if (!hasAddon) {
      throw new BadRequestException('Addon is not an active billable addon on this subscription');
    }

    const link = await this.addonMetersRepository.findByAddonAndMeter(addonId, meterId);

    if (!link) {
      throw new BadRequestException('Meter is not attached to the specified addon');
    }
  }

  private mapEntry(row: UsageRecordEntity): UsageMeterEntryResponseDto {
    return {
      id: row.id,
      subscriptionId: row.subscriptionId,
      meterId: row.meterId!,
      value: Number(row.value ?? 0),
      attachmentType: row.attachmentType ?? 'plan',
      addonId: row.addonId ?? null,
      periodStart: row.periodStart,
      periodEnd: row.periodEnd,
      usageSource: row.usageSource,
      usagePayload: row.usagePayload ?? {},
      createdAt: row.createdAt,
    };
  }
}
