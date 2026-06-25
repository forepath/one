import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { DatevExportScope } from '../constants/datev-export.constants';

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
});
