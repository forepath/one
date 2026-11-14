import { Injectable } from '@nestjs/common';

import { DATEV_DEBTOR_ROW_FIELD_COUNT } from '../constants/datev-export.constants';
import type { SupplierProfileEntity } from '../entities/supplier-profile.entity';

import { DatevCreditorAccountService } from './datev-creditor-account.service';

@Injectable()
export class DatevCreditorMapperService {
  constructor(private readonly creditorAccountService: DatevCreditorAccountService) {}

  mapCreditorRow(profile: SupplierProfileEntity, creditorNumber: number): string[] {
    const fields = Array.from({ length: DATEV_DEBTOR_ROW_FIELD_COUNT }, () => '');

    fields[0] = String(creditorNumber);
    fields[1] = this.creditorAccountService.formatCreditorDisplayName(profile);
    fields[2] = profile.company?.trim() ?? '';
    fields[3] = profile.addressLine1?.trim() ?? '';
    fields[4] = profile.addressLine2?.trim() ?? '';
    fields[5] = profile.postalCode?.trim() ?? '';
    fields[6] = profile.city?.trim() ?? '';
    fields[7] = profile.country?.trim() ?? '';
    fields[8] = profile.email?.trim() ?? '';
    fields[9] = profile.phone?.trim() ?? '';

    return fields;
  }
}
