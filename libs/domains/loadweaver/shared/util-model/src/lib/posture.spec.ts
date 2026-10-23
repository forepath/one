import { clientGroupSpecSchema } from './resources/remote-access';
import { compareWith, parsePostureCondition, postureProofMessage, postureReportSchema } from './posture';

describe('posture conditions', () => {
  it('parses integration facts', () => {
    expect(parsePostureCondition('mdm.compliant')).toEqual({
      kind: 'integration-compliant',
      category: 'mdm',
      expected: true,
      text: 'mdm.compliant',
    });
    expect(parsePostureCondition(' mdm.intune.compliant == false ')).toEqual({
      kind: 'integration-compliant',
      category: 'mdm',
      integration: 'intune',
      expected: false,
      text: 'mdm.intune.compliant == false',
    });
    expect(parsePostureCondition('edr.risk <= low')).toEqual({
      kind: 'integration-risk',
      category: 'edr',
      op: '<=',
      value: 'low',
      text: 'edr.risk <= low',
    });
    expect(parsePostureCondition('edr.crowdstrike-eu.risk<high')).toMatchObject({
      integration: 'crowdstrike-eu',
      op: '<',
      value: 'high',
    });
  });

  it('parses device facts', () => {
    expect(parsePostureCondition('device.certificate.valid')).toMatchObject({ kind: 'boolean', expected: true });
    expect(parsePostureCondition('device.firewall != true')).toMatchObject({ kind: 'boolean', expected: false });
    expect(parsePostureCondition('device.certificate.expiresInDays >= 14')).toMatchObject({
      kind: 'number',
      value: 14,
    });
    expect(parsePostureCondition('device.osVersion >= 14.5')).toMatchObject({ kind: 'version', value: '14.5' });
    expect(parsePostureCondition('device.platform != linux')).toMatchObject({ kind: 'platform', value: 'linux' });
  });

  it('rejects malformed conditions', () => {
    for (const text of [
      'mdm',
      'edr.risk',
      'edr.risk <= extreme',
      'device.platform == beos',
      'device.firewall >= true',
      'device.osVersion',
      'xdr.compliant',
      'mdm.Intune.compliant',
      'mdm.compliant; drop',
      'device.certificate.expiresInDays >= soon',
    ])
      expect(typeof parsePostureCondition(text)).toBe('string');
  });

  it('validates conditions in client groups', () => {
    expect(
      clientGroupSpecSchema.safeParse({ posture: { conditions: ['mdm.compliant', 'edr.risk <= medium'] } }).success,
    ).toBe(true);
    expect(clientGroupSpecSchema.safeParse({ posture: { conditions: ['edr.risk <= none'] } }).success).toBe(false);
  });

  it('compares with operators', () => {
    expect(compareWith('<=', 0)).toBe(true);
    expect(compareWith('<', 0)).toBe(false);
    expect(compareWith('!=', 1)).toBe(true);
    expect(compareWith('>=', -1)).toBe(false);
  });
});

describe('posture report protocol', () => {
  it('accepts a full report and rejects unknown fields', () => {
    expect(
      postureReportSchema.safeParse({
        platform: 'macos',
        osVersion: '15.1',
        serialNumber: 'C02XK1ABJG5J',
        hostname: 'alice-mbp.corp.example.com',
        deviceId: '9f1c0f2e-1a2b-4c3d-8e9f-0a1b2c3d4e5f',
        certificate: {
          pem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----',
          proof: { timestamp: '2026-10-20T10:00:00Z', signature: 'MEUCIQ==' },
        },
      }).success,
    ).toBe(true);
    expect(postureReportSchema.safeParse({ platform: 'macos', osVersion: '15', extra: 1 }).success).toBe(false);
    expect(postureReportSchema.safeParse({ platform: 'macos', osVersion: '15', hostname: '-bad' }).success).toBe(false);
  });

  it('builds the proof message', () => {
    expect(postureProofMessage('c1', '2026-10-20T10:00:00Z')).toBe('loadweaver-posture-v1:c1:2026-10-20T10:00:00Z');
  });
});
