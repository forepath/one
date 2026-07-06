import { Injectable } from '@nestjs/common';

import { getStatutoryWithdrawalPeriodDays } from '../constants/withdrawal-policy.config';
import { ProvisioningStatus } from '../entities/subscription-item.entity';
import type { SubscriptionItemEntity } from '../entities/subscription-item.entity';
import { SubscriptionStatus } from '../entities/subscription.entity';
import type { ServiceTypeEntity } from '../entities/service-type.entity';

export type WithdrawalPhase =
  | 'unprovisioned'
  | 'withdrawal_period'
  | 'expired'
  | 'excluded_by_service_type'
  | 'not_eligible';

export interface WithdrawalDecision {
  canWithdraw: boolean;
  reason?: string;
  deadline?: Date;
  phase: WithdrawalPhase;
}

export interface WithdrawalPolicyInfo {
  periodDays: number;
  allowedAfterProvisioning: boolean;
  unprovisionedAlwaysWithdrawable: true;
  provisionedRefundPolicy: 'unused_period_prorated';
}

export interface WithdrawalEvaluationInput {
  subscriptionStatus: SubscriptionStatus;
  items: Pick<SubscriptionItemEntity, 'provisioningStatus' | 'provisionedAt' | 'createdAt'>[];
  serviceType: Pick<ServiceTypeEntity, 'disallowStatutoryWithdrawal'>;
  now?: Date;
}

@Injectable()
export class WithdrawalPolicyService {
  buildPolicyInfo(serviceType: Pick<ServiceTypeEntity, 'disallowStatutoryWithdrawal'>): WithdrawalPolicyInfo {
    return {
      periodDays: getStatutoryWithdrawalPeriodDays(),
      allowedAfterProvisioning: !serviceType.disallowStatutoryWithdrawal,
      unprovisionedAlwaysWithdrawable: true,
      provisionedRefundPolicy: 'unused_period_prorated',
    };
  }

  evaluate(input: WithdrawalEvaluationInput): WithdrawalDecision {
    const now = input.now ?? new Date();

    if (
      input.subscriptionStatus === SubscriptionStatus.CANCELED ||
      input.subscriptionStatus === SubscriptionStatus.PENDING_CANCEL
    ) {
      return { canWithdraw: false, phase: 'not_eligible', reason: 'Subscription is not active' };
    }

    if (input.subscriptionStatus !== SubscriptionStatus.ACTIVE) {
      return { canWithdraw: false, phase: 'not_eligible', reason: 'Subscription is not active' };
    }

    const activeItems = input.items.filter((item) => item.provisioningStatus === ProvisioningStatus.ACTIVE);
    const isProvisioned = activeItems.length > 0;

    if (!isProvisioned) {
      return { canWithdraw: true, phase: 'unprovisioned' };
    }

    if (input.serviceType.disallowStatutoryWithdrawal) {
      return {
        canWithdraw: false,
        phase: 'excluded_by_service_type',
        reason: 'Statutory withdrawal is not available for this product after provisioning',
      };
    }

    const periodDays = getStatutoryWithdrawalPeriodDays();
    const earliestProvisionedAt = activeItems.reduce((earliest, item) => {
      const reference = item.provisionedAt ?? item.createdAt;

      return reference < earliest ? reference : earliest;
    }, activeItems[0].provisionedAt ?? activeItems[0].createdAt);
    const deadline = new Date(earliestProvisionedAt);

    deadline.setDate(deadline.getDate() + periodDays);

    if (now > deadline) {
      return {
        canWithdraw: false,
        phase: 'expired',
        reason: 'Statutory withdrawal period has expired',
        deadline,
      };
    }

    return { canWithdraw: true, phase: 'withdrawal_period', deadline };
  }
}
