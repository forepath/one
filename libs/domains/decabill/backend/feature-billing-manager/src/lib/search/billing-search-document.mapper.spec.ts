import type { CustomerProfileEntity } from '../entities/customer-profile.entity';
import type { SubscriptionEntity } from '../entities/subscription.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';

import { mapCustomerProfileToSearchDocument, mapSubscriptionToSearchDocument } from './billing-search-document.mapper';

describe('billing-search-document.mapper', () => {
  it('mapSubscriptionToSearchDocument_IncludesTenantAndAllowlistedFields', () => {
    const subscription = {
      id: 'sub-1',
      number: 'SUB-001',
      status: SubscriptionStatus.ACTIVE,
      userId: 'user-1',
      planId: 'plan-1',
    } as SubscriptionEntity;
    const doc = mapSubscriptionToSearchDocument(subscription, 'tenant-a', {
      planName: 'Starter',
      userEmail: 'a@example.com',
    });

    expect(doc).toEqual(
      expect.objectContaining({
        id: 'sub-1',
        tenantId: 'tenant-a',
        entityType: 'subscriptions',
        number: 'SUB-001',
        planName: 'Starter',
        userEmail: 'a@example.com',
      }),
    );
    expect(doc).not.toHaveProperty('stripeCustomerId');
  });

  it('mapCustomerProfileToSearchDocument_OmitsSecretsAndEncryptedCustomData', () => {
    const profile = {
      id: 'cp-1',
      userId: 'user-1',
      customerNumber: 'C-1',
      firstName: 'Ada',
      lastName: 'Lovelace',
      email: 'ada@example.com',
      stripeCustomerId: 'cus_secret',
      customData: { externalId: 'should-not-index' },
      defaultPaymentMethodExternalId: 'pm_secret',
    } as unknown as CustomerProfileEntity;
    const doc = mapCustomerProfileToSearchDocument(profile, 'tenant-a');

    expect(doc.id).toBe('cp-1');
    expect(doc.tenantId).toBe('tenant-a');
    expect(doc.firstName).toBe('Ada');
    expect(doc).not.toHaveProperty('stripeCustomerId');
    expect(doc).not.toHaveProperty('customData');
    expect(doc).not.toHaveProperty('defaultPaymentMethodExternalId');
  });
});
