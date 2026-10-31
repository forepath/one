/** Logs (3.14): `GET /logs`, `GET /logs/export`, `socket/logs`. */

export const CONSOLE_LOG_SOURCES = [
  'container',
  'proxy',
  'firewall',
  'routing',
  'tunnel',
  'ingress',
  'failover',
  'storage',
  'runtime',
  'control-plane',
] as const;
export type ConsoleLogSource = (typeof CONSOLE_LOG_SOURCES)[number];

export const CONSOLE_LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type ConsoleLogLevel = (typeof CONSOLE_LOG_LEVELS)[number];

/** One stored line, enriched with the labels the policy model uses. */
export interface LogLine {
  id: string;
  at: string;
  source: ConsoleLogSource;
  level: ConsoleLogLevel;
  message: string;
  node: string;
  site: string | null;
  labels: Record<string, string | undefined>;
  fields: Record<string, string | number | boolean>;
}

/** The filter of `GET /logs` (and of a live tail's `subscribe`). */
export interface LogFilter {
  /** ISO times; default the last hour. */
  from?: string;
  to?: string;
  sources?: ConsoleLogSource[];
  levels?: ConsoleLogLevel[];
  project?: string;
  deployment?: string;
  service?: string;
  /** `<project>/<deployment>/<service>/<index>`. */
  replica?: string;
  node?: string;
  policy?: string;
  /** Full text over the message. */
  text?: string;
}

export interface LogQuery extends LogFilter {
  /** 1–1000. */
  limit?: number;
  /** Opaque cursor of the previous page. */
  cursor?: string;
  /** `desc` (newest first, default) or `asc`. */
  order?: 'asc' | 'desc';
}

/** `cursor`: set when the page is full (there may be more); `after`: the position after the last line. */
export interface LogPage {
  lines: LogLine[];
  cursor: string | null;
  after: string | null;
}

export type LogExportFormat = 'ndjson' | 'csv';

/** `socket/logs` `logLines`. */
export interface LogLinesEvent {
  lines: LogLine[];
}
