import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DatevExportScope } from '../constants/datev-export.constants';

import { AdminBillNowDto } from './admin-billing.dto';
import { TriggerDatevExportDto } from './admin-datev-export.dto';

describe('TriggerDatevExportDto', () => {
  it('accepts a valid trigger payload', async () => {
    const dto = plainToInstance(TriggerDatevExportDto, {
      year: 2026,
      month: 1,
      scope: DatevExportScope.TENANT,
      force: false,
    });

    await expect(validate(dto)).resolves.toHaveLength(0);
  });

  it('rejects missing year and month', async () => {
    const dto = plainToInstance(TriggerDatevExportDto, { scope: DatevExportScope.TENANT });
    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['year', 'month']));
  });

  it('rejects invalid month and scope', async () => {
    const dto = plainToInstance(TriggerDatevExportDto, {
      year: 2026,
      month: 13,
      scope: 'invalid',
    });
    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['month', 'scope']));
  });

  it('accepts year and month sent as strings by the console number inputs', async () => {
    const dto = plainToInstance(TriggerDatevExportDto, { year: '2025', month: '3', scope: DatevExportScope.TENANT });

    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto).toEqual(expect.objectContaining({ year: 2025, month: 3 }));
  });

  it('rejects non-numeric year and fractional month', async () => {
    const dto = plainToInstance(TriggerDatevExportDto, { year: 'abc', month: '2.5' });
    const errors = await validate(dto);

    expect(errors.map((error) => error.property)).toEqual(expect.arrayContaining(['year', 'month']));
  });
});

describe('AdminBillNowDto', () => {
  it('accepts no user (bill everyone) and a v4 user id', async () => {
    await expect(validate(plainToInstance(AdminBillNowDto, {}))).resolves.toHaveLength(0);
    await expect(
      validate(plainToInstance(AdminBillNowDto, { userId: '3775918b-e48e-45a6-af49-e425013b71b9' })),
    ).resolves.toHaveLength(0);
  });

  it('rejects a malformed user id', async () => {
    const errors = await validate(plainToInstance(AdminBillNowDto, { userId: "1' OR '1'='1" }));

    expect(errors.map((error) => error.property)).toEqual(['userId']);
  });
});
