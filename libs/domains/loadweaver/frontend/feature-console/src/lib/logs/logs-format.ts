import type { ConsoleLogLevel, ConsoleLogSource } from '@forepath/loadweaver/frontend/data-access-console';

export const LOG_LEVEL_TONE: Record<ConsoleLogLevel, 'secondary' | 'info' | 'warning' | 'danger'> = {
  debug: 'secondary',
  info: 'info',
  warn: 'warning',
  error: 'danger',
};

export function logLevelLabel(level: ConsoleLogLevel): string {
  switch (level) {
    case 'debug':
      return $localize`:@@lwConsoleLogs-levelDebug:Debug`;
    case 'info':
      return $localize`:@@lwConsoleLogs-levelInfo:Info`;
    case 'warn':
      return $localize`:@@lwConsoleLogs-levelWarn:Warning`;
    default:
      return $localize`:@@lwConsoleLogs-levelError:Error`;
  }
}

export function logSourceLabel(source: ConsoleLogSource): string {
  switch (source) {
    case 'container':
      return $localize`:@@lwConsoleLogs-sourceContainer:Containers`;
    case 'proxy':
      return $localize`:@@lwConsoleLogs-sourceProxy:Proxy`;
    case 'firewall':
      return $localize`:@@lwConsoleLogs-sourceFirewall:Firewall`;
    case 'routing':
      return $localize`:@@lwConsoleLogs-sourceRouting:Routing`;
    case 'tunnel':
      return $localize`:@@lwConsoleLogs-sourceTunnel:Tunnels`;
    case 'ingress':
      return $localize`:@@lwConsoleLogs-sourceIngress:Ingress`;
    case 'failover':
      return $localize`:@@lwConsoleLogs-sourceFailover:Failover IPs`;
    case 'storage':
      return $localize`:@@lwConsoleLogs-sourceStorage:Storage`;
    case 'runtime':
      return $localize`:@@lwConsoleLogs-sourceRuntime:Runtime`;
    default:
      return $localize`:@@lwConsoleLogs-sourceControlPlane:Control plane`;
  }
}

/** Relative time ranges (`custom`: explicit from / to). */
export type LogRange = '15m' | '1h' | '6h' | '24h' | '7d' | 'custom';

export const LOG_RANGES: LogRange[] = ['15m', '1h', '6h', '24h', '7d', 'custom'];

const RANGE_MS: Record<Exclude<LogRange, 'custom'>, number> = {
  '15m': 15 * 60_000,
  '1h': 3_600_000,
  '6h': 6 * 3_600_000,
  '24h': 86_400_000,
  '7d': 7 * 86_400_000,
};

export function rangeMs(range: Exclude<LogRange, 'custom'>): number {
  return RANGE_MS[range];
}

export function logRangeLabel(range: LogRange): string {
  switch (range) {
    case '15m':
      return $localize`:@@lwConsoleLogs-range15m:Last 15 minutes`;
    case '1h':
      return $localize`:@@lwConsoleLogs-range1h:Last hour`;
    case '6h':
      return $localize`:@@lwConsoleLogs-range6h:Last 6 hours`;
    case '24h':
      return $localize`:@@lwConsoleLogs-range24h:Last 24 hours`;
    case '7d':
      return $localize`:@@lwConsoleLogs-range7d:Last 7 days`;
    default:
      return $localize`:@@lwConsoleLogs-rangeCustom:Custom range`;
  }
}

/** A `datetime-local` value (local time) of an ISO time, and back. */
export function isoToLocalInput(iso: string | null | undefined): string {
  if (!iso || Number.isNaN(Date.parse(iso))) return '';

  const date = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');

  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function localInputToIso(value: string): string | null {
  const time = Date.parse(value);

  return Number.isNaN(time) ? null : new Date(time).toISOString();
}
