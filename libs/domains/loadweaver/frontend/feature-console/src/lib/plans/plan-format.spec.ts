import { testPlan } from '../testing';
import { groupByLayer, mayApprove, mayChange, pinWarnings, planAction, planSummary } from './plan-format';

describe('plan format', () => {
  it('lets operators of a touched project approve others’ plans once', () => {
    const operator = { userId: 'op', clusterRole: null, projects: { shop: 'operator' as const } };

    expect(mayApprove(testPlan(), operator)).toBe(true);
    expect(mayApprove(testPlan({ createdBy: 'op' }), operator)).toBe(false);
    // Fleet persons (3.24): the cluster-wide grant's project role counts; the author is compared by person id.
    const fleetOperator = {
      userId: 'fleet:f1:u2',
      clusterRole: 'infra-operator' as const,
      projects: {},
      allProjects: 'operator' as const,
    };

    expect(mayApprove(testPlan(), fleetOperator)).toBe(true);
    expect(mayApprove(testPlan({ createdBy: 'fleet:f1:u2' }), fleetOperator)).toBe(false);
    expect(mayApprove(testPlan(), { ...fleetOperator, allProjects: 'viewer' as never })).toBe(false);
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
    // Readable kind names and the shared action for the rail's meta line (LW-07 round 2).
    const policy = testPlan({
      changes: [{ ...testPlan().changes[0], kind: 'BackupPolicy', name: 'nightly', action: 'update' }],
    });

    expect(planSummary(policy)).toBe('Backup policy shop/nightly');
    expect(planAction(policy)).toBe('Update');
    expect(
      pinWarnings(testPlan({ warnings: [{ message: 'unacknowledged pin', pin: true }, { message: 'x' }] })),
    ).toHaveLength(1);
  });
});
