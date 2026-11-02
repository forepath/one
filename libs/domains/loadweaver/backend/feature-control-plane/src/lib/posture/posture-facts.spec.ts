import { parsePostureCondition, type PostureCondition } from '@forepath/loadweaver/shared/util-model';

import type { PostureVendorDevice } from '../remote-access/posture-plugin';
import {
  certificateState,
  conditionFailure,
  indexVendorDevices,
  integrationFact,
  legacyVerdict,
  matchDevice,
  normalizeHostname,
  normalizeSerial,
  pinIdentifiers,
  pinnedIdentifierViolation,
  type IntegrationFact,
  type PostureFactsView,
} from './posture-facts';

const NOW = Date.parse('2026-10-20T12:00:00Z');

const vendor = (extra: Partial<PostureVendorDevice>): PostureVendorDevice => ({
  externalId: 'x',
  deviceIds: [],
  status: 'compliant',
  reasons: [],
  ...extra,
});

function condition(text: string): PostureCondition {
  const parsed = parsePostureCondition(text);

  if (typeof parsed === 'string') throw new Error(parsed);

  return parsed;
}

function view(extra: Partial<PostureFactsView> = {}): PostureFactsView {
  return {
    report: {
      platform: 'windows',
      osVersion: '10.0.22631',
      appVersion: '1.4.0',
      diskEncryption: true,
      firewall: false,
    },
    integrations: {},
    certificateSerial: null,
    ...extra,
  };
}

const fact = (extra: Partial<IntegrationFact>): IntegrationFact => ({
  integration: 'intune',
  type: 'intune',
  category: 'mdm',
  status: 'compliant',
  reasons: [],
  checkedAt: new Date(NOW - 60_000).toISOString(),
  staleAt: new Date(NOW + 60_000).toISOString(),
  ...extra,
});

describe('posture matching', () => {
  const devices = [
    vendor({
      externalId: 'a',
      serial: 'c02xk1abjg5j',
      hostname: 'ALICE-MBP.corp.example.com',
      deviceIds: ['ID-A'],
      lastSeen: '2026-10-19T00:00:00Z',
    }),
    vendor({
      externalId: 'a-old',
      serial: 'C02XK1ABJG5J',
      hostname: 'alice-mbp-old',
      deviceIds: [],
      lastSeen: '2026-01-01T00:00:00Z',
    }),
    vendor({ externalId: 'b', serial: 'SYSTEM SERIAL NUMBER', hostname: 'build', deviceIds: ['id-b'] }),
    vendor({ externalId: 'c', hostname: 'build', deviceIds: ['id-c'] }),
  ];
  const index = indexVendorDevices(devices);

  it('normalizes serials and hostnames (placeholders are no serial)', () => {
    expect(normalizeSerial(' c02x ')).toBe('C02X');
    expect(normalizeSerial('To Be Filled By O.E.M.')).toBeUndefined();
    expect(normalizeHostname('ALICE-MBP.corp.example.com')).toBe('alice-mbp');
  });

  it('matches by the configured keys in order; duplicate serials pick the latest record', () => {
    expect(matchDevice(index, { serial: 'C02XK1ABJG5J' }, ['serial'])).toMatchObject({
      by: 'serial',
      device: { externalId: 'a' },
    });
    expect(matchDevice(index, { deviceId: 'id-a', serial: 'nope' }, ['serial', 'deviceId'])).toMatchObject({
      by: 'deviceId',
      device: { externalId: 'a' },
    });
    expect(matchDevice(index, { hostname: 'alice-mbp' }, ['hostname'])).toMatchObject({ device: { externalId: 'a' } });
    expect(matchDevice(index, { hostname: 'alice-mbp' }, ['serial'])).toBeNull();
  });

  it('refuses ambiguous hostnames instead of guessing', () => {
    expect(matchDevice(index, { hostname: 'build.local' }, ['hostname'])).toEqual({ ambiguous: 'hostname', count: 2 });
  });

  it('builds normalized facts (unknown when not found or ambiguous)', () => {
    const integration = {
      name: 'intune',
      type: 'intune',
      category: 'mdm' as const,
      displayName: 'Microsoft Intune',
      staleAfterMs: 3_600_000,
    };

    expect(integrationFact(integration, null, NOW)).toMatchObject({
      status: 'unknown',
      reasons: ['Microsoft Intune: device not found'],
      staleAt: '2026-10-20T13:00:00.000Z',
    });
    expect(integrationFact(integration, { ambiguous: 'hostname', count: 2 }, NOW).reasons).toEqual([
      'Microsoft Intune: 2 devices share this hostname',
    ]);
    expect(
      integrationFact(
        integration,
        { by: 'serial', device: vendor({ externalId: 'a', status: 'non-compliant', reasons: ['r'] }) },
        NOW,
      ),
    ).toMatchObject({ status: 'non-compliant', reasons: ['r'], externalId: 'a', matchedBy: 'serial' });
  });
});

