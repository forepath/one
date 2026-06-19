import type { ServerInfo } from './server-info.interface';

export interface BillingServerType {
  id: string;
  name: string;
  cores: number;
  memory: number;
  disk: number;
  priceMonthly?: number;
  priceHourly?: number;
  description?: string;
}

export interface BillingProvisioningProvider {
  getType(): string;
  getDisplayName(): string;
  provision(config: Record<string, unknown>): Promise<unknown>;
  deprovision(serverId: string): Promise<void>;
  getServerInfo(serverId: string): Promise<ServerInfo | null>;
  getServerTypes(): Promise<BillingServerType[]>;
  startServer(serverId: string): Promise<void>;
  stopServer(serverId: string): Promise<void>;
  restartServer(serverId: string): Promise<void>;
}

export interface BillingProvisioningProviderDetail {
  id: string;
  displayName: string;
  configSchema?: Record<string, unknown>;
}
