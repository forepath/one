import type { ClusterRole, VpnClient } from '@forepath/loadweaver/frontend/data-access-console';

/** Device names: lowercase letters, digits and dashes (like the API). */
export const DEVICE_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?$/;

/** A handshake this recent counts as connected (WireGuard re-handshakes every two minutes while traffic flows). */
export const CONNECTED_WITHIN_MS = 3 * 60_000;

/** Infra operators and cluster admins see and revoke every client. */
export function mayManageAllDevices(role: ClusterRole | null | undefined): boolean {
  return role === 'cluster-admin' || role === 'infra-operator';
}

/** The CLI line that enrolls the machine it runs on (the key pair is generated there). */
export function enrollCommand(name: string): string {
  const device = name.trim();

  return `loadweaver vpn enroll --name ${device && DEVICE_NAME_PATTERN.test(device) ? device : '<device>'}`;
}

/** Tone of the device state badge (`fpc-badge [tone]`, 3.38 R10). */
export function deviceStatusTone(status: VpnClient['status']): 'success' | 'warning' | 'neutral' {
  return status === 'active' ? 'success' : status === 'expired' ? 'warning' : 'neutral';
}

export function deviceStatusLabel(status: VpnClient['status']): string {
  switch (status) {
    case 'active':
      return $localize`:@@lwConsoleDevices-active:Active`;
    case 'expired':
      return $localize`:@@lwConsoleDevices-expired:Expired`;
    default:
      return $localize`:@@lwConsoleDevices-revoked:Revoked`;
  }
}

/** Posture: failing checks replace groups by their restricted group. */
export function isRestricted(device: VpnClient): boolean {
  return Object.keys(device.restrictions).length > 0;
}

/** `group: reason, reason` per restricted group. */
export function restrictionLines(device: VpnClient): string[] {
  return Object.entries(device.restrictions)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([group, reasons]) => `${group}: ${reasons.join(', ')}`);
}

export function isConnected(device: VpnClient, now = Date.now()): boolean {
  return (
    device.status === 'active' &&
    !!device.lastHandshakeAt &&
    now - new Date(device.lastHandshakeAt).getTime() < CONNECTED_WITHIN_MS
  );
}
