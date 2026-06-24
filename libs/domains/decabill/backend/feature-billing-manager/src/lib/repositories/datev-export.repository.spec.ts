import { DatevExportScope } from '../constants/datev-export.constants';

import { DatevExportRepository } from './datev-export.repository';

describe('DatevExportRepository', () => {
  it('filters tenant exports by tenant id', async () => {
    const qb = {
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orderBy: jest.fn().mockReturnThis(),
      addOrderBy: jest.fn().mockReturnThis(),
      take: jest.fn().mockReturnThis(),
      skip: jest.fn().mockReturnThis(),
      getCount: jest.fn().mockResolvedValue(1),
      getMany: jest.fn().mockResolvedValue([{ id: 'exp-1' }]),
    };
    const repository = {
      createQueryBuilder: jest.fn().mockReturnValue(qb),
    };
    const service = new DatevExportRepository(repository as never);

    const result = await service.findAllForAdmin({
      scope: DatevExportScope.TENANT,
      tenantId: 'default',
      limit: 20,
      offset: 0,
    });

    expect(qb.andWhere).toHaveBeenCalledWith('export.tenant_id = :tenantId', { tenantId: 'default' });
    expect(result.total).toBe(1);
  });
});
