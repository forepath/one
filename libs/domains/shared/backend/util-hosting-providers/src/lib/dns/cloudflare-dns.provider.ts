import axios from 'axios';

import type {
  DnsProvider,
  DnsProviderCapabilities,
  DnsProviderFactory,
  DnsRecord,
  DnsRecordType,
  DnsZone,
} from './dns-provider.types';

const API = 'https://api.cloudflare.com/client/v4';
const PAGE_SIZE = 500;
/** Cloudflare's TTL value for "automatic". */
const AUTOMATIC_TTL = 1;

interface CloudflareRecord {
  id: string;
  type: string;
  name: string;
  content: string;
  ttl: number;
  priority?: number;
  proxied?: boolean;
}

export interface CloudflareDnsConfig {
  apiToken: string;
}

/** Cloudflare DNS (3.15); the implementation Decabill used for server hostnames, now shared. */
export class CloudflareDnsProvider implements DnsProvider {
  readonly id = 'cloudflare';
  readonly capabilities: DnsProviderCapabilities = {
    minTtl: 60,
    wildcard: true,
    proxied: true,
    dnssec: true,
    createZones: false,
  };

  constructor(private readonly config: CloudflareDnsConfig) {
    if (!config.apiToken) throw new Error('Cloudflare needs an API token');
  }

  private get headers(): Record<string, string> {
    return { Authorization: `Bearer ${this.config.apiToken}`, 'Content-Type': 'application/json' };
  }

  private async pages<T>(path: string): Promise<T[]> {
    const all: T[] = [];

    for (let page = 1; ; page++) {
      const separator = path.includes('?') ? '&' : '?';
      const res = await axios.get<{ result: T[]; result_info?: { total_pages?: number } }>(
        `${API}${path}${separator}per_page=${PAGE_SIZE}&page=${page}`,
        { headers: this.headers },
      );

      all.push(...(res.data?.result ?? []));

      if (page >= (res.data?.result_info?.total_pages ?? 1)) return all;
    }
  }

  async listZones(): Promise<DnsZone[]> {
    return (await this.pages<{ id: string; name: string }>('/zones')).map((z) => ({ id: z.id, name: z.name }));
  }

  async listRecords(zoneId: string, filter: { name?: string; type?: DnsRecordType } = {}): Promise<DnsRecord[]> {
    const query = [
      filter.type ? `type=${filter.type}` : '',
      filter.name ? `name=${encodeURIComponent(filter.name)}` : '',
    ]
      .filter(Boolean)
      .join('&');
    const records = await this.pages<CloudflareRecord>(
      `/zones/${encodeURIComponent(zoneId)}/dns_records${query ? `?${query}` : ''}`,
    );

    return records.map((r) => ({
      id: r.id,
      name: r.name,
      type: r.type as DnsRecordType,
      content: r.content,
      ttl: r.ttl,
      ...(r.priority !== undefined ? { priority: r.priority } : {}),
      ...(r.proxied !== undefined ? { proxied: r.proxied } : {}),
    }));
  }

  async upsertRecord(zoneId: string, record: DnsRecord): Promise<DnsRecord> {
    const body = {
      type: record.type,
      name: record.name,
      content: record.content,
      // Proxied records always use automatic TTL on Cloudflare.
      ttl: record.proxied
        ? AUTOMATIC_TTL
        : record.ttl <= AUTOMATIC_TTL
          ? AUTOMATIC_TTL
          : Math.max(record.ttl, this.capabilities.minTtl),
      proxied: record.proxied ?? false,
      ...(record.priority !== undefined ? { priority: record.priority } : {}),
    };
    const url = `${API}/zones/${encodeURIComponent(zoneId)}/dns_records`;
    const res = record.id
      ? await axios.put<{ result: CloudflareRecord }>(`${url}/${encodeURIComponent(record.id)}`, body, {
          headers: this.headers,
        })
      : await axios.post<{ result: CloudflareRecord }>(url, body, { headers: this.headers });

    return { ...record, id: res.data?.result?.id ?? record.id };
  }

  async deleteRecord(zoneId: string, recordId: string): Promise<void> {
    await axios.delete(`${API}/zones/${encodeURIComponent(zoneId)}/dns_records/${encodeURIComponent(recordId)}`, {
      headers: { Authorization: `Bearer ${this.config.apiToken}` },
    });
  }
}

export const cloudflareDnsProviderFactory: DnsProviderFactory<CloudflareDnsConfig> = {
  id: 'cloudflare',
  displayName: 'Cloudflare',
  create: (config) => new CloudflareDnsProvider(config),
};
