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
});
