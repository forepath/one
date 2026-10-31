import type { AuditEventEntity } from '../entities/audit-event.entity';
import type { LogLine } from '../logs/logs.service';
import { auditRecord, backoffMs, batchSize, chunkBySize, logRecord, siemTestRecord } from './siem-forwarder.service';
import type { SiemRecord } from './siem-formats';
import { udpPayload } from './siem-sender';

describe('SIEM forwarding helpers', () => {
  it('forwards audit entries with their chain hashes', () => {
    const record = auditRecord({
      seq: '12',
      at: new Date('2026-10-18T12:00:00Z'),
      actorType: 'user',
      actorId: 'u1',
      action: 'plan.apply',
      target: 'plan/p1',
      project: 'shop',
      details: { a: 1 },
      prevHash: 'p',
      hash: 'h',
    } as AuditEventEntity);

    expect(record).toEqual({
      kind: 'audit',
      at: '2026-10-18T12:00:00.000Z',
      severity: 'info',
      message: 'plan.apply plan/p1',
      attributes: {
        seq: 12,
        action: 'plan.apply',
        target: 'plan/p1',
        actorType: 'user',
        actorId: 'u1',
        project: 'shop',
        details: '{"a":1}',
        prevHash: 'p',
        hash: 'h',
      },
    });
  });

  it('marks the connection-test record as a test (3.41)', () => {
    expect(siemTestRecord(new Date('2026-10-29T10:00:00Z'))).toEqual({
      kind: 'log',
      at: '2026-10-29T10:00:00.000Z',
      severity: 'info',
      message: expect.stringContaining('connection test'),
      attributes: { source: 'loadweaver', event: 'integration.test', test: true },
    });
  });

  it('flattens log lines', () => {
    expect(
      logRecord({
        id: 'x',
        at: '2026-10-18T12:00:00.000Z',
        source: 'container',
        level: 'warn',
        message: 'm',
        node: 'n1',
        site: null,
        labels: { project: 'shop', service: 'web' },
        fields: {},
      } as LogLine),
    ).toEqual({
      kind: 'log',
      at: '2026-10-18T12:00:00.000Z',
      severity: 'warn',
      message: 'm',
      attributes: { source: 'container', node: 'n1', project: 'shop', service: 'web' },
    });
  });

  it('backs off exponentially up to 10 minutes', () => {
    expect([1, 2, 3, 10].map(backoffMs)).toEqual([10_000, 20_000, 40_000, 600_000]);
  });

  it('shrinks batches after failures and splits requests by size', () => {
    expect([0, 1, 2, 6, 20].map(batchSize)).toEqual([500, 250, 125, 8, 8]);

    const record = (n: number): SiemRecord => ({
      kind: 'log',
      at: 'x',
      severity: 'info',
      message: 'm'.repeat(n),
      attributes: {},
    });
    const chunks = chunkBySize([record(400), record(400), record(400), record(2000)], 1000);

    expect(chunks.map((c) => c.length)).toEqual([2, 1, 1]);
  });

  it('cuts datagrams on character boundaries', () => {
    const payload = udpPayload('a' + 'ä'.repeat(5000));

    expect(payload.length).toBeLessThanOrEqual(8000);
    expect(payload.toString('utf8')).not.toContain('\ufffd');
    expect(udpPayload('short').toString()).toBe('short');
  });
});
