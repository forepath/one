import { groupOpenPositionsBySubscription } from './open-position-grouping.util';

describe('groupOpenPositionsBySubscription', () => {
  it('groups duplicate subscription positions and picks latest billUntil', () => {
    const groups = groupOpenPositionsBySubscription([
      {
        id: 'pos-1',
        subscriptionId: 'sub-1',
        userId: 'user-1',
        billUntil: new Date('2024-01-01'),
      },
      {
        id: 'pos-2',
        subscriptionId: 'sub-1',
        userId: 'user-1',
        billUntil: new Date('2024-02-01'),
      },
      {
        id: 'pos-3',
        subscriptionId: 'sub-2',
        userId: 'user-1',
        billUntil: new Date('2024-01-15'),
      },
    ] as never);

    expect(groups).toHaveLength(2);
    expect(groups[0].subscriptionId).toBe('sub-1');
    expect(groups[0].positions).toHaveLength(2);
    expect(groups[0].representative.id).toBe('pos-2');
  });
});
