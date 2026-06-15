import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { ReservedHostnameEntity } from '../entities/reserved-hostname.entity';

import { ReservedHostnamesRepository } from './reserved-hostnames.repository';

describe('ReservedHostnamesRepository', () => {
  let repository: jest.Mocked<Repository<ReservedHostnameEntity>>;
  let reservedHostnamesRepository: ReservedHostnamesRepository;

  beforeEach(async () => {
    repository = {
      count: jest.fn(),
      create: jest.fn(),
      save: jest.fn(),
      delete: jest.fn(),
      findOne: jest.fn(),
    } as never;

    const module = await Test.createTestingModule({
      providers: [
        ReservedHostnamesRepository,
        { provide: getRepositoryToken(ReservedHostnameEntity), useValue: repository },
      ],
    }).compile();

    reservedHostnamesRepository = module.get(ReservedHostnamesRepository);
  });

  it('existsByHostname returns true when count > 0', async () => {
    repository.count.mockResolvedValue(1);
    expect(await reservedHostnamesRepository.existsByHostname('foo')).toBe(true);
    expect(repository.count).toHaveBeenCalledWith({ where: { hostname: 'foo' } });
  });

  it('existsByHostname returns false when count is 0', async () => {
    repository.count.mockResolvedValue(0);
    expect(await reservedHostnamesRepository.existsByHostname('foo')).toBe(false);
  });

  it('create saves entity with hostname and subscriptionItemId', async () => {
    const entity = { id: 'e1', hostname: 'bar', subscriptionItemId: 'sub-1' };

    repository.create.mockReturnValue(entity as never);
    repository.save.mockResolvedValue(entity as never);
    const result = await reservedHostnamesRepository.create('bar', 'sub-1');

    expect(repository.create).toHaveBeenCalledWith({ hostname: 'bar', subscriptionItemId: 'sub-1' });
    expect(repository.save).toHaveBeenCalledWith(entity);
    expect(result).toEqual(entity);
  });

  it('deleteBySubscriptionItemId deletes by subscriptionItemId', async () => {
    repository.delete.mockResolvedValue({ affected: 1 } as never);
    await reservedHostnamesRepository.deleteBySubscriptionItemId('sub-1');
    expect(repository.delete).toHaveBeenCalledWith({ subscriptionItemId: 'sub-1' });
  });

  it('findBySubscriptionItemId returns entity when found', async () => {
    const entity = { id: 'e1', hostname: 'bar', subscriptionItemId: 'sub-1' };

    repository.findOne.mockResolvedValue(entity as never);
    expect(await reservedHostnamesRepository.findBySubscriptionItemId('sub-1')).toEqual(entity);
    expect(repository.findOne).toHaveBeenCalledWith({ where: { subscriptionItemId: 'sub-1' } });
  });

  it('findBySubscriptionItemId returns null when not found', async () => {
    repository.findOne.mockResolvedValue(null);
    expect(await reservedHostnamesRepository.findBySubscriptionItemId('sub-1')).toBeNull();
  });
});
