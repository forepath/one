import { NETWORK_KINDS, WORKLOAD_KINDS } from './plan-kinds';

describe('plan kinds', () => {
  it('runs the workload planner for policy-only plans (egress steering warnings / refusals)', () => {
    expect(WORKLOAD_KINDS.has('Policy')).toBe(true);
    expect(WORKLOAD_KINDS.has('WorkloadGroup')).toBe(true);
  });

  it('every workload kind except NodeImport also recompiles the network', () => {
    expect([...WORKLOAD_KINDS].filter((k) => !NETWORK_KINDS.has(k))).toEqual(['NodeImport']);
  });
});
