import { OfferStatus } from '../constants/offer-status.constants';

import { OffersRepository } from './offers.repository';

function queryBuilder(items: unknown[], total: number) {
  const qb: Record<string, jest.Mock> = {};

  for (const method of ['innerJoin', 'where', 'andWhere', 'orderBy', 'take', 'skip']) {
    qb[method] = jest.fn(() => qb);
  }
  qb['getCount'] = jest.fn().mockResolvedValue(total);
  qb['getMany'] = jest.fn().mockResolvedValue(items);

  return qb;
}

describe('OffersRepository customer pages', () => {
  it('pages the pending offers of one user with the total (user + tenant scoped)', async () => {
    const qb = queryBuilder([{ id: 'o-1' }], 42);
    const repository = new OffersRepository({ createQueryBuilder: jest.fn(() => qb) } as never);

    const result = await repository.findPendingByUserId('user-1', { limit: 25, offset: 50 });

    expect(result).toEqual({ items: [{ id: 'o-1' }], total: 42 });
    expect(qb['where']).toHaveBeenCalledWith('offer.user_id = :userId', { userId: 'user-1' });
    expect(qb['andWhere']).toHaveBeenCalledWith('offer.status IN (:...statuses)', expect.anything());
    expect(qb['andWhere']).toHaveBeenCalledWith('user.tenant_id = :tenantId', expect.anything());
    expect(qb['andWhere']).toHaveBeenCalledWith('(offer.expires_at IS NULL OR offer.expires_at > NOW())');
    expect(qb['take']).toHaveBeenCalledWith(25);
    expect(qb['skip']).toHaveBeenCalledWith(50);
  });

  it('keeps the user scope on index search hits and pages in SQL', async () => {
    const qb = queryBuilder([], 0);
    const searchIndex = { searchIds: jest.fn().mockResolvedValue({ ids: ['o-9'], total: 1 }) };
    const repository = new OffersRepository({ createQueryBuilder: jest.fn(() => qb) } as never, searchIndex as never);

    await repository.findHistoryByUserId('user-1', { limit: 10, offset: 0, search: 'acme' });

    expect(searchIndex.searchIds).toHaveBeenCalledWith(
      'offers',
      'acme',
      expect.objectContaining({ extraFilters: expect.objectContaining({ userId: 'user-1' }) }),
    );
    expect(qb['andWhere']).toHaveBeenCalledWith('offer.user_id = :userId', { userId: 'user-1' });
    expect(qb['andWhere']).toHaveBeenCalledWith('offer.status IN (:...statuses)', {
      statuses: expect.arrayContaining([OfferStatus.ACCEPTED]),
    });
    expect(qb['take']).toHaveBeenCalledWith(10);
  });
});
