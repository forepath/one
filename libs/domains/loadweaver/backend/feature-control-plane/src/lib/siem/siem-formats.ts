/** One forwarded record: an audit entry or a log line (3.18 SIEM forwarding). */
export interface SiemRecord {
  kind: 'audit' | 'log';
  at: string;
  severity: 'debug' | 'info' | 'warn' | 'error';
  message: string;
  /** Flat attributes (source, node, project, actor, seq, hash, ...). */
  attributes: Record<string, string | number | boolean>;
}

const SYSLOG_SEVERITY = { error: 3, warn: 4, info: 6, debug: 7 } as const;
const OTLP_SEVERITY = { debug: 5, info: 9, warn: 13, error: 17 } as const;
/** local0; audit entries use authpriv (10), as security events. */
const FACILITY_LOCAL0 = 16;
const FACILITY_AUTHPRIV = 10;
/** Private enterprise number placeholder for the structured data id (RFC 5424 §7.2.2 form `name@number`). */
const SD_ID = 'loadweaver@32473';

/** Control characters (CR, NUL, ...) become spaces, so line-based receivers see one message per record. */
function printable(value: string): string {
  // eslint-disable-next-line no-control-regex -- stripping control characters is the point
  return value.replace(/[\x00-\x1f\x7f]/g, ' ');
}

function sdValue(value: string | number | boolean): string {
  return printable(String(value)).replace(/[\\"\]]/g, '\\$&');
}

function sdName(key: string): string {
  return key.replace(/[^A-Za-z0-9_.-]/g, '_').slice(0, 32) || '_';
}

/** An RFC 5424 message: `<pri>1 time host app - msgid [sd] message`. */
export function syslogMessage(record: SiemRecord, hostname: string): string {
  const facility = record.kind === 'audit' ? FACILITY_AUTHPRIV : FACILITY_LOCAL0;
  const pri = facility * 8 + SYSLOG_SEVERITY[record.severity];
  const host = hostname.replace(/[^\x21-\x7e]/g, '').slice(0, 255) || '-';
  const sd = Object.entries(record.attributes)
    .map(([k, v]) => `${sdName(k)}="${sdValue(v)}"`)
    .join(' ');

  return `<${pri}>1 ${record.at} ${host} loadweaver - ${record.kind} [${SD_ID}${sd ? ` ${sd}` : ''}] ${printable(record.message)}`;
}

/** TCP / TLS framing by octet counting (RFC 6587 §3.4.1); UDP sends the bare message. */
export function syslogFrame(message: string): string {
  return `${Buffer.byteLength(message, 'utf8')} ${message}`;
}

function otlpValue(value: string | number | boolean) {
  if (typeof value === 'boolean') return { boolValue: value };

  if (typeof value === 'number') return Number.isInteger(value) ? { intValue: String(value) } : { doubleValue: value };

  return { stringValue: value };
}

/** An OTLP/HTTP JSON logs request (`ExportLogsServiceRequest`). */
export function otlpLogsBody(records: readonly SiemRecord[], clusterId: string): Record<string, unknown> {
  return {
    resourceLogs: [
      {
        resource: {
          attributes: [
            { key: 'service.name', value: { stringValue: 'loadweaver' } },
            { key: 'loadweaver.cluster', value: { stringValue: clusterId } },
          ],
        },
        scopeLogs: [
          {
            scope: { name: 'loadweaver.siem' },
            logRecords: records.map((r) => ({
              timeUnixNano: `${BigInt(Date.parse(r.at)) * BigInt(1_000_000)}`,
              severityNumber: OTLP_SEVERITY[r.severity],
              severityText: r.severity.toUpperCase(),
              body: { stringValue: r.message },
              attributes: [
                { key: 'loadweaver.kind', value: { stringValue: r.kind } },
                ...Object.entries(r.attributes).map(([key, value]) => ({ key, value: otlpValue(value) })),
              ],
            })),
          },
        ],
      },
    ],
  };
}

/** Headers from a credentials secret: a JSON object of headers, or a token sent as `Bearer`. */
export function credentialHeaders(config: Record<string, string>): Record<string, string> {
  if (config['apiToken'] && Object.keys(config).length === 1) return { Authorization: `Bearer ${config['apiToken']}` };

  return Object.fromEntries(
    Object.entries(config).filter(([name, value]) => /^[A-Za-z0-9-]{1,64}$/.test(name) && !/[\r\n]/.test(value)),
  );
}
