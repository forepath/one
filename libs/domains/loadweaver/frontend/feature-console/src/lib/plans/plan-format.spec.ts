import { testPlan } from '../testing';
import { groupByLayer, mayApprove, mayChange, pinWarnings, planSummary } from './plan-format';

describe('plan format', () => {
  it('lets operators of a touched project approve others’ plans once', () => {
    const operator = { userId: 'op', clusterRole: null, projects: { shop: 'operator' as const } };

    expect(mayApprove(testPlan(), operator)).toBe(true);
    expect(mayApprove(testPlan({ createdBy: 'op' }), operator)).toBe(false);
    expect(
      mayApprove(
        testPlan({ approvals: [{ project: 'shop', userId: 'op', createdAt: '2026-10-01T10:00:00Z' }] }),
        operator,
      ),
    ).toBe(false);
    expect(mayApprove(testPlan(), { userId: 'dev', clusterRole: null, projects: { shop: 'developer' } })).toBe(false);
    expect(mayApprove(testPlan({ status: 'applied' }), operator)).toBe(false);
  });

  it('lets developers change project plans and infra roles cluster-level ones', () => {
    const clusterPlan = testPlan({
      changes: [
        { action: 'update', kind: 'Site', name: 'fra1', project: null, baseGeneration: 1, before: {}, after: {} },
      ],
    });

    expect(mayChange(testPlan(), { userId: 'd', clusterRole: null, projects: { shop: 'developer' } })).toBe(true);
    expect(mayChange(testPlan(), { userId: 'v', clusterRole: null, projects: { shop: 'viewer' } })).toBe(false);
    expect(mayChange(clusterPlan, { userId: 'i', clusterRole: 'infra-operator', projects: {} })).toBe(true);
    expect(mayChange(clusterPlan, { userId: 'a', clusterRole: 'auditor', projects: {} })).toBe(false);
    expect(mayChange(testPlan(), null)).toBe(false);
  });

  it('groups the network effect by layer in layer order', () => {
    expect(groupByLayer(testPlan().networkChanges.slice().reverse()).map((g) => g.layer)).toEqual([
      'tunnels',
      'dns-records',
    ]);
  });

  it('summarises the changed resources and finds pins', () => {
    expect(planSummary(testPlan())).toBe('Deployment shop/web');
    expect(
      pinWarnings(testPlan({ warnings: [{ message: 'unacknowledged pin', pin: true }, { message: 'x' }] })),
    ).toHaveLength(1);
  });
});
