/**
 * Provisioning provider interface for implementing different cloud provider solutions.
 * This interface allows the system to support multiple cloud providers
 * (e.g., Hetzner, AWS, Azure, etc.) through a unified API.
 */
export interface ProvisioningProvider {
  /**
   * Get the unique type identifier for this provider.
   * This is used to identify which provider to use for provisioning.
   * @returns The provider type string (e.g., 'hetzner', 'aws', 'azure')
   */
  getType(): string;

  /**
   * Get the human-readable display name for this provider.
   * This is used in UI components to show a friendly name to users.
   * @returns The display name string (e.g., 'Hetzner Cloud', 'AWS EC2', 'Azure VM')
   */
  getDisplayName(): string;

  /**
   * Get available server types from the provider.
   * @returns Array of server types with their specifications and pricing
   */
  getServerTypes(): Promise<ServerType[]>;

  /**
   * Provision a new server instance.
   * @param options - Provisioning options including server type, name, etc.
   * @returns Provisioned server information including ID, IP address, and endpoint
   */
  provisionServer(options: ProvisionServerOptions): Promise<ProvisionedServer>;

  /**
   * Delete a provisioned server instance.
   * @param serverId - The provider-specific server ID
   * @returns Promise that resolves when server is deleted
   */
  deleteServer(serverId: string): Promise<void>;

  /**
   * Get server status and information.
   * @param serverId - The provider-specific server ID
   * @returns Server information including status, IP address, etc.
   */
  getServerInfo(serverId: string): Promise<ServerInfo>;
}

/**
 * Server type information with specifications and pricing.
 */
export interface ServerType {
  /**
   * Unique identifier for the server type (e.g., 'cx11', 'cpx11')
   */
  id: string;

  /**
   * Human-readable name (e.g., 'CX11', 'CPX11')
   */
  name: string;

  /**
   * Number of CPU cores
   */
  cores: number;

  /**
   * Amount of RAM in GB
   */
  memory: number;

  /**
   * Disk size in GB
   */
  disk: number;

  /**
   * Price per month in EUR (or provider's currency)
   */
  priceMonthly?: number;

  /**
   * Price per hour in EUR (or provider's currency)
   */
  priceHourly?: number;

  /**
   * Additional description or notes
   */
  description?: string;
}

/**
 * Options for provisioning a server.
 */
export interface ProvisionServerOptions {
  /**
   * Server type identifier (e.g., 'cx11', 'cpx11')
   */
  serverType: string;

  /**
   * Server name/label
   */
  name: string;

  /**
   * Optional description
   */
  description?: string;

  /**
   * Location/datacenter identifier (e.g., 'nbg1', 'fsn1')
   */
  location?: string;

  /**
   * SSH public key for server access
   */
  sshKey?: string;

  /**
   * Image/OS identifier (e.g., 'ubuntu-22.04')
   */
  image?: string;

  /**
   * User data script for initial server configuration
   */
  userData?: string;
}

/**
 * Information about a provisioned server.
 */
export interface ProvisionedServer {
  /**
   * Provider-specific server ID
   */
  serverId: string;

  /**
   * Server name
   */
  name: string;

  /**
   * Public IP address
   */
  publicIp: string;

  /**
   * Private IP address (if applicable)
   */
  privateIp?: string;

  /**
   * Server endpoint URL (e.g., 'https://1.2.3.4:3100')
   */
  endpoint: string;

  /**
   * Server status (e.g., 'running', 'starting', 'stopped')
   */
  status: string;

  /**
   * Additional metadata
   */
  metadata?: Record<string, unknown>;
}

/**
 * Server information for status checks.
 */
export interface ServerInfo {
  /**
   * Provider-specific server ID
   */
  serverId: string;

  /**
   * Server name
   */
  name: string;

  /**
   * Public IP address
   */
  publicIp: string;

  /**
   * Private IP address (if applicable)
   */
  privateIp?: string;

  /**
   * Server status (e.g., 'running', 'starting', 'stopped')
   */
  status: string;

  /**
   * Additional metadata
   */
  metadata?: Record<string, unknown>;
}
