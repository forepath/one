import { patchSubscriptionItemDisplayName } from './patch-subscription-item-display-name.util';

describe('patchSubscriptionItemDisplayName', () => {
  it('updates matching item displayName', () => {
    const subscription = {
      id: 'sub-1',
      items: [
        {
          id: 'item-1',
          subscriptionId: 'sub-1',
          serviceTypeId: 'st',
          serviceTypeName: 'Cloud',
          provisioningStatus: 'active' as const,
          hostname: 'h1',
          displayName: null,
          service: null,
          sshAccessGranted: false,
        },
      ],
    };
    const patched = patchSubscriptionItemDisplayName(subscription, 'item-1', 'Renamed');

    expect(patched.items?.[0].displayName).toBe('Renamed');
    expect(subscription.items?.[0].displayName).toBeNull();
  });

  it('returns the same subscription when item is missing', () => {
    const subscription = { id: 'sub-1', items: [] };

    expect(patchSubscriptionItemDisplayName(subscription, 'missing', 'X')).toBe(subscription);
  });
});
