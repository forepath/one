/**
 * Provider-agnostic server information for status checks and display.
 * Structured so it can be implemented by any provisioning provider
 * (e.g. Hetzner, DigitalOcean) with a common response shape.
 */
export interface ServerInfo {
  /** Provider-specific server/resource ID */
  serverId: string;
  /** Server name or label in the provider console */
  name: string;
  /** Public IP address (empty string if not yet assigned) */
  publicIp: string;
  /** Private IP address, if applicable */
  privateIp?: string;
  /** Provider status (e.g. 'running', 'starting', 'stopped', 'off') */
  status: string;
  /** Optional provider-specific metadata (e.g. location, datacenter, region) */
  metadata?: Record<string, unknown>;
  /** Single-level subdomain (e.g. awesome-armadillo-abc12) when DNS is provisioned */
  hostname?: string;
  /** Full DNS name (e.g. awesome-armadillo-abc12.spirde.com) for display */
  hostnameFqdn?: string;
}
