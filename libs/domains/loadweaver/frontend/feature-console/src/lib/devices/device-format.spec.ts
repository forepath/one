import type { VpnClient } from '@forepath/loadweaver/frontend/data-access-console';

import { enrollCommand, isConnected, mayManageAllDevices, restrictionLines } from './device-format';

const device = (overrides: Partial<VpnClient> = {}): VpnClient =>
  ({ status: 'active', restrictions: {}, lastHandshakeAt: null, ...overrides }) as VpnClient;

describe('device format', () => {
  it('builds the enroll command with a valid name only', () => {
    expect(enrollCommand('laptop-1')).toBe('loadweaver vpn enroll --name laptop-1');
    expect(enrollCommand('My Laptop')).toBe('loadweaver vpn enroll --name <device>');
    expect(enrollCommand('')).toBe('loadweaver vpn enroll --name <device>');
  });

  it('derives posture and connection', () => {
    const now = Date.parse('2026-10-01T10:05:00.000Z');

    expect(restrictionLines(device({ restrictions: { staff: ['firewall off', 'no screen lock'] } }))).toEqual([
      'staff: firewall off, no screen lock',
    ]);
    expect(isConnected(device({ lastHandshakeAt: '2026-10-01T10:04:00.000Z' }), now)).toBe(true);
    expect(isConnected(device({ lastHandshakeAt: '2026-10-01T09:00:00.000Z' }), now)).toBe(false);
    expect(isConnected(device({ status: 'revoked', lastHandshakeAt: '2026-10-01T10:04:00.000Z' }), now)).toBe(false);
    expect(mayManageAllDevices('infra-operator')).toBe(true);
    expect(mayManageAllDevices('auditor')).toBe(false);
  });
});
