import { CancellationPolicyService } from './cancellation-policy.service';

describe('CancellationPolicyService', () => {
  const service = new CancellationPolicyService();

  it('blocks cancellation before commitment end', () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    const now = new Date('2024-01-02T00:00:00Z');
    const decision = service.evaluate(createdAt, undefined, true, 10, 0, now);

    expect(decision.canCancel).toBe(false);
  });

  it('allows cancellation within notice window', () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    const periodEnd = new Date('2024-02-01T00:00:00Z');
    const now = new Date('2024-01-30T00:00:00Z');
    const decision = service.evaluate(createdAt, periodEnd, true, 0, 3, now);

    expect(decision.canCancel).toBe(true);
  });

  it('forces period-end effective date for advance-billed plans even when cancelAtPeriodEnd is false', () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    const periodEnd = new Date('2024-02-01T00:00:00Z');
    const now = new Date('2024-01-15T00:00:00Z');
    const decision = service.evaluate(createdAt, periodEnd, false, 0, 0, now, { billInAdvance: true });

    expect(decision.canCancel).toBe(true);
    expect(decision.effectiveAt).toEqual(periodEnd);
  });

  it('allows advance cancel mid-period even when noticeDays would block arrear period-end cancel', () => {
    const createdAt = new Date('2024-01-01T00:00:00Z');
    const periodEnd = new Date('2025-01-01T00:00:00Z');
    const now = new Date('2024-06-01T00:00:00Z');
    const decision = service.evaluate(createdAt, periodEnd, false, 0, 30, now, { billInAdvance: true });

    expect(decision.canCancel).toBe(true);
    expect(decision.effectiveAt).toEqual(periodEnd);
  });
});
