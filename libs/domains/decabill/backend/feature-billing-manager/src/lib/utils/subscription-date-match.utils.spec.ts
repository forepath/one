import { ProvisioningStatus } from '../entities/subscription-item.entity';

import {
  getDeployedOnDate,
  isSubscriptionDeployed,
  matchesSubscriptionDates,
  toUtcCalendarDate,
} from './subscription-date-match.utils';

describe('subscription-date-match.utils', () => {
  it('formats UTC calendar date', () => {
    expect(toUtcCalendarDate(new Date('2024-06-15T23:30:00Z'))).toBe('2024-06-15');
  });

  it('matches orderedOn against subscription createdAt', () => {
    expect(
      matchesSubscriptionDates({ createdAt: new Date('2024-01-10T12:00:00Z') }, [], { orderedOn: '2024-01-10' }),
    ).toBe(true);
  });

  it('rejects wrong orderedOn', () => {
    expect(
      matchesSubscriptionDates({ createdAt: new Date('2024-01-10T12:00:00Z') }, [], { orderedOn: '2024-01-11' }),
    ).toBe(false);
  });

  it('ignores receivedOn when not deployed', () => {
    expect(
      matchesSubscriptionDates(
        { createdAt: new Date('2024-01-10T12:00:00Z') },
        [{ provisioningStatus: ProvisioningStatus.PENDING, createdAt: new Date() }],
        { orderedOn: '2024-01-10', receivedOn: '2024-02-01' },
      ),
    ).toBe(true);
  });

  it('matches receivedOn when deployed', () => {
    const items = [
      {
        provisioningStatus: ProvisioningStatus.ACTIVE,
        provisionedAt: new Date('2024-02-01T08:00:00Z'),
        createdAt: new Date('2024-02-01T08:00:00Z'),
      },
    ];

    expect(isSubscriptionDeployed(items)).toBe(true);
    expect(getDeployedOnDate(items)?.toISOString()).toBe('2024-02-01T08:00:00.000Z');
    expect(
      matchesSubscriptionDates({ createdAt: new Date('2024-01-10T12:00:00Z') }, items, {
        orderedOn: '2024-01-10',
        receivedOn: '2024-02-01',
      }),
    ).toBe(true);
  });

  it('rejects receivedOn mismatch when deployed', () => {
    const items = [
      {
        provisioningStatus: ProvisioningStatus.ACTIVE,
        provisionedAt: new Date('2024-02-01T08:00:00Z'),
        createdAt: new Date('2024-02-01T08:00:00Z'),
      },
    ];

    expect(
      matchesSubscriptionDates({ createdAt: new Date('2024-01-10T12:00:00Z') }, items, {
        orderedOn: '2024-01-10',
        receivedOn: '2024-03-01',
      }),
    ).toBe(false);
  });
});
