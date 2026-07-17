import { promises as dnsPromises } from 'node:dns';
import * as net from 'node:net';

import {
  isDevSelfHost,
  isPrivateOrLoopbackHost,
  isPrivateOrLoopbackIp,
} from '@forepath/shared/shared/util-network-address';

export interface WebhookProductionSafetyLogger {
  error(message: string): void;
}

function allowInternalWebhookHost(): boolean {
  return (
    process.env.NODE_ENV !== 'production' || process.env.WEBHOOK_ALLOW_INTERNAL_HOST?.trim().toLowerCase() === 'true'
  );
}

function allowInsecureWebhookHttp(): boolean {
  return (
    process.env.NODE_ENV !== 'production' || process.env.WEBHOOK_ALLOW_INSECURE_HTTP?.trim().toLowerCase() === 'true'
  );
}

/**
 * SSRF guardrails for admin-configured outbound webhook URLs.
 *
 * Mirrors `client-endpoint-security.ts`: blocks URL credentials, validates protocol/host,
 * and rejects private/loopback targets unless explicitly allowed in non-production.
 */
export function assertSafeWebhookUrlOrThrow(urlString: string): URL {
  const trimmed = urlString.trim();
  let parsed: URL;

  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('Webhook URL must be a valid URL');
  }

  if (parsed.username || parsed.password) {
    throw new Error('Webhook URL must not contain username/password');
  }

  if (parsed.protocol === 'http:') {
    if (!allowInsecureWebhookHttp()) {
      throw new Error('Webhook URL must use HTTPS');
    }
  } else if (parsed.protocol !== 'https:') {
    throw new Error('Webhook URL must use HTTPS');
  }

  const host = parsed.hostname.trim().toLowerCase();

  if (!host) {
    throw new Error('Webhook URL hostname is required');
  }

  if (!allowInternalWebhookHost()) {
    if (!net.isIP(host) && isPrivateOrLoopbackHost(host)) {
      throw new Error('Webhook URL must not target private or loopback addresses');
    }

    if (net.isIP(host) && isPrivateOrLoopbackIp(host)) {
      throw new Error('Webhook URL must not target private or loopback addresses');
    }
  }

  return parsed;
}

/** @deprecated Prefer {@link assertSafeWebhookUrlOrThrow} or {@link validateWebhookUrlWithDnsOrThrow}. */
export function assertPublicHttpsWebhookUrl(url: string): void {
  assertSafeWebhookUrlOrThrow(url);
}

/**
 * Resolves hostname to addresses and rejects private/loopback ranges (defense-in-depth vs DNS rebinding).
 * Skipped for literal IPs, test mode, dev self-hosts, or when internal hosts are explicitly allowed.
 */
export async function assertWebhookHostnameResolvesToPublicIps(hostname: string): Promise<void> {
  if (allowInternalWebhookHost()) {
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
    const results = await dnsPromises.lookup(host, { all: true, verbatim: true });

    for (const entry of results) {
      if (isPrivateOrLoopbackIp(entry.address)) {
        throw new Error('Webhook URL hostname resolves to a private or loopback address');
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.includes('resolves to a private')) {
      throw error;
    }

    const message = error instanceof Error ? error.message : String(error);

    throw new Error(`Webhook URL hostname could not be resolved: ${message}`);
  }
}

export async function validateWebhookUrlWithDnsOrThrow(urlString: string): Promise<URL> {
  const url = assertSafeWebhookUrlOrThrow(urlString);

  await assertWebhookHostnameResolvesToPublicIps(url.hostname);

  return url;
}

/**
 * Exit the process in production when webhook SSRF escape hatches are enabled.
 */
export function assertProductionWebhookEscapeHatchesDisabled(logger?: WebhookProductionSafetyLogger): void {
  if (process.env.NODE_ENV !== 'production') {
    return;
  }

  if (process.env.WEBHOOK_ALLOW_INTERNAL_HOST?.trim().toLowerCase() === 'true') {
    const message = 'FATAL: WEBHOOK_ALLOW_INTERNAL_HOST=true is not allowed in production. Exiting.';

    logger?.error(message);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }

  if (process.env.WEBHOOK_ALLOW_INSECURE_HTTP?.trim().toLowerCase() === 'true') {
    const message = 'FATAL: WEBHOOK_ALLOW_INSECURE_HTTP=true is not allowed in production. Exiting.';

    logger?.error(message);
    process.stderr.write(`${message}\n`);
    process.exit(1);
  }
}
