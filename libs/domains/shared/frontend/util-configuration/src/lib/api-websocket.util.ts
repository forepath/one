import type { ApiWebsocketConfig } from './environment.interface';

const NAMESPACE_SUFFIX: Record<string, string> = {
  tickets: '/tickets',
  status: '/status',
  vnc: '/vnc',
  projects: '/projects',
  billing: '/billing',
  pages: '/pages',
  clients: '/clients',
};

function primaryWebsocketUrl<E extends string>(config: ApiWebsocketConfig<E>): string {
  return typeof config === 'string' ? config : config.default;
}

function swapNamespaceSuffix(base: string, fromSuffix: string, toSuffix: string): string {
  if (base.endsWith(fromSuffix)) {
    return `${base.slice(0, -fromSuffix.length)}${toSuffix}`;
  }

  try {
    const u = new URL(base);

    return `${u.protocol}//${u.host}/socket${toSuffix}`;
  } catch {
    return `${base.replace(/\/$/, '')}/socket${toSuffix}`;
  }
}

/**
 * Resolves a websocket URL from the string | endpoints union.
 * String form returns the primary URL for `default`, or derives named endpoints by swapping
 * known `/socket/*` suffixes (clients → tickets/status/vnc/…; billing → projects).
 */
export function resolveApiWebsocketUrl<E extends string>(
  config: ApiWebsocketConfig<E> | undefined | null,
  endpoint: E | 'default' = 'default',
): string | null {
  if (config == null) {
    return null;
  }

  if (typeof config !== 'string') {
    if (endpoint === 'default') {
      const value = config.default?.trim();

      return value || null;
    }

    const explicit = config[endpoint as E];

    if (typeof explicit === 'string' && explicit.trim()) {
      return explicit.trim();
    }
  }

  const primary = primaryWebsocketUrl(config).trim();

  if (!primary) {
    return null;
  }

  if (endpoint === 'default') {
    return primary;
  }

  const toSuffix = NAMESPACE_SUFFIX[endpoint];

  if (!toSuffix) {
    return primary;
  }

  if (primary.endsWith('/clients') || primary.includes('/socket/clients')) {
    return swapNamespaceSuffix(primary, '/clients', toSuffix);
  }

  if (primary.endsWith('/billing') || primary.includes('/socket/billing')) {
    if (endpoint === 'projects') {
      return swapNamespaceSuffix(primary, '/billing', '/projects');
    }
  }

  return swapNamespaceSuffix(primary, '/clients', toSuffix);
}
