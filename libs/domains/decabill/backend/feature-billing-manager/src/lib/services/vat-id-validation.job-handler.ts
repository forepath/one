import { Injectable, Logger } from '@nestjs/common';

import { CustomerProfilesRepository } from '../repositories/customer-profiles.repository';

import { VatIdValidationService } from './vat-id-validation.service';

@Injectable()
export class VatIdValidationJobHandler {
  private readonly logger = new Logger(VatIdValidationJobHandler.name);

  constructor(
    private readonly vatIdValidationService: VatIdValidationService,
    private readonly customerProfilesRepository: CustomerProfilesRepository,
  ) {}

  async processUnit(payload: { profileId: string; userId: string; vatId: string }): Promise<void> {
    const result = await this.vatIdValidationService.validateAsync(payload);
    const profile = await this.customerProfilesRepository.findByIdOrThrow(payload.profileId);

    await this.customerProfilesRepository.update(profile.id, {
      vatId: result.vatId ?? undefined,
      vatIdValidationStatus: result.status,
      vatIdValidatedAt: result.validatedAt,
      vatIdValidationSource: result.source,
    });
  }
}
