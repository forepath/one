import type { PlanEntity } from '../entities/plan.entity';
import { ChangeEventsService } from './change-events.service';

describe('ChangeEventsService', () => {
  it('awaits plan-created listeners in order and never fails the emitter', async () => {
    const events = new ChangeEventsService();
    const seen: string[] = [];

    events.onPlanCreated(async (plan) => {
      seen.push(`a:${plan.id}`);
      throw new Error('listener broke');
    });
    events.onPlanCreated(async (plan) => {
      seen.push(`b:${plan.id}`);
    });

    await expect(events.planCreated({ id: 'p1' } as PlanEntity)).resolves.toBeUndefined();
    expect(seen).toEqual(['a:p1', 'b:p1']);
  });

  it('delivers status and access changes; empty access changes are dropped', async () => {
    const events = new ChangeEventsService();
    const statuses: unknown[] = [];
    const access: unknown[] = [];

    events.onPlanStatus(async (s) => void statuses.push(s));
    events.onAccessChanged(async (a) => void access.push(a));
    events.planStatus('p1', 'applied');
    events.accessChanged({ cluster: false, projects: [] });
    events.accessChanged({ cluster: false, projects: ['shop'] });
    await new Promise((r) => setImmediate(r));

    expect(statuses).toEqual([{ planId: 'p1', status: 'applied' }]);
    expect(access).toEqual([{ cluster: false, projects: ['shop'] }]);
  });
});
