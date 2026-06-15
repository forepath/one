import { ClientResponseDto } from './client-response.dto';

/**
 * DTO for provisioned server response.
 * Includes client information and server provisioning details.
 */
export interface ProvisionedServerResponseDto extends ClientResponseDto {
  /**
   * Provider type used for provisioning (e.g., 'hetzner')
   */
  providerType: string;

  /**
   * Provider-specific server ID
   */
  serverId: string;

  /**
   * Server name
   */
  serverName: string;

  /**
   * Public IP address of the server
   */
  publicIp: string;

  /**
   * Private IP address of the server (if applicable)
   */
  privateIp?: string;

  /**
   * Server status (e.g., 'running', 'starting')
   */
  serverStatus: string;
}
