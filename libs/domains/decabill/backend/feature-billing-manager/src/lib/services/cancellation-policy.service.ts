import { Injectable } from '@nestjs/common';

export interface CancellationDecision {
  canCancel: boolean;
  effectiveAt?: Date;
  reason?: string;
}

@Injectable()
export class CancellationPolicyService {
  evaluate(
    createdAt: Date,
    currentPeriodEnd: Date | undefined,
    cancelAtPeriodEnd: boolean,
    minCommitmentDays: number,
    noticeDays: number,
    now: Date = new Date(),
    options?: { billInAdvance?: boolean },
  ): CancellationDecision {
    const commitmentEnd = new Date(createdAt);

    commitmentEnd.setDate(commitmentEnd.getDate() + minCommitmentDays);

    if (now < commitmentEnd) {
      return { canCancel: false, reason: 'Minimum commitment not yet reached' };
    }

    // Advance-billed subscriptions always remain active until the already-paid period ends.
    // Skip the arrear "last N days of period" notice window — prepaid customers may schedule
    // that end any time after the commitment (effective date stays period end).
    if (options?.billInAdvance === true) {
      if (!currentPeriodEnd) {
        return { canCancel: false, reason: 'Current period end is required for advance-billed cancellation' };
      }

      return { canCancel: true, effectiveAt: currentPeriodEnd };
    }

    const effectiveAt = cancelAtPeriodEnd && currentPeriodEnd ? currentPeriodEnd : now;
    const noticeStart = new Date(effectiveAt);

    noticeStart.setDate(noticeStart.getDate() - noticeDays);

    if (now < noticeStart) {
      return { canCancel: false, reason: 'Notice period not satisfied' };
    }

    return { canCancel: true, effectiveAt };
  }
}