describe('posture identity (spoofing)', () => {
  const alice = vendor({
    externalId: 'md-alice',
    serial: 'C02ALICE',
    hostname: 'alice-mbp',
    deviceIds: ['dev-alice'],
    users: ['alice@example.com'],
  });
  const index = indexVendorDevices([alice]);

  it("an unmanaged device reporting another device's hostname inherits nothing with the default keys", () => {
    // Mallory's laptop reports Alice's hostname but has neither her serial nor her device id.
    expect(matchDevice(index, { hostname: 'ALICE-MBP' }, ['serial', 'deviceId'])).toBeNull();
  });

  it('requires the vendor user to match the client owner (case-insensitive) when asked', () => {
    expect(matchDevice(index, { hostname: 'alice-mbp' }, ['hostname'], { requireUser: 'mallory@example.com' })).toEqual(
      { userMismatch: 'hostname', externalId: 'md-alice' },
    );
    expect(matchDevice(index, { serial: 'c02alice' }, ['serial'], { requireUser: 'Alice@Example.COM' })).toMatchObject({
      by: 'serial',
      device: { externalId: 'md-alice' },
    });
    // No usable owner (username only) or a record without users: fail closed.
    expect(matchDevice(index, { serial: 'C02ALICE' }, ['serial'], { requireUser: null })).toMatchObject({
      userMismatch: 'serial',
    });
    expect(
      matchDevice(indexVendorDevices([{ ...alice, users: undefined }]), { serial: 'C02ALICE' }, ['serial'], {
        requireUser: 'alice@example.com',
      }),
    ).toMatchObject({ userMismatch: 'serial' });

    const fact = integrationFact(
      { name: 'intune', type: 'intune', category: 'mdm', displayName: 'Microsoft Intune', staleAfterMs: 60_000 },
      { userMismatch: 'hostname', externalId: 'md-alice' },
      NOW,
    );

    expect(fact).toMatchObject({ status: 'unknown', matchedBy: 'hostname' });
    expect(fact.reasons[0]).toMatch(/user doesn't match the owner/);
  });

  it('pins normalized identifiers and compares them case-insensitively', () => {
    const first = pinIdentifiers(null, { deviceId: ' DEV-1 ', serialNumber: 'c02x', hostname: 'Alice-MBP.local' }, []);

    expect(first).toEqual({
      pinned: { deviceId: 'dev-1', serialNumber: 'C02X', hostname: 'alice-mbp' },
      newIdentifiers: true,
      hostnameTaken: false,
    });
    // Same device, other case: accepted, nothing new.
    expect(
      pinIdentifiers(
        { deviceId: 'DEV-1', serialNumber: 'C02X', hostname: 'alice-mbp' },
        { deviceId: 'dev-1', serialNumber: 'C02x', hostname: 'ALICE-MBP' },
        [],
      ),
    ).toMatchObject({ newIdentifiers: false });
    expect(pinIdentifiers({ deviceId: 'dev-1' }, { deviceId: 'dev-2' }, [])).toMatchObject({
      error: 'changed',
      key: 'deviceId',
    });
    // Another client pinned the value in another case (legacy row): still taken.
    expect(pinIdentifiers(null, { deviceId: 'dev-1' }, [{ deviceId: 'DEV-1' }])).toMatchObject({
      error: 'taken',
      key: 'deviceId',
    });
    expect(pinIdentifiers(null, { serialNumber: 'c02x' }, [{ serialNumber: 'C02X' }])).toMatchObject({
      error: 'taken',
      key: 'serialNumber',
    });
    // Placeholder serials are no serial (never pinned, never conflicting).
    expect(pinIdentifiers(null, { serialNumber: 'To Be Filled By O.E.M.' }, [{ serialNumber: 'X' }])).toMatchObject({
      pinned: {},
      newIdentifiers: false,
    });
  });

  it("doesn't pin a hostname another valid client holds, and keeps a pinned hostname", () => {
    expect(pinIdentifiers(null, { hostname: 'alice-mbp' }, [{ hostname: 'alice-mbp' }])).toEqual({
      pinned: {},
      newIdentifiers: false,
      hostnameTaken: true,
    });
    expect(pinIdentifiers({ hostname: 'alice-mbp' }, { hostname: 'renamed' }, [])).toMatchObject({
      pinned: { hostname: 'alice-mbp' },
    });
  });

  it('maps unique-index races (23505) to the pinned identifier', () => {
    expect(
      pinnedIdentifierViolation({ driverError: { code: '23505', constraint: 'UQ_lw_vpn_clients_pinned_serial' } }),
    ).toBe('serialNumber');
    expect(pinnedIdentifierViolation({ code: '23505', constraint: 'UQ_lw_vpn_clients_pinned_hostname' })).toBe(
      'hostname',
    );
    expect(pinnedIdentifierViolation({ code: '23505', constraint: 'UQ_lw_vpn_clients_public_key' })).toBeNull();
    expect(pinnedIdentifierViolation(new Error('x'))).toBeNull();
  });
});

describe('posture conditions', () => {
  it('evaluates core checks, versions and the platform', () => {
    expect(conditionFailure(condition('device.diskEncryption'), view(), NOW)).toBeNull();
    expect(conditionFailure(condition('device.firewall'), view(), NOW)).toBe('device.firewall: reported false');
    expect(conditionFailure(condition('device.screenLock'), view(), NOW)).toBe('device.screenLock: not reported');
    expect(conditionFailure(condition('device.osVersion >= 10.0.22000'), view(), NOW)).toBeNull();
    expect(conditionFailure(condition('device.appVersion >= 1.10'), view(), NOW)).toBe(
      'device.appVersion >= 1.10: is 1.4.0',
    );
    expect(conditionFailure(condition('device.platform != linux'), view(), NOW)).toBeNull();
    expect(conditionFailure(condition('device.platform == macos'), view(), NOW)).toBe(
      'device.platform == macos: is windows',
    );
  });

  it('aggregates MDM compliance: one compliant result and no failing one', () => {
    const integrations = {
      intune: fact({}),
      jamf: fact({ integration: 'jamf', type: 'jamf', status: 'unknown', reasons: ['Jamf Pro: device not found'] }),
    };

    expect(conditionFailure(condition('mdm.compliant'), view({ integrations }), NOW)).toBeNull();
    expect(conditionFailure(condition('mdm.jamf.compliant'), view({ integrations }), NOW)).toBe(
      'Jamf Pro: device not found',
    );
    expect(conditionFailure(condition('mdm.kandji.compliant'), view({ integrations }), NOW)).toBe(
      'kandji: no result for this device',
    );
    expect(
      conditionFailure(
        condition('mdm.compliant'),
        view({
          integrations: {
            ...integrations,
            jamf: fact({ integration: 'jamf', status: 'non-compliant', reasons: ['Jamf Pro: not managed'] }),
          },
        }),
        NOW,
      ),
    ).toBe('Jamf Pro: not managed');
    expect(
      conditionFailure(
        condition('mdm.compliant'),
        view({ integrations: { intune: fact({ staleAt: new Date(NOW - 1).toISOString() }) } }),
        NOW,
      ),
    ).toBe('MDM: the last result is outdated');
  });

  it('compares the worst current EDR risk', () => {
    const integrations = {
      s1: fact({ integration: 's1', type: 'sentinelone', category: 'edr', risk: 'low' }),
      cs: fact({
        integration: 'cs',
        type: 'crowdstrike',
        category: 'edr',
        risk: 'medium',
        reasons: ['CrowdStrike: Zero Trust Assessment score 55'],
      }),
    };

    expect(conditionFailure(condition('edr.risk <= medium'), view({ integrations }), NOW)).toBeNull();
    expect(conditionFailure(condition('edr.risk <= low'), view({ integrations }), NOW)).toBe(
      'EDR: risk medium (CrowdStrike: Zero Trust Assessment score 55)',
    );
    expect(conditionFailure(condition('edr.s1.risk < medium'), view({ integrations }), NOW)).toBeNull();
    expect(conditionFailure(condition('edr.risk <= high'), view(), NOW)).toBe(
      'EDR: no current risk level for this device',
    );
  });

  it('checks device certificates: validity, expiry window and supersession', () => {
    const certificate = {
      source: 'company' as const,
      valid: true,
      revoked: false,
      serialNumber: '01',
      notAfter: new Date(NOW + 10 * 86_400_000).toISOString(),
      reasons: [],
      checkedAt: new Date(NOW).toISOString(),
    };

    expect(conditionFailure(condition('device.certificate.valid'), view({ certificate }), NOW)).toBeNull();
    expect(conditionFailure(condition('device.certificate.expiresInDays >= 14'), view({ certificate }), NOW)).toBe(
      'device.certificate.expiresInDays >= 14: 10 days left',
    );
    expect(conditionFailure(condition('device.certificate.valid'), view(), NOW)).toBe('no device certificate');
    expect(
      conditionFailure(
        condition('device.certificate.valid'),
        view({
          certificate: { ...certificate, valid: false, revoked: true, reasons: ['the device certificate is revoked'] },
        }),
        NOW,
      ),
    ).toBe('the device certificate is revoked');
    expect(certificateState(view({ certificate }), NOW + 11 * 86_400_000).reasons).toEqual([
      'the device certificate expired',
    ]);
    expect(
      certificateState(view({ certificate: { ...certificate, source: 'loadweaver' }, certificateSerial: '02' }), NOW)
        .valid,
    ).toBe(false);
  });

  it('maps facts to the verdicts of the older plugin rules', () => {
    expect(legacyVerdict(view({ integrations: { intune: fact({}) } }), 'intune', NOW)).toEqual({
      verdict: 'compliant',
    });
    expect(
      legacyVerdict(
        view({
          integrations: { edr: fact({ integration: 'edr', type: 'crowdstrike', category: 'edr', risk: 'low' }) },
        }),
        'crowdstrike',
        NOW,
      ),
    ).toEqual({ verdict: 'low-risk' });
    expect(
      legacyVerdict(
        view({
          integrations: { edr: fact({ type: 'crowdstrike', category: 'edr', risk: 'low', status: 'non-compliant' }) },
        }),
        'crowdstrike',
        NOW,
      ).verdict,
    ).toBe('non-compliant');
    expect(legacyVerdict(view(), 'kandji', NOW)).toEqual({ verdict: 'unknown' });
  });
});
