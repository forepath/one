import { AuthenticationType } from '@forepath/identity/backend';
import { UpdatesRedisStore, resolveUpdateState, type ServiceInstanceRecord } from '@forepath/shared/backend';
import { shouldRunApiHttp } from '@forepath/shared/backend/util-queue';
import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import axios from 'axios';

import { ClientsRepository } from '../repositories/clients.repository';
import { getClientEndpointTlsPolicy, validateClientEndpointWithDnsOrThrow } from '../utils/client-endpoint-security';
import { buildClientProxyRequestHeaders } from '../utils/client-proxy-request-headers';

type InstanceStatusResponse = Pick<
  ServiceInstanceRecord,
  'instanceId' | 'serviceName' | 'role' | 'hostname' | 'installedVersion' | 'dependencies'
> & {
  startedAt?: string;
  uptimeSeconds?: number;
};

/** Keep scraped manager rows alive under the same TTL window as controller heartbeats. */
const SCRAPE_INTERVAL_MS = 60_000;

@Injectable()
export class AgentManagerInstanceScrapeService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(AgentManagerInstanceScrapeService.name);
  private intervalHandle: NodeJS.Timeout | undefined;

  constructor(
    private readonly clientsRepository: ClientsRepository,
    private readonly updatesRedisStore: UpdatesRedisStore,
  ) {}

  onModuleInit(): void {
    // Only the HTTP API (or all-in-one) role scrapes; workers/schedulers skip to avoid duplicate load.
    if (!shouldRunApiHttp()) {
      return;
    }

    void this.refreshRemoteInstances();
    this.intervalHandle = setInterval(() => {
      void this.refreshRemoteInstances();
    }, SCRAPE_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = undefined;
    }
  }

  async refreshRemoteInstances(): Promise<void> {
    const clients = await this.clientsRepository.findAll(1000, 0);
    const tlsPolicy = getClientEndpointTlsPolicy(this.logger);

    await Promise.all(
      clients.map(async (client) => {
        if (!client.endpoint?.trim()) {
          return;
        }

        if (client.authenticationType !== AuthenticationType.API_KEY || !client.apiKey) {
          this.logger.debug(`Skipping instance scrape for client ${client.id}: authentication is not API key`);

          return;
        }

        try {
          await validateClientEndpointWithDnsOrThrow(client.endpoint);
          const authHeader = `Bearer ${client.apiKey}`;
          const baseUrl = client.endpoint.replace(/\/$/, '');
          const url = `${baseUrl}/api/instance-status`;
          const response = await axios.get<InstanceStatusResponse>(url, {
            headers: buildClientProxyRequestHeaders({}, authHeader),
            validateStatus: (status) => status < 500,
            timeout: process.env.REQUEST_TIMEOUT ? parseInt(process.env.REQUEST_TIMEOUT, 10) : 30_000,
            httpsAgent: baseUrl.startsWith('https://')
              ? // eslint-disable-next-line @typescript-eslint/no-var-requires
                new (require('https').Agent)({
                  rejectUnauthorized: tlsPolicy.rejectUnauthorized,
                })
              : undefined,
          });

          if (response.status >= 400 || !response.data?.instanceId) {
            this.logger.warn(`Skipping instance scrape for client ${client.id}: HTTP ${response.status}`);

            return;
          }

          const release = await this.updatesRedisStore.getRelease();
          const record: ServiceInstanceRecord = {
            instanceId: response.data.instanceId,
            serviceName: response.data.serviceName,
            role: response.data.role,
            hostname: response.data.hostname,
            installedVersion: response.data.installedVersion,
            updateState: resolveUpdateState(response.data.installedVersion, release?.tagName ?? null),
            lastHeartbeatAt: new Date().toISOString(),
            dependencies: response.data.dependencies,
          };

          await this.updatesRedisStore.upsertInstance(record);
        } catch (error) {
          this.logger.warn(`Instance scrape failed for client ${client.id}: ${(error as Error).message}`);
        }
      }),
    );
  }
}
