/** Ids of the env-configured integrations `GET /integrations` reports (3.41); the console translates by id. */
export type IntegrationEnvId = 'smtp' | 'otlp' | 'geoip' | 'releases' | 'postureSync' | 'kms' | 'auth' | 'plugins';

/** An env-configured integration (3.41): read-only, which is active and its non-secret settings. */
export interface IntegrationEnvStatus {
  id: IntegrationEnvId | string;
  /** Plain English fallback label. */
  label: string;
  active: boolean;
  details: Record<string, string>;
}

/** What `POST /integrations/test` can check (3.41); `SiemTarget` = `Cluster.spec.observability.siem[].name`. */
export type IntegrationTestTarget = 'DnsProvider' | 'BackupTarget' | 'IpPool' | 'SiemTarget';

/** A connection test of the applied configuration; a failed test is `ok: false`, never an HTTP error. */
export interface IntegrationTestResult {
  ok: boolean;
  message: string;
  details?: Record<string, string>;
  durationMs: number;
}
