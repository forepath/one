import type { ConsoleNode } from '@forepath/loadweaver/frontend/data-access-console';

import {
  actionConfirmMessage,
  actionDangerous,
  formatCores,
  lifecycleLabel,
  nodeActions,
  nodeTone,
  parseLabels,
  usagePercent,
} from './node-format';

const node = (overrides: Partial<ConsoleNode> = {}) =>
  ({ name: 'n1', lifecycle: 'active', connected: true, applyStatus: 'applied', ...overrides }) as ConsoleNode;

describe('node format', () => {
  it('offers the actions of the lifecycle to operators only', () => {
    expect(nodeActions(node(), 'infra-operator')).toEqual(['cordon', 'drain']);
    expect(nodeActions(node({ lifecycle: 'cordoned' }), 'infra-operator')).toEqual(['uncordon', 'drain']);
    expect(nodeActions(node({ lifecycle: 'draining' }), 'cluster-admin')).toEqual(['uncordon', 'leave']);
    expect(nodeActions(node({ lifecycle: 'left' }), 'cluster-admin')).toEqual([]);
    expect(nodeActions(node({ connected: false }), 'cluster-admin')).toEqual(['cordon', 'drain', 'confirm-lost']);
    expect(nodeActions(node({ connected: false }), 'infra-operator')).toEqual(['cordon', 'drain']);
    expect(nodeActions(node(), 'auditor')).toEqual([]);
    expect(nodeActions(node(), null)).toEqual([]);
  });

  it('describes nodes and actions', () => {
    expect(nodeTone(node())).toBe('success');
    expect(nodeTone(node({ connected: false }))).toBe('danger');
    expect(nodeTone(node({ applyStatus: 'failed' }))).toBe('warning');
    expect(nodeTone(node({ lifecycle: 'left', connected: false }))).toBe('secondary');
    expect(lifecycleLabel('draining')).toBe('Draining');
    expect(actionDangerous('leave')).toBe(true);
    expect(actionDangerous('drain')).toBe(false);
    expect(actionConfirmMessage('cordon', 'n1')).toContain('n1');
  });

  it('formats capacity and parses labels', () => {
    expect(formatCores(2500)).toBe('2.5');
    expect(usagePercent(1, 4)).toBe(25);
    expect(usagePercent(5, 4)).toBe(100);
    expect(usagePercent(undefined, 4)).toBeNull();
    expect(usagePercent(1, 0)).toBeNull();
    expect(parseLabels('role=edge, zone = a\nbad, =x')).toEqual({ role: 'edge', zone: 'a' });
  });
});
