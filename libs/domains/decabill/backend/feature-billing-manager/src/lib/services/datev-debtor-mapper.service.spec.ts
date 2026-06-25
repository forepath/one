import { DATEV_DEBTOR_ROW_FIELD_COUNT } from '../constants/datev-export.constants';
import type { CustomerProfileEntity } from '../entities/customer-profile.entity';

import { DatevDebtorAccountService } from './datev-debtor-account.service';
import { DatevDebtorMapperService } from './datev-debtor-mapper.service';

describe('DatevDebtorMapperService', () => {
  const debtorAccountService = new DatevDebtorAccountService({} as never);
  const service = new DatevDebtorMapperService(debtorAccountService);

  it('maps customer profile to debtor row with 243 fields', () => {
    const profile = {
      userId: 'user-1',
      company: 'Acme GmbH',
      firstName: 'Jane',
      lastName: 'Doe',
      addressLine1: 'Main St 1',
      postalCode: '10115',
      city: 'Berlin',
      country: 'DE',
      email: 'jane@acme.example',
      phone: '+49123456789',
    } as CustomerProfileEntity;

    const row = service.mapDebtorRow(profile, 10_042);

    expect(row).toHaveLength(DATEV_DEBTOR_ROW_FIELD_COUNT);
    expect(row[0]).toBe('10042');
    expect(row[1]).toBe('Acme GmbH');
    expect(row[3]).toBe('Main St 1');
    expect(row[8]).toBe('jane@acme.example');
  });
});
