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
  ): CancellationDecision {
    const commitmentEnd = new Date(createdAt);

    commitmentEnd.setDate(commitmentEnd.getDate() + minCommitmentDays);

    if (now < commitmentEnd) {
      return { canCancel: false, reason: 'Minimum commitment not yet reached' };
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
