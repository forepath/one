import * as dns from 'node:dns';
import { promises as dnsPromises, type LookupAddress, type LookupOptions } from 'node:dns';
import * as net from 'node:net';

import {
  isDevSelfHost,
  isPrivateOrLoopbackHost,
  isPrivateOrLoopbackIp,
  parseAllowedHosts,
} from '@forepath/shared/shared/util-network-address';
import { BadRequestException } from '@nestjs/common';

/**
 * SSRF guardrails for cluster endpoints (3.24), modelled on Agenstra's `CLIENT_ENDPOINT_*` settings:
 *
 * - HTTPS only; `FLEET_CLUSTER_ENDPOINT_ALLOW_INSECURE_HTTP=true` allows http outside production (local labs).
 * - No credentials, query or fragment in the URL; an optional base path is kept, a trailing `/api` is dropped.
 * - Optional host allowlist `FLEET_CLUSTER_ENDPOINT_ALLOWED_HOSTS` (comma-separated or `*`), required in production.
 * - Private / loopback hostnames, literal IPs and DNS answers are refused unless
 *   `FLEET_CLUSTER_ENDPOINT_ALLOW_INTERNAL_HOST=true` (fleet and clusters in one private network).
 */
function flag(name: string): boolean {
  return process.env[name]?.trim().toLowerCase() === 'true';
}

export function allowInternalClusterHosts(): boolean {
  return flag('FLEET_CLUSTER_ENDPOINT_ALLOW_INTERNAL_HOST');
}

export interface NormalizedClusterEndpoint {
  /** Origin + base path without trailing slash, e.g. `https://lw.example.com` or `https://x.example.com/lw`. */
  endpoint: string;
  hostname: string;
}

export function normalizeClusterEndpoint(raw: string): NormalizedClusterEndpoint {
  let url: URL;

  try {
    url = new URL(raw.trim());
  } catch {
    throw new BadRequestException('Cluster endpoint must be a valid URL');
  }

  if (url.username || url.password) throw new BadRequestException('Cluster endpoint must not contain credentials');

  if (url.search || url.hash) throw new BadRequestException('Cluster endpoint must not contain a query or fragment');

  const insecure = flag('FLEET_CLUSTER_ENDPOINT_ALLOW_INSECURE_HTTP') && process.env['NODE_ENV'] !== 'production';

  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && insecure))
    throw new BadRequestException('Cluster endpoint must use https');

  const hostname = url.hostname
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');

  if (!hostname) throw new BadRequestException('Cluster endpoint hostname is required');

  const allowed = parseAllowedHosts(process.env['FLEET_CLUSTER_ENDPOINT_ALLOWED_HOSTS']);

  if (allowed.length > 0 && !allowed.includes('*') && !allowed.includes(hostname))
    throw new BadRequestException('Cluster endpoint host is not in the allowlist');

  if (!allowInternalClusterHosts()) {
    if (net.isIP(hostname) ? isPrivateOrLoopbackIp(hostname) : isPrivateOrLoopbackHost(hostname))
      throw new BadRequestException('Cluster endpoint must not target private or loopback hosts');
  }

  const path = url.pathname.replace(/\/+$/, '').replace(/\/api$/, '');

  if (path.split('/').some((s) => s === '..' || s === '.'))
    throw new BadRequestException('Cluster endpoint path is invalid');

  return { endpoint: `${url.protocol}//${url.host}${path}`, hostname };
}

/** DNS rebinding defence: every address the hostname resolves to must be public (unless internal hosts are allowed). */
export async function assertClusterHostResolvesPublic(hostname: string): Promise<void> {
  if (allowInternalClusterHosts() || process.env['NODE_ENV'] === 'test' || net.isIP(hostname)) return;

  if (isDevSelfHost(hostname)) return;

  let results: { address: string }[];

  try {
    results = await dnsPromises.lookup(hostname, { all: true, verbatim: true });
  } catch (error) {
    throw new BadRequestException(
      `Cluster endpoint hostname could not be resolved: ${error instanceof Error ? error.message : error}`,
    );
  }

  if (results.some((r) => isPrivateOrLoopbackIp(r.address)))
    throw new BadRequestException('Cluster endpoint hostname resolves to a private or loopback address');
}

