import { ProvisioningStatus } from '../entities/subscription-item.entity';

import { getEarliestProvisionedAt } from './provisioned-billing.util';

describe('getEarliestProvisionedAt', () => {
  it('returns undefined when no item was provisioned', () => {
    expect(
      getEarliestProvisionedAt([{ provisioningStatus: ProvisioningStatus.PENDING, createdAt: new Date('2024-01-01') }]),
    ).toBeUndefined();
  });

  it('returns earliest provisionedAt among active items', () => {
    const earliest = getEarliestProvisionedAt([
      {
        provisioningStatus: ProvisioningStatus.ACTIVE,
        provisionedAt: new Date('2024-01-07T00:00:00Z'),
        createdAt: new Date('2024-01-01'),
      },
      {
        provisioningStatus: ProvisioningStatus.ACTIVE,
        provisionedAt: new Date('2024-01-10T00:00:00Z'),
        createdAt: new Date('2024-01-01'),
      },
    ]);

    expect(earliest).toEqual(new Date('2024-01-07T00:00:00Z'));
  });
});
