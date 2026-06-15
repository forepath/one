import { promises as dnsPromises } from 'node:dns';
import * as net from 'node:net';

import {
  isDevSelfHost,
  isPrivateOrLoopbackHost,
  isPrivateOrLoopbackIp,
  parseAllowedHosts,
} from '@forepath/shared/shared/util-network-address';
import { BadRequestException, Logger } from '@nestjs/common';

function allowInternalClientEndpointHost(): boolean {
  return process.env.CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST?.trim().toLowerCase() === 'true';
}

function getAllowedClientEndpointHosts(): string[] {
  return parseAllowedHosts(process.env.CLIENT_ENDPOINT_ALLOWED_HOSTS);
}

function isAllowAllHostsConfigured(allowedHosts: string[]): boolean {
  return allowedHosts.includes('*');
}

export interface ClientEndpointTlsPolicy {
  rejectUnauthorized: boolean;
}

export function getClientEndpointTlsPolicy(logger?: Logger): ClientEndpointTlsPolicy {
  const raw = process.env.CLIENT_ENDPOINT_TLS_REJECT_UNAUTHORIZED;
  const explicitDisable = raw?.trim().toLowerCase() === 'false';

  if (!explicitDisable) {
    return { rejectUnauthorized: true };
  }

  if (process.env.NODE_ENV === 'production') {
    throw new Error('CLIENT_ENDPOINT_TLS_REJECT_UNAUTHORIZED=false is not allowed in production');
  }

  logger?.warn('CLIENT_ENDPOINT_TLS_REJECT_UNAUTHORIZED=false: TLS verification is disabled (development only).');

  return { rejectUnauthorized: false };
}

/**
 * SSRF guardrails for client-controlled workspace endpoints (agent-manager base URL).
 *
 * - Validates URL shape; blocks credentials in URL; http(s) only.
 * - Production: HTTPS unless `CLIENT_ENDPOINT_ALLOW_INSECURE_HTTP=true` (mirrors `CONFIG_ALLOW_INSECURE_HTTP`).
 * - Optional hostname allowlist: `CLIENT_ENDPOINT_ALLOWED_HOSTS` (comma-separated, or `*`).
 * - Private / loopback hostnames and literal private IPs are rejected unless
 *   `CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST=true` (mirrors `CONFIG_ALLOW_INTERNAL_HOST`).
 */
export function assertSafeClientEndpointOrThrow(endpoint: string): URL {
  const trimmed = endpoint.trim();
  let url: URL;

  try {
    url = new URL(trimmed);
  } catch {
    throw new BadRequestException('Client endpoint must be a valid URL');
  }

  if (url.username || url.password) {
    throw new BadRequestException('Client endpoint must not contain username/password');
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BadRequestException('Client endpoint must use http(s)');
  }

  const allowInsecureHttp = process.env.CLIENT_ENDPOINT_ALLOW_INSECURE_HTTP?.trim().toLowerCase() === 'true';
  const isProduction = process.env.NODE_ENV === 'production';

  if (url.protocol === 'http:' && isProduction && !allowInsecureHttp) {
    throw new BadRequestException(
      'Client endpoint must use https (set CLIENT_ENDPOINT_ALLOW_INSECURE_HTTP=true to allow http)',
    );
  }

  const host = url.hostname.trim().toLowerCase();

  if (!host) {
    throw new BadRequestException('Client endpoint hostname is required');
  }

  const allowedHosts = getAllowedClientEndpointHosts();

  if (allowedHosts.length > 0 && !isAllowAllHostsConfigured(allowedHosts) && !allowedHosts.includes(host)) {
    throw new BadRequestException('Client endpoint host is not in allowlist');
  }

  if (!allowInternalClientEndpointHost()) {
    if (!net.isIP(host) && isPrivateOrLoopbackHost(host)) {
      throw new BadRequestException('Client endpoint hostname is not allowed');
    }

    if (net.isIP(host) && isPrivateOrLoopbackIp(host)) {
      throw new BadRequestException('Client endpoint must not target private or loopback IP ranges');
    }
  }

  return url;
}

/**
 * Resolves hostname to addresses and rejects private/loopback ranges (defense-in-depth vs DNS rebinding).
 * Skipped for literal IPs, test mode, dev self-hosts, or when `CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST=true`
 * (same idea as CONFIG: skipping DNS rebinding checks is tied to `CLIENT_ENDPOINT_ALLOW_INTERNAL_HOST`.)
 */
export async function assertClientEndpointHostnameResolvesToPublicIps(hostname: string): Promise<void> {
  if (allowInternalClientEndpointHost()) {
    return;
  }

  if (process.env.NODE_ENV === 'test') {
    return;
  }

  if (net.isIP(hostname)) {
    return;
  }

  const host = hostname.trim().toLowerCase();

  if (isDevSelfHost(host)) {
    return;
  }

  try {
    const results = await dnsPromises.lookup(hostname, { all: true, verbatim: true });

    for (const entry of results) {
      if (isPrivateOrLoopbackIp(entry.address)) {
        throw new BadRequestException('Client endpoint hostname resolves to a private or loopback address');
      }
    }
  } catch (error) {
    if (error instanceof BadRequestException) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    throw new BadRequestException(`Client endpoint hostname could not be resolved: ${message}`);
  }
}

/**
 * Validates client endpoint URL synchronously, then ensures DNS does not point to private/loopback space.
 */
export async function validateClientEndpointWithDnsOrThrow(endpoint: string): Promise<URL> {
  const url = assertSafeClientEndpointOrThrow(endpoint);

  await assertClientEndpointHostnameResolvesToPublicIps(url.hostname);

  return url;
}

export interface ProductionAllowlistLogger {
  error(message: string): void;
}

/**
 * Exit the process in production if client endpoint allowlist is not configured (SSRF hard requirement).
 */
export function assertProductionClientEndpointAllowlistConfigured(logger?: ProductionAllowlistLogger): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  const raw = process.env.CLIENT_ENDPOINT_ALLOWED_HOSTS?.trim();

  if (!raw) {
    const msg = 'FATAL: CLIENT_ENDPOINT_ALLOWED_HOSTS must be set in production for agent-controller. Exiting.';

    logger?.error(msg);
    process.stderr.write(`${msg}\n`);
    process.exit(1);
  }
}
