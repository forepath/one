import { credentialHeaders, otlpLogsBody, syslogFrame, syslogMessage, type SiemRecord } from './siem-formats';

const audit: SiemRecord = {
  kind: 'audit',
  at: '2026-10-18T12:00:00.000Z',
  severity: 'info',
  message: 'plan.apply plan/1',
  attributes: { seq: 7, hash: 'ab', actor: 'u"1]\\', ok: true },
};

describe('SIEM formats', () => {
  it('writes RFC 5424 with escaped structured data, audit as authpriv', () => {
    expect(syslogMessage(audit, 'cp 1')).toBe(
      '<86>1 2026-10-18T12:00:00.000Z cp1 loadweaver - audit [loadweaver@32473 seq="7" hash="ab" actor="u\\"1\\]\\\\" ok="true"] plan.apply plan/1',
    );
    expect(syslogMessage({ ...audit, kind: 'log', severity: 'error', attributes: {}, message: 'a\nb' }, 'n1')).toBe(
      '<131>1 2026-10-18T12:00:00.000Z n1 loadweaver - log [loadweaver@32473] a b',
    );
  });

  it('frames by octet count', () => {
    expect(syslogFrame('äb')).toBe('3 äb');
  });

  it('builds OTLP log records', () => {
    const body = otlpLogsBody([audit], 'lw-1') as {
      resourceLogs: { scopeLogs: { logRecords: Record<string, unknown>[] }[] }[];
    };
    const record = body.resourceLogs[0].scopeLogs[0].logRecords[0];

    expect(record).toMatchObject({
      timeUnixNano: '1792324800000000000',
      severityNumber: 9,
      severityText: 'INFO',
      body: { stringValue: 'plan.apply plan/1' },
    });
    expect(record['attributes']).toEqual(
      expect.arrayContaining([
        { key: 'loadweaver.kind', value: { stringValue: 'audit' } },
        { key: 'seq', value: { intValue: '7' } },
        { key: 'ok', value: { boolValue: true } },
      ]),
    );
  });

  it('turns credentials into headers', () => {
    expect(credentialHeaders({ apiToken: 't' })).toEqual({ Authorization: 'Bearer t' });
    expect(credentialHeaders({ 'X-Api-Key': 'k', 'bad header': 'x', Evil: 'a\r\nb' })).toEqual({ 'X-Api-Key': 'k' });
  });

  it('turns control characters into spaces', () => {
    expect(syslogMessage({ ...audit, attributes: { a: 'x\r\ny' }, message: 'a\rb\u0000c' }, 'n1')).toBe(
      '<86>1 2026-10-18T12:00:00.000Z n1 loadweaver - audit [loadweaver@32473 a="x  y"] a b c',
    );
  });
});
