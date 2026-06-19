/**
 * Server info returned by the API. Provider-specific server ID is intentionally
 * omitted (internal only); all other fields are safe for the customer.
 */
export interface ServerInfoResponseDto {
  name: string;
  publicIp: string;
  privateIp?: string;
  status: string;
  metadata?: Record<string, unknown>;
  /** Single-level subdomain when DNS is provisioned (e.g. awesome-armadillo-abc12) */
  hostname?: string;
  /** Full DNS name for display (e.g. awesome-armadillo-abc12.spirde.com) */
  hostnameFqdn?: string;
}