/** True when the addresses a hostname resolved to may be connected to under the SSRF rules. */
export function resolvedAddressesAllowed(
  hostname: string,
  addresses: readonly { address: string }[],
  allowInternal = allowInternalClusterHosts(),
): boolean {
  if (allowInternal || isDevSelfHost(hostname)) return true;

  return addresses.length > 0 && !addresses.some((a) => isPrivateOrLoopbackIp(a.address));
}

type LookupCallback = (error: NodeJS.ErrnoException | null, address: string | LookupAddress[], family?: number) => void;
type LookupFunction = (hostname: string, options: LookupOptions, callback: LookupCallback) => void;

/**
 * `lookup` for the agents towards clusters (HTTP and sockets): the addresses a connection actually uses are
 * resolved and validated in one step, so a DNS answer that changes between a check and the connect (rebinding)
 * can't reach private / loopback addresses. Literal IPs skip `lookup` and are validated by
 * {@link normalizeClusterEndpoint}.
 */
export function createGuardedLookup(
  resolve: typeof dns.lookup = dns.lookup,
  allowInternal: () => boolean = allowInternalClusterHosts,
): LookupFunction {
  return (hostname, options, callback) => {
    resolve(hostname, { ...options, all: true }, (error, addresses: LookupAddress[]) => {
      if (error) {
        callback(error, []);

        return;
      }

      if (!resolvedAddressesAllowed(hostname, addresses, allowInternal())) {
        const refused = new Error(
          `Cluster endpoint ${hostname} resolves to a private or loopback address`,
        ) as NodeJS.ErrnoException;

        refused.code = 'EFLEETPRIVATEADDRESS';
        callback(refused, []);

        return;
      }

      if (options.all) callback(null, addresses);
      else callback(null, addresses[0].address, addresses[0].family);
    });
  };
}

/**
 * Early, friendlier refusal at registration / change. Not the security boundary — that is
 * {@link createGuardedLookup} on every connection.
 */
export async function validateClusterEndpoint(raw: string): Promise<NormalizedClusterEndpoint> {
  const normalized = normalizeClusterEndpoint(raw);

  await assertClusterHostResolvesPublic(normalized.hostname);

  return normalized;
}

/** TLS verification can only be disabled outside production (`FLEET_CLUSTER_TLS_REJECT_UNAUTHORIZED=false`). */
export function clusterTlsRejectUnauthorized(): boolean {
  if (process.env['FLEET_CLUSTER_TLS_REJECT_UNAUTHORIZED']?.trim().toLowerCase() !== 'false') return true;

  if (process.env['NODE_ENV'] === 'production')
    throw new Error('FLEET_CLUSTER_TLS_REJECT_UNAUTHORIZED=false is not allowed in production');

  return false;
}

/** Exits in production without an endpoint allowlist (SSRF hard requirement, like Agenstra's controller). */
export function assertProductionClusterEndpointAllowlist(logger?: { error(message: string): void }): void {
  if (process.env['NODE_ENV'] !== 'production' || process.env['FLEET_CLUSTER_ENDPOINT_ALLOWED_HOSTS']?.trim()) return;

  const message =
    'FATAL: FLEET_CLUSTER_ENDPOINT_ALLOWED_HOSTS must be set in production for the fleet service. Exiting.';

  logger?.error(message);
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

const PEM_CERTIFICATE = /^-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----$/;

/** A PEM bundle of certificates only (no keys), at most 64 KiB. */
export function normalizeCaCertificate(raw: string | null | undefined): string | null {
  const trimmed = raw?.trim();

  if (!trimmed) return null;

  if (trimmed.length > 65_536) throw new BadRequestException('CA bundle too large');

  const blocks = trimmed.split(/(?<=-----END CERTIFICATE-----)\s*/).filter(Boolean);

  if (!blocks.length || blocks.some((b) => !PEM_CERTIFICATE.test(b.trim())))
    throw new BadRequestException('CA must be PEM certificates');

  return blocks.map((b) => b.trim()).join('\n');
}
