import { CloudflareDnsProvider } from '@forepath/shared/backend/util-hosting-providers';
import { Injectable, Logger } from '@nestjs/common';
import { AxiosError } from 'axios';

import { isValidSubdomainHostname } from '../utils/hostname-generator.utils';

/**
 * Cloudflare DNS for provisioned servers: create and delete A records. Uses single-level subdomains only (e.g.
 * awesome-armadillo-abc12.spirde.com) for SSL. Talks to Cloudflare through the shared DNS provider lib.
 */
@Injectable()
export class CloudflareDnsService {
  private readonly logger = new Logger(CloudflareDnsService.name);
  private readonly apiToken: string;
  private readonly zoneId: string;
  private readonly baseDomain: string;

  constructor() {
    this.apiToken = process.env.CLOUDFLARE_API_TOKEN ?? '';
    this.zoneId = process.env.CLOUDFLARE_ZONE_ID ?? '';
    this.baseDomain = process.env.DNS_BASE_DOMAIN ?? 'spirde.com';

    if (!this.apiToken || !this.zoneId) {
      this.logger.warn(
        'CLOUDFLARE_API_TOKEN or CLOUDFLARE_ZONE_ID not set. DNS record creation/removal will be skipped.',
      );
    }
  }

  isConfigured(): boolean {
    return Boolean(this.apiToken && this.zoneId);
  }

  private provider(): CloudflareDnsProvider {
    return new CloudflareDnsProvider({ apiToken: this.apiToken });
  }

  /**
   * Creates an A record: subdomain.baseDomain -> ip.
   * @param subdomain - Single-level hostname (no dots), e.g. awesome-armadillo-abc12
   * @param ip - IPv4 address for the A record
   */
  async createARecord(subdomain: string, ip: string): Promise<void> {
    if (!isValidSubdomainHostname(subdomain)) {
      this.logger.warn(`Invalid subdomain hostname (no dots allowed): ${subdomain}`);

      return;
    }

    if (!this.isConfigured()) {
      this.logger.warn('Cloudflare DNS not configured, skipping A record creation');

      return;
    }

    const name = this.getFqdn(subdomain);

    try {
      // TTL 1 = Cloudflare's automatic TTL.
      await this.provider().upsertRecord(this.zoneId, { type: 'A', name, content: ip, ttl: 1, proxied: false });
      this.logger.log(`Created DNS A record ${this.getFqdn(subdomain)} -> ${ip}`);
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to create DNS A record for ${this.getFqdn(subdomain)}: ${axiosError.message}`);
      throw error;
    }
  }

  /**
   * Deletes the A record for the given subdomain.
   * Looks up the record by name (subdomain) and type A, then deletes it.
   */
  async deleteRecord(subdomain: string): Promise<void> {
    if (!isValidSubdomainHostname(subdomain)) {
      this.logger.warn(`Invalid subdomain hostname: ${subdomain}`);

      return;
    }

    if (!this.isConfigured()) {
      this.logger.warn('Cloudflare DNS not configured, skipping DNS record deletion');

      return;
    }

    try {
      const provider = this.provider();
      const records = await provider.listRecords(this.zoneId, { type: 'A', name: this.getFqdn(subdomain) });

      for (const record of records) {
        if (!record.id) continue;

        await provider.deleteRecord(this.zoneId, record.id);
        this.logger.log(`Deleted DNS A record ${record.name}`);
      }

      if (records.length === 0) {
        this.logger.debug(`No DNS A record found for ${this.getFqdn(subdomain)}`);
      }
    } catch (error) {
      const axiosError = error as AxiosError;

      this.logger.error(`Failed to delete DNS record for ${this.getFqdn(subdomain)}: ${axiosError.message}`);
      throw error;
    }
  }

  getFqdn(subdomain: string): string {
    return `${subdomain}.${this.baseDomain}`;
  }
}
