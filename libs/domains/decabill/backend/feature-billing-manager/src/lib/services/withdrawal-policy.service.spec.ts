import { ProvisioningStatus } from '../entities/subscription-item.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';

import { WithdrawalPolicyService } from './withdrawal-policy.service';

describe('WithdrawalPolicyService', () => {
  const service = new WithdrawalPolicyService();

  it('allows withdrawal for unprovisioned active subscription', () => {
    const decision = service.evaluate({
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      items: [{ provisioningStatus: ProvisioningStatus.PENDING, createdAt: new Date('2024-01-01') }],
      serviceType: { disallowStatutoryWithdrawal: false },
    });

    expect(decision.canWithdraw).toBe(true);
    expect(decision.phase).toBe('unprovisioned');
  });

  it('allows withdrawal within statutory period after provisioning', () => {
    const provisionedAt = new Date('2024-01-01T00:00:00Z');
    const now = new Date('2024-01-10T00:00:00Z');
    const decision = service.evaluate({
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      items: [{ provisioningStatus: ProvisioningStatus.ACTIVE, provisionedAt, createdAt: provisionedAt }],
      serviceType: { disallowStatutoryWithdrawal: false },
      now,
    });

    expect(decision.canWithdraw).toBe(true);
    expect(decision.phase).toBe('withdrawal_period');
  });

  it('blocks withdrawal after statutory period', () => {
    const provisionedAt = new Date('2024-01-01T00:00:00Z');
    const now = new Date('2024-02-01T00:00:00Z');
    const decision = service.evaluate({
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      items: [{ provisioningStatus: ProvisioningStatus.ACTIVE, provisionedAt, createdAt: provisionedAt }],
      serviceType: { disallowStatutoryWithdrawal: false },
      now,
    });

    expect(decision.canWithdraw).toBe(false);
    expect(decision.phase).toBe('expired');
  });

  it('blocks post-provisioning withdrawal when service type disallows', () => {
    const provisionedAt = new Date('2024-01-01T00:00:00Z');
    const decision = service.evaluate({
      subscriptionStatus: SubscriptionStatus.ACTIVE,
      items: [{ provisioningStatus: ProvisioningStatus.ACTIVE, provisionedAt, createdAt: provisionedAt }],
      serviceType: { disallowStatutoryWithdrawal: true },
      now: new Date('2024-01-05T00:00:00Z'),
    });

    expect(decision.canWithdraw).toBe(false);
    expect(decision.phase).toBe('excluded_by_service_type');
  });

  it('builds policy info from service type', () => {
    expect(service.buildPolicyInfo({ disallowStatutoryWithdrawal: true })).toEqual({
      periodDays: 14,
      allowedAfterProvisioning: false,
      unprovisionedAlwaysWithdrawable: true,
      provisionedRefundPolicy: 'unused_period_prorated',
    });
  });
});
