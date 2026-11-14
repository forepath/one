import { runWithTenantId } from '@forepath/shared/backend';
import { NotFoundException } from '@nestjs/common';

import { CloudInitConfigsRepository } from './cloud-init-configs.repository';

const createMockQueryBuilder = () => ({
  where: jest.fn().mockReturnThis(),
  andWhere: jest.fn().mockReturnThis(),
  orderBy: jest.fn().mockReturnThis(),
  take: jest.fn().mockReturnThis(),
  skip: jest.fn().mockReturnThis(),
  getMany: jest.fn(),
});

describe('CloudInitConfigsRepository', () => {
  let mockQueryBuilder: ReturnType<typeof createMockQueryBuilder>;
  let mockRepository: {
    findOne: jest.Mock;
    find: jest.Mock;
    create: jest.Mock;
    save: jest.Mock;
    remove: jest.Mock;
    createQueryBuilder: jest.Mock;
  };
  let repository: CloudInitConfigsRepository;

  beforeEach(() => {
    jest.resetAllMocks();
    mockQueryBuilder = createMockQueryBuilder();
    mockRepository = {
      findOne: jest.fn(),
      find: jest.fn(),
      create: jest.fn((dto) => dto),
      save: jest.fn(async (entity) => entity),
      remove: jest.fn(),
      createQueryBuilder: jest.fn().mockReturnValue(mockQueryBuilder),
    };
    repository = new CloudInitConfigsRepository(mockRepository as never);
  });

  it('findById scopes query to tenant', async () => {
    const entity = { id: 'cfg-1', tenantId: 'default' };

    mockRepository.findOne.mockResolvedValue(entity);

    const result = await runWithTenantId('default', () => repository.findById('cfg-1'));

    expect(mockRepository.findOne).toHaveBeenCalledWith({ where: { id: 'cfg-1', tenantId: 'default' } });
    expect(result).toEqual(entity);
  });

  it('findByIdOrThrow throws when config is missing in tenant', async () => {
    mockRepository.findOne.mockResolvedValue(null);

    await expect(runWithTenantId('default', () => repository.findByIdOrThrow('missing'))).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('findAll applies tenant filter and pagination', async () => {
    mockQueryBuilder.getMany.mockResolvedValue([{ id: 'cfg-1' }]);

    const result = await runWithTenantId('acme', () => repository.findAll(5, 10));

    expect(mockQueryBuilder.where).toHaveBeenCalledWith('config.tenant_id = :tenantId', { tenantId: 'acme' });
    expect(mockQueryBuilder.take).toHaveBeenCalledWith(5);
    expect(mockQueryBuilder.skip).toHaveBeenCalledWith(10);
    expect(result).toHaveLength(1);
  });

  it('create assigns tenant when omitted', async () => {
    const dto = { key: 'my-app', name: 'My App', dockerImage: 'nginx:latest' };

    await runWithTenantId('default', () => repository.create(dto));

    expect(mockRepository.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'default' }));
    expect(mockRepository.save).toHaveBeenCalled();
  });

  it('create ignores tenantId from dto and uses request tenant', async () => {
    const dto = { key: 'my-app', name: 'My App', dockerImage: 'nginx:latest', tenantId: 'other-tenant' };

    await runWithTenantId('acme', () => repository.create(dto as never));

    expect(mockRepository.create).toHaveBeenCalledWith(expect.objectContaining({ tenantId: 'acme' }));
  });

  it('update does not allow tenantId mutation', async () => {
    const entity = { id: 'cfg-1', tenantId: 'default', key: 'my-app' };

    mockRepository.findOne.mockResolvedValue(entity);

    await runWithTenantId('default', () => repository.update('cfg-1', { tenantId: 'other-tenant', name: 'Renamed' }));

    expect(entity).toEqual(expect.objectContaining({ tenantId: 'default', name: 'Renamed' }));
  });

  it('delete removes entity after lookup', async () => {
    const entity = { id: 'cfg-1', tenantId: 'default' };

    mockRepository.findOne.mockResolvedValue(entity);

    await runWithTenantId('default', () => repository.delete('cfg-1'));

    expect(mockRepository.remove).toHaveBeenCalledWith(entity);
  });
});
