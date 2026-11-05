import { Injectable } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import type { SupplierProfileEntity } from '../entities/supplier-profile.entity';
import { BillingNotificationPublisher } from '../notifications/billing-notification.publisher';
import { DatevCreditorAccountsRepository } from '../repositories/datev-creditor-accounts.repository';
import { resolveNumberScopeKey } from '../utils/number-scope.utils';

import type { DatevTenantExportConfig } from './datev-export-config.service';

const MAX_ALLOCATION_ATTEMPTS = 5;

function isUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }

  const driverError = error.driverError as { code?: string } | undefined;

  return driverError?.code === '23505';
}

@Injectable()
export class DatevCreditorAccountService {
  constructor(
    private readonly creditorAccountsRepository: DatevCreditorAccountsRepository,
    private readonly billingNotificationPublisher: BillingNotificationPublisher,
  ) {}

  async resolveCreditorNumber(tenantId: string, supplierId: string, config: DatevTenantExportConfig): Promise<number> {
    const existing = await this.creditorAccountsRepository.findByTenantAndSupplierId(tenantId, supplierId);

    if (existing) {
      return existing.creditorNumber;
    }

    const allocationScope = resolveNumberScopeKey();
    const start = config.creditorAccountStart ?? 70000;
    const end = config.creditorAccountEnd ?? 99999;

    for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
      const raced = await this.creditorAccountsRepository.findByTenantAndSupplierId(tenantId, supplierId);

      if (raced) {
        return raced.creditorNumber;
      }

      const max = await this.creditorAccountsRepository.findMaxCreditorNumber(allocationScope);
      const next = max == null ? start : max + 1;

      if (next > end) {
        this.billingNotificationPublisher.publishCreditorRangeExhausted({
          tenantId,
          nextCandidate: next,
          rangeStart: start,
          rangeEnd: end,
          allocationScope,
        });
        throw new Error(`Creditor account range exhausted for tenant ${tenantId}`);
      }

      try {
        const created = await this.creditorAccountsRepository.create(tenantId, supplierId, next, allocationScope);

        this.billingNotificationPublisher.publishSupplierCreditorAllocated({
          tenantId,
          supplierId,
          creditorNumber: created.creditorNumber,
        });

        return created.creditorNumber;
      } catch (error) {
        if (!isUniqueConstraintViolation(error) || attempt === MAX_ALLOCATION_ATTEMPTS - 1) {
          throw error;
        }
      }
    }

    throw new Error(`Failed to allocate creditor number for tenant ${tenantId}`);
  }

  formatCreditorDisplayName(profile: SupplierProfileEntity): string {
    if (profile.company?.trim()) {
      return profile.company.trim();
    }

    const parts = [profile.firstName, profile.lastName].filter(Boolean);

    return parts.join(' ').trim() || profile.email || profile.id;
  }
}
