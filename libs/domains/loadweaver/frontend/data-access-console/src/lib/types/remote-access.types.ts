/** Remote access (3.31): `GET /vpn/devices[?all=true]`, `DELETE /vpn/devices/{id}`. */

export type VpnClientStatus = 'active' | 'expired' | 'revoked';

/** `VpnClientSummary`: a user device or a machine / office client. */
export interface VpnClient {
  id: string;
  kind: 'user' | 'machine';
  name: string;
  owner: string;
  address: string;
  subnets: string[];
  groups: string[];
  /** Groups after posture (failing ones replaced by their restricted group). */
  effectiveGroups: string[];
  /** Why the device is restricted, per failing group. */
  restrictions: Record<string, string[]>;
  status: VpnClientStatus;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastHandshakeAt: string | null;
  lastEndpoint: string | null;
}
