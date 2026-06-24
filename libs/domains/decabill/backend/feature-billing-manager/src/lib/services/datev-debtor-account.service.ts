import { Injectable } from '@nestjs/common';
import { QueryFailedError } from 'typeorm';

import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { DatevTenantExportConfig } from './datev-export-config.service';
import { DatevDebtorAccountsRepository } from '../repositories/datev-debtor-accounts.repository';

const MAX_ALLOCATION_ATTEMPTS = 5;

function isUniqueConstraintViolation(error: unknown): boolean {
  if (!(error instanceof QueryFailedError)) {
    return false;
  }

  const driverError = error.driverError as { code?: string } | undefined;

  return driverError?.code === '23505';
}

@Injectable()
export class DatevDebtorAccountService {
  constructor(private readonly debtorAccountsRepository: DatevDebtorAccountsRepository) {}

  async resolveDebtorNumber(tenantId: string, userId: string, config: DatevTenantExportConfig): Promise<number> {
    const existing = await this.debtorAccountsRepository.findByTenantAndUserId(tenantId, userId);

    if (existing) {
      return existing.debtorNumber;
    }

    for (let attempt = 0; attempt < MAX_ALLOCATION_ATTEMPTS; attempt += 1) {
      const raced = await this.debtorAccountsRepository.findByTenantAndUserId(tenantId, userId);

      if (raced) {
        return raced.debtorNumber;
      }

      const max = await this.debtorAccountsRepository.findMaxDebtorNumber(tenantId);
      const next = max == null ? config.debtorAccountStart : max + 1;

      if (next > config.debtorAccountEnd) {
        throw new Error(`Debtor account range exhausted for tenant ${tenantId}`);
      }

      try {
        const created = await this.debtorAccountsRepository.create(tenantId, userId, next);

        return created.debtorNumber;
      } catch (error) {
        if (!isUniqueConstraintViolation(error) || attempt === MAX_ALLOCATION_ATTEMPTS - 1) {
          throw error;
        }
      }
    }

    throw new Error(`Failed to allocate debtor number for tenant ${tenantId}`);
  }

  formatDebtorDisplayName(profile: CustomerProfileEntity): string {
    if (profile.company?.trim()) {
      return profile.company.trim();
    }

    const parts = [profile.firstName, profile.lastName].filter(Boolean);

    return parts.join(' ').trim() || profile.email || profile.userId;
  }
}
