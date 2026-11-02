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
  /** Posture facts (3.31); absent from older control planes. */
  posture?: VpnClientPosture;
  status: VpnClientStatus;
  createdAt: string;
  expiresAt: string;
  revokedAt: string | null;
  lastHandshakeAt: string | null;
  lastEndpoint: string | null;
}

export type PostureCategory = 'mdm' | 'edr';
export type PostureStatus = 'compliant' | 'non-compliant' | 'unknown';
export type PostureRisk = 'low' | 'medium' | 'high';
export type PostureMatchKey = 'serial' | 'deviceId' | 'hostname';

/** What an MDM / EDR integration said about a device at its last sync. */
export interface PostureIntegrationFact {
  integration: string;
  type: string;
  category: PostureCategory;
  status: PostureStatus;
  risk?: PostureRisk;
  reasons: string[];
  checkedAt: string;
  staleAt: string;
  matchedBy?: PostureMatchKey;
}

export interface PostureCertificateFact {
  source: 'company' | 'loadweaver';
  valid: boolean;
  revoked: boolean;
  serialNumber?: string;
  notAfter?: string;
  reasons: string[];
  checkedAt: string;
}

/** `VpnClientPosture`: the last report, integration results and the device certificate. */
export interface VpnClientPosture {
  reportedAt: string | null;
  platform: string | null;
  osVersion: string | null;
  appVersion: string | null;
  diskEncryption: boolean | null;
  firewall: boolean | null;
  screenLock: boolean | null;
  serialNumber: string | null;
  hostname: string | null;
  integrations: PostureIntegrationFact[];
  certificate: PostureCertificateFact | null;
}

/** `PosturePluginInfo` (`GET /posture/plugins`). */
export interface PosturePluginField {
  key: string;
  label: string;
  secret?: boolean;
  required?: boolean;
  options?: string[];
  default?: string;
  description?: string;
}

export interface PosturePluginInfo {
  id: string;
  displayName: string;
  category: PostureCategory;
  fields: PosturePluginField[];
  /** Never contains `hostname` (self-reported; opt-in per integration with a warning). */
  defaultMatchBy: PostureMatchKey[];
  /** Vendor records carry the device user: integrations require it to match the client owner by default. */
  supportsUserMatch?: boolean;
}

/** `PostureIntegration` (`/posture/integrations`); secrets are never returned. */
export interface PostureIntegration {
  id: string;
  name: string;
  type: string;
  displayName: string;
  category: PostureCategory;
  enabled: boolean;
  config: Record<string, string>;
  secretsSet: string[];
  matchBy: PostureMatchKey[];
  requireUserMatch?: boolean;
  /** Weak matching settings (English, from the API). */
  warnings?: string[];
  intervalMinutes: number;
  maxAgeMinutes: number;
  status: 'ok' | 'failing' | 'pending' | 'disabled';
  lastSyncAt: string | null;
  lastSuccessAt: string | null;
  lastError: string | null;
  failures: number;
  nextSyncAt: string | null;
  vendorDevices: number;
  matchedDevices: number;
}

export interface PostureIntegrationInput {
  name?: string;
  type?: string;
  enabled?: boolean;
  config?: Record<string, string>;
  matchBy?: PostureMatchKey[];
  requireUserMatch?: boolean;
  intervalMinutes?: number;
  maxAgeMinutes?: number;
}

export interface PostureTestResult {
  ok: boolean;
  message: string;
}

export interface CertificateTrustSettings {
  companyCaPem: string | null;
  crlPem: string | null;
  trustClusterCa: boolean;
  requireProof: boolean;
  companyCaSubjects: string[];
  updatedAt: string | null;
}
