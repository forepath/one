import { createHash } from 'node:crypto';

import type { DnsZoneSpec } from '@forepath/loadweaver/shared/util-model';

import type { DesiredRecord } from './dns-desired.utils';

export interface NameServer {
  /** e.g. `ns1.example.com` */
  name: string;
  addresses: string[];
}

function absolute(name: string): string {
  return name.endsWith('.') ? name : `${name}.`;
}

/** TXT data as quoted 255-byte strings (RFC 1035), quotes and backslashes escaped. */
export function txtData(value: string): string {
  const chunks: string[] = [];

  for (let i = 0; i < value.length; i += 255) chunks.push(value.slice(i, i + 255));

  return chunks.map((c) => `"${c.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`).join(' ');
}

function rdata(record: DesiredRecord, value: string): string {
  switch (record.type) {
    case 'TXT':
      return txtData(value);
    case 'CNAME':
    case 'NS':
    case 'PTR':
      return absolute(value);
    case 'MX':
      return `${record.priority ?? 10} ${absolute(value)}`;
    case 'SRV': {
      const [weight, port, target] = value.split(' ');

      return `${record.priority ?? 0} ${weight} ${port} ${absolute(target)}`;
    }
    default:
      return value;
  }
}

/** Zone content without the serial, to decide whether a new serial is due. */
export function zoneBody(
  zone: DnsZoneSpec,
  records: readonly DesiredRecord[],
  nameServers: readonly NameServer[],
): string {
  const origin = absolute(zone.zone);
  const declaresNs = records.some((r) => r.type === 'NS' && r.fqdn === zone.zone);
  const lines: string[] = [];

  if (!declaresNs) {
    for (const ns of nameServers) {
      lines.push(`${origin} ${zone.defaultTtl} IN NS ${absolute(ns.name)}`);

      // Glue for name servers inside the zone.
      if (ns.name === zone.zone || ns.name.endsWith(`.${zone.zone}`)) {
        for (const address of ns.addresses)
          lines.push(`${absolute(ns.name)} ${zone.defaultTtl} IN ${address.includes(':') ? 'AAAA' : 'A'} ${address}`);
      }
    }
  }

  for (const record of records) {
    for (const value of record.values)
      lines.push(`${absolute(record.fqdn)} ${record.ttl} IN ${record.type} ${rdata(record, value)}`);
  }

  return lines.join('\n');
}

export function zoneHash(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}

/** The zone file bind9 serves: SOA with the given serial, then the body. */
export function renderZoneFile(zone: DnsZoneSpec, body: string, serial: number, primaryNameServer: string): string {
  const origin = absolute(zone.zone);

  return [
    `; Managed by Loadweaver. Changes are overwritten.`,
    `$ORIGIN ${origin}`,
    `$TTL ${zone.defaultTtl}`,
    `${origin} ${zone.defaultTtl} IN SOA ${absolute(primaryNameServer)} hostmaster.${origin} ${serial} 3600 600 1209600 ${Math.min(zone.defaultTtl, 3600)}`,
    body,
    '',
  ].join('\n');
}

/** Next serial: strictly increasing, based on the time so it also increases across control-plane restores. */
export function nextSerial(previous: number | undefined, now: Date): number {
  return Math.max((previous ?? 0) + 1, Math.floor(now.getTime() / 1000));
}
