import type { PostureIntegrationFact, PosturePluginInfo } from '@forepath/loadweaver/frontend/data-access-console';

import {
  certificateLabel,
  certificateTone,
  configPayload,
  factLabel,
  factTone,
  integrationStatusTone,
  missingFields,
  orderedMatchBy,
  reportSummary,
} from './posture-format';

const NOW = Date.parse('2026-10-20T12:00:00Z');
const fact = (extra: Partial<PostureIntegrationFact> = {}): PostureIntegrationFact => ({
  integration: 'cs',
  type: 'crowdstrike',
  category: 'edr',
  status: 'compliant',
  risk: 'low',
  reasons: [],
  checkedAt: '2026-10-20T11:00:00Z',
  staleAt: '2026-10-21T11:00:00Z',
  ...extra,
});
const plugin: PosturePluginInfo = {
  id: 'jamf',
  displayName: 'Jamf Pro',
  category: 'mdm',
  defaultMatchBy: ['serial', 'deviceId', 'hostname'],
  fields: [
    { key: 'baseUrl', label: 'URL', required: true },
    { key: 'clientSecret', label: 'Secret', required: true, secret: true },
    { key: 'complianceGroupId', label: 'Group' },
  ],
};

describe('posture format', () => {
  it('labels and colours integration facts (stale counts as unknown)', () => {
    expect(factLabel(fact(), NOW)).toBe('cs: compliant (risk low)');
    expect(factTone(fact(), NOW)).toBe('success');
    expect(factTone(fact({ risk: 'medium' }), NOW)).toBe('warning');
    expect(factTone(fact({ status: 'non-compliant' }), NOW)).toBe('danger');
    expect(factLabel(fact({ staleAt: '2026-10-20T00:00:00Z' }), NOW)).toBe('cs: outdated');
    expect(factTone(fact({ staleAt: '2026-10-20T00:00:00Z' }), NOW)).toBe('neutral');
    expect(integrationStatusTone('failing')).toBe('danger');
  });

  it('describes device certificates', () => {
    const cert = {
      source: 'loadweaver' as const,
      valid: true,
      revoked: false,
      notAfter: '2026-10-25T00:00:00Z',
      reasons: [],
      checkedAt: '',
    };

    expect(certificateLabel(null)).toBe('No device certificate');
    expect(certificateLabel(cert, NOW)).toBe('Device certificate (cluster CA)');
    expect(certificateTone(cert, NOW)).toBe('warning');
    expect(certificateTone({ ...cert, valid: false }, NOW)).toBe('danger');
  });

  it('summarizes the last report', () => {
    expect(reportSummary(undefined)).toBeNull();
    expect(
      reportSummary({
        reportedAt: null,
        platform: 'windows',
        osVersion: '10.0.22631',
        appVersion: null,
        diskEncryption: null,
        firewall: null,
        screenLock: null,
        serialNumber: null,
        hostname: 'bob-pc',
        integrations: [],
        certificate: null,
      }),
    ).toBe('windows 10.0.22631, bob-pc');
  });

  it('builds config payloads: stored secrets stay unless typed, cleared plain fields are sent empty', () => {
    expect(configPayload(plugin, { baseUrl: ' https://a.jamfcloud.com ', clientSecret: '' }, false)).toEqual({
      baseUrl: 'https://a.jamfcloud.com',
    });
    expect(configPayload(plugin, { baseUrl: 'https://a.jamfcloud.com', complianceGroupId: '' }, true)).toEqual({
      baseUrl: 'https://a.jamfcloud.com',
      complianceGroupId: '',
    });
    expect(missingFields(plugin, { baseUrl: 'x' })).toEqual(['clientSecret']);
    expect(missingFields(plugin, { baseUrl: 'x' }, ['clientSecret'])).toEqual([]);
  });

  it('orders match keys by the plugin preference', () => {
    expect(orderedMatchBy(['hostname', 'serial'], plugin)).toEqual(['serial', 'hostname']);
  });
});
