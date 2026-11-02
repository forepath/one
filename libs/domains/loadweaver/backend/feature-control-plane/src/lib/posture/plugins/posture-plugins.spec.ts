import type { PosturePlugin, PosturePluginFactory } from '../../remote-access/posture-plugin';
import { PostureHttp, type FetchLike } from '../posture-http';
import { BUILTIN_POSTURE_PLUGINS } from './builtin-posture-plugins';
import { crowdstrikePluginFactory, ztaRisk } from './crowdstrike.plugin';
import { defenderPluginFactory } from './defender.plugin';
import { intunePluginFactory } from './intune.plugin';
import { jamfPluginFactory } from './jamf.plugin';
import { kandjiPluginFactory } from './kandji.plugin';
import { sentinelOnePluginFactory } from './sentinelone.plugin';

/**
 * Plugin tests against fake vendor APIs: payload shapes follow the vendors' API documentation (field names, paging,
 * auth), no network.
 */

interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body?: string;
}

type Handler = (request: RecordedRequest) => { status?: number; body?: unknown; headers?: Record<string, string> };

function fakeVendor(routes: Record<string, Handler>): { fetch: FetchLike; requests: RecordedRequest[] } {
  const requests: RecordedRequest[] = [];
  const keys = Object.keys(routes).sort((a, b) => b.length - a.length);
  const fetchImpl: FetchLike = async (url, init) => {
    const headers = Object.fromEntries(
      Object.entries((init.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]),
    );
    const request: RecordedRequest = {
      method: init.method ?? 'GET',
      url,
      headers,
      ...(typeof init.body === 'string' ? { body: init.body } : {}),
    };

    requests.push(request);

    const key = keys.find((k) => {
      const [method, prefix] = k.split(' ');

      return method === request.method && url.startsWith(prefix);
    });

    if (!key) return new Response(JSON.stringify({ error: 'not found' }), { status: 404 });

    const answer = routes[key](request);

    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status ?? 200,
      headers: { 'content-type': 'application/json', ...(answer.headers ?? {}) },
    });
  };

  return { fetch: fetchImpl, requests };
}

function enrichOf(plugin: PosturePlugin): NonNullable<PosturePlugin['enrich']> {
  if (!plugin.enrich) throw new Error(`${plugin.id} has no enrich step`);

  return plugin.enrich.bind(plugin);
}

function run(factory: PosturePluginFactory, config: Record<string, string>, fetchImpl: FetchLike) {
  const http = new PostureHttp({ allowedHosts: factory.allowedHosts(config), fetchImpl, sleep: async () => undefined });

  return { http, plugin: factory.create(config) };
}

const recent = new Date(Date.now() - 3_600_000).toISOString();
const old = new Date(Date.now() - 40 * 86_400_000).toISOString();

describe('built-in posture plugins', () => {
  it('registers six plugins with unique ids and secret credential fields', () => {
    expect(BUILTIN_POSTURE_PLUGINS.map((p) => p.id)).toEqual([
      'intune',
      'jamf',
      'kandji',
      'defender',
      'crowdstrike',
      'sentinelone',
    ]);

    for (const factory of BUILTIN_POSTURE_PLUGINS)
      expect(factory.fields.filter((f) => /secret|token/i.test(f.key)).every((f) => f.secret)).toBe(true);
  });

  it('never matches by hostname by default; MDMs whose records carry the user support a user match', () => {
    for (const factory of BUILTIN_POSTURE_PLUGINS) expect(factory.defaultMatchBy).not.toContain('hostname');

    expect(BUILTIN_POSTURE_PLUGINS.filter((p) => p.supportsUserMatch).map((p) => p.id)).toEqual([
      'intune',
      'jamf',
      'kandji',
    ]);
  });

  describe('Microsoft Intune', () => {
    const config = { tenantId: 'contoso.onmicrosoft.com', clientId: 'app-1', clientSecret: 's3cr3t' };

    it('uses client credentials against Entra ID and pages managed devices through @odata.nextLink', async () => {
      const page2 = 'https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$skiptoken=abc';
      const vendor = fakeVendor({
        'POST https://login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token': () => ({
          body: { token_type: 'Bearer', expires_in: 3599, access_token: 'graph-token' },
        }),
        'GET https://graph.microsoft.com/v1.0/deviceManagement/managedDevices?$select': () => ({
          body: {
            '@odata.context': 'https://graph.microsoft.com/v1.0/$metadata#deviceManagement/managedDevices',
            '@odata.nextLink': page2,
            value: [
              {
                id: '705c034c-034c-705c-4c03-5c704c035c70',
                deviceName: 'ALICE-LAPTOP',
                serialNumber: 'PF3ABCDE',
                azureADDeviceId: 'b5f7b7d2-6c3e-4f1a-9a7e-2d4c5e6f7a8b',
                complianceState: 'compliant',
                lastSyncDateTime: recent,
                userPrincipalName: 'Alice@Contoso.com',
              },
              { id: '2', deviceName: 'BOB-PC', serialNumber: 'X1', complianceState: 'noncompliant' },
            ],
          },
        }),
        [`GET ${page2}`]: () => ({
          body: {
            value: [
              { id: '3', deviceName: 'C', complianceState: 'inGracePeriod' },
              { id: '4', complianceState: 'unknown' },
            ],
          },
        }),
      });
      const { http, plugin } = run(intunePluginFactory, config, vendor.fetch);
      const devices = await plugin.fetchDevices({ http });

      expect(vendor.requests[0].body).toContain('grant_type=client_credentials');
      expect(vendor.requests[0].body).toContain('scope=https%3A%2F%2Fgraph.microsoft.com%2F.default');
      expect(vendor.requests[1].headers['authorization']).toBe('Bearer graph-token');
      expect(devices.map((d) => [d.externalId, d.status])).toEqual([
        ['705c034c-034c-705c-4c03-5c704c035c70', 'compliant'],
        ['2', 'non-compliant'],
        ['3', 'compliant'],
        ['4', 'unknown'],
      ]);
      expect(devices[0]).toMatchObject({
        serial: 'PF3ABCDE',
        hostname: 'ALICE-LAPTOP',
        deviceIds: ['705c034c-034c-705c-4c03-5c704c035c70', 'b5f7b7d2-6c3e-4f1a-9a7e-2d4c5e6f7a8b'],
        users: ['alice@contoso.com'],
      });
      expect(devices[1].users).toEqual([]);
      expect(vendor.requests[1].url).toContain('userPrincipalName');
      expect(devices[2].reasons[0]).toMatch(/grace period/);
    });

    it('validates the configuration and keeps calls on the cloud hosts', () => {
      expect(intunePluginFactory.allowedHosts(config)).toEqual(['login.microsoftonline.com', 'graph.microsoft.com']);
      expect(intunePluginFactory.allowedHosts({ ...config, cloud: 'usgov' })).toEqual([
        'login.microsoftonline.us',
        'graph.microsoft.us',
      ]);
      expect(() => intunePluginFactory.allowedHosts({ ...config, tenantId: 'bad/../tenant' })).toThrow(/tenantId/);
      expect(() => intunePluginFactory.allowedHosts({ ...config, clientSecret: '' })).toThrow(/clientSecret/);
    });

    it('refuses a nextLink to a foreign host', async () => {
      const vendor = fakeVendor({
        'POST https://login.microsoftonline.com/': () => ({ body: { access_token: 't' } }),
        'GET https://graph.microsoft.com/': () => ({
          body: { value: [], '@odata.nextLink': 'https://evil.example.com/steal' },
        }),
      });
      const { http, plugin } = run(intunePluginFactory, config, vendor.fetch);

      await expect(plugin.fetchDevices({ http })).rejects.toThrow(/evil.example.com is not allowed/);
      expect(vendor.requests.some((r) => r.url.includes('evil'))).toBe(false);
    });
  });

  describe('Jamf Pro', () => {
    const config = {
      baseUrl: 'https://acme.jamfcloud.com',
      clientId: 'c-1',
      clientSecret: 'shh',
      complianceGroupId: '12',
      maxCheckInDays: '14',
    };

    it('reads the computers inventory with API client credentials, paged', async () => {
      const results = Array.from({ length: 200 }, (_, i) => ({
        id: String(i + 10),
        udid: `UDID-${i}`,
        general: { name: `mac-${i}`, lastContactTime: recent, remoteManagement: { managed: true } },
        hardware: { serialNumber: `SN${i}` },
        userAndLocation: { username: `user${i}`, email: `User${i}@Acme.example` },
        groupMemberships: [{ groupId: '12', groupName: 'Compliant Macs', smartGroup: true }],
      }));
      const vendor = fakeVendor({
        'POST https://acme.jamfcloud.com/api/oauth/token': () => ({
          body: { access_token: 'jamf-token', scope: 'api-role:2', token_type: 'Bearer', expires_in: 59 },
        }),
        'GET https://acme.jamfcloud.com/api/v1/computers-inventory?section=GENERAL&section=HARDWARE&section=USER_AND_LOCATION&section=GROUP_MEMBERSHIPS&page=0':
          () => ({
            body: { totalCount: 203, results },
          }),
        'GET https://acme.jamfcloud.com/api/v1/computers-inventory?section=GENERAL&section=HARDWARE&section=USER_AND_LOCATION&section=GROUP_MEMBERSHIPS&page=1':
          () => ({
            body: {
              totalCount: 203,
              results: [
                {
                  id: '1',
                  udid: 'U1',
                  general: { name: 'unmanaged', lastContactTime: recent, remoteManagement: { managed: false } },
                  hardware: { serialNumber: 'C02UNMANAGED' },
                  groupMemberships: [],
                },
                {
                  id: '2',
                  general: { name: 'stale', lastContactTime: old, remoteManagement: { managed: true } },
                  hardware: { serialNumber: 'C02STALE' },
                  groupMemberships: [{ groupId: '12' }],
                },
                {
                  id: '3',
                  general: { name: 'outside', lastContactTime: recent, remoteManagement: { managed: true } },
                  hardware: { serialNumber: 'C02OUT' },
                  groupMemberships: [{ groupId: '99' }],
                },
              ],
            },
          }),
      });
      const { http, plugin } = run(jamfPluginFactory, config, vendor.fetch);
      const devices = await plugin.fetchDevices({ http });

      expect(vendor.requests[0].body).toBe('grant_type=client_credentials&client_id=c-1&client_secret=shh');
      expect(devices).toHaveLength(203);
      expect(devices[0]).toMatchObject({
        serial: 'SN0',
        status: 'compliant',
        deviceIds: ['10', 'UDID-0'],
        users: ['user0@acme.example'],
      });
      expect(devices.slice(200).map((d) => d.reasons)).toEqual([
        ['Jamf Pro: the computer is not managed', 'Jamf Pro: not in the compliance smart group'],
        [expect.stringMatching(/no check-in for 40 days/)],
        ['Jamf Pro: not in the compliance smart group'],
      ]);
    });

    it('accepts only https base URLs with a host name', () => {
      expect(jamfPluginFactory.allowedHosts(config)).toEqual(['acme.jamfcloud.com']);
      expect(() => jamfPluginFactory.allowedHosts({ ...config, baseUrl: 'http://acme.jamfcloud.com' })).toThrow(
        /https/,
      );
      expect(() => jamfPluginFactory.allowedHosts({ ...config, baseUrl: 'https://10.0.0.1' })).toThrow(/host/);
      expect(() => jamfPluginFactory.allowedHosts({ ...config, baseUrl: 'https://u:p@acme.jamfcloud.com' })).toThrow(
        /credentials/,
      );
      expect(() => jamfPluginFactory.allowedHosts({ ...config, complianceGroupId: 'x' })).toThrow(/number/);
    });
  });

  describe('Kandji', () => {
    const config = {
      subdomain: 'acme',
      region: 'eu',
      apiToken: 'kandji-token',
      blueprintIds: 'bp-1',
      maxCheckInDays: '7',
    };

    it('lists devices and enriches matched ones with the blueprint status', async () => {
      const vendor = fakeVendor({
        'GET https://acme.api.eu.kandji.io/api/v1/devices?limit=300&offset=0': () => ({
          body: [
            {
              device_id: '3d7a2c1b-0e9f-4a8b-b7c6-d5e4f3a2b1c0',
              device_name: 'Alice MacBook Pro',
              serial_number: 'FVFXC2ABCDEF',
              platform: 'Mac',
              os_version: '15.1',
              blueprint_id: 'bp-1',
              blueprint_name: 'Engineering',
              last_check_in: recent,
              mdm_enabled: true,
              agent_installed: 'True',
              is_missing: false,
              user: { email: 'alice@acme.example', name: 'Alice', id: 7 },
            },
            {
              device_id: 'd2',
              device_name: 'Kiosk',
              serial_number: 'KIOSK1',
              blueprint_id: 'bp-9',
              blueprint_name: 'Kiosks',
              last_check_in: recent,
              mdm_enabled: true,
              agent_installed: true,
              user: '',
            },
          ],
        }),
        'GET https://acme.api.eu.kandji.io/api/v1/devices/3d7a2c1b-0e9f-4a8b-b7c6-d5e4f3a2b1c0/status': () => ({
          body: {
            library_items: [
              { name: 'FileVault', status: 'success' },
              { name: 'Microsoft Defender', status: 'failed' },
            ],
            parameters: [
              { name: 'Require a firmware password', status: 'PASS' },
              { name: 'Set screen saver timeout', status: 'ERROR' },
            ],
          },
        }),
      });
      const { http, plugin } = run(kandjiPluginFactory, config, vendor.fetch);
      const devices = await plugin.fetchDevices({ http });

      expect(vendor.requests[0].headers['authorization']).toBe('Bearer kandji-token');
      expect(devices.map((d) => d.status)).toEqual(['compliant', 'non-compliant']);
      expect(devices[1].reasons).toEqual(['Kandji: blueprint Kiosks is not allowed']);
      expect(devices.map((d) => d.users)).toEqual([['alice@acme.example'], []]);

      const [enriched] = await enrichOf(plugin)({ http }, [devices[0]]);

      expect(enriched.status).toBe('non-compliant');
      expect(enriched.reasons).toEqual([
        'Kandji: failing blueprint items: Microsoft Defender, Set screen saver timeout',
      ]);
    });

    it('builds the regional host from a validated subdomain', () => {
      expect(kandjiPluginFactory.allowedHosts({ ...config, region: 'us' })).toEqual(['acme.api.kandji.io']);
      expect(() => kandjiPluginFactory.allowedHosts({ ...config, subdomain: 'evil.com/' })).toThrow(/subdomain/);
    });
  });

  describe('Microsoft Defender for Endpoint', () => {
    const config = { tenantId: '0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0', clientId: 'app', clientSecret: 'x' };

    it('maps riskScore / exposureLevel to risk and the sensor health to compliance', async () => {
      const vendor = fakeVendor({
        'POST https://login.microsoftonline.com/': () => ({ body: { access_token: 'mde-token' } }),
        'GET https://api.security.microsoft.com/api/machines': () => ({
          body: {
            '@odata.context': 'https://api.security.microsoft.com/api/$metadata#Machines',
            value: [
              {
                id: '1e5bc9d7e413ddd7902c2932e418702b84d0cc07',
                computerDnsName: 'alice-laptop.corp.contoso.com',
                osPlatform: 'Windows11',
                healthStatus: 'Active',
                onboardingStatus: 'Onboarded',
                riskScore: 'Low',
                exposureLevel: 'Medium',
                aadDeviceId: '80fe8ff8-2624-418e-9591-41f0491218f9',
                lastSeen: recent,
              },
              {
                id: 'm2',
                computerDnsName: 'bob-pc',
                healthStatus: 'Inactive',
                onboardingStatus: 'Onboarded',
                riskScore: 'High',
                exposureLevel: 'Low',
                aadDeviceId: null,
              },
              { id: 'm3', computerDnsName: 'carol', healthStatus: 'Active', riskScore: 'None', exposureLevel: 'None' },
            ],
          },
        }),
      });
      const { http, plugin } = run(defenderPluginFactory, config, vendor.fetch);
      const devices = await plugin.fetchDevices({ http });

      expect(vendor.requests[0].body).toContain('scope=https%3A%2F%2Fapi.securitycenter.microsoft.com%2F.default');
      expect(devices.map((d) => [d.status, d.risk])).toEqual([
        ['compliant', 'medium'],
        ['non-compliant', 'high'],
        ['compliant', 'low'],
      ]);
      expect(devices[0].deviceIds).toEqual([
        '1e5bc9d7e413ddd7902c2932e418702b84d0cc07',
        '80fe8ff8-2624-418e-9591-41f0491218f9',
      ]);
      expect(devices[1].reasons).toEqual(['Defender: sensor health Inactive', 'Defender: risk score High']);

      const withoutExposure = run(defenderPluginFactory, { ...config, includeExposure: 'false' }, vendor.fetch);

      expect((await withoutExposure.plugin.fetchDevices({ http: withoutExposure.http }))[0].risk).toBe('low');
    });

    it('allows only documented API hosts', () => {
      expect(defenderPluginFactory.allowedHosts({ ...config, apiHost: 'api-eu.securitycenter.microsoft.com' })).toEqual(
        ['login.microsoftonline.com', 'api-eu.securitycenter.microsoft.com'],
      );
      expect(() => defenderPluginFactory.allowedHosts({ ...config, apiHost: 'evil.example.com' })).toThrow(/apiHost/);
    });
  });

  describe('CrowdStrike Falcon', () => {
    const config = { cloud: 'eu-1', clientId: 'cs-id', clientSecret: 'cs-secret' };

    it('scrolls host ids, loads details and ZTA scores for matched hosts', async () => {
      const vendor = fakeVendor({
        'POST https://api.eu-1.crowdstrike.com/oauth2/token': () => ({
          status: 201,
          body: { access_token: 'cs-token', token_type: 'bearer', expires_in: 1799 },
        }),
        'GET https://api.eu-1.crowdstrike.com/devices/queries/devices-scroll/v1?limit=5000&offset=': () => ({
          body: { meta: { pagination: { offset: '', total: 3 } }, resources: [], errors: [] },
        }),
        'GET https://api.eu-1.crowdstrike.com/devices/queries/devices-scroll/v1?limit=5000': () => ({
          body: {
            meta: { query_time: 0.01, pagination: { offset: 'FQluY2x1ZGVfY29udGV4dF91dWlk', expires_at: 1, total: 3 } },
            resources: ['a1b2c3d4e5f60718293a4b5c6d7e8f90', 'aid2', 'aid3'],
            errors: [],
          },
        }),
        'POST https://api.eu-1.crowdstrike.com/devices/entities/devices/v2': () => ({
          body: {
            resources: [
              {
                device_id: 'a1b2c3d4e5f60718293a4b5c6d7e8f90',
                hostname: 'ALICE-MBP',
                serial_number: 'C02ZK0ABMD6R',
                platform_name: 'Mac',
                status: 'normal',
                reduced_functionality_mode: 'no',
                last_seen: recent,
              },
              { device_id: 'aid2', hostname: 'bob', status: 'contained', reduced_functionality_mode: 'no' },
              { device_id: 'aid3', hostname: 'carol', status: 'normal', reduced_functionality_mode: 'yes' },
            ],
          },
        }),
        'GET https://api.eu-1.crowdstrike.com/zero-trust-assessment/entities/assessments/v1': () => ({
          body: {
            resources: [
              { aid: 'a1b2c3d4e5f60718293a4b5c6d7e8f90', assessment: { sensor_config: 90, os: 80, overall: 85 } },
              { aid: 'aid2', assessment: { overall: 90 } },
              { aid: 'aid3', assessment: { overall: 45 } },
            ],
          },
        }),
      });
      const { http, plugin } = run(crowdstrikePluginFactory, config, vendor.fetch);
      const devices = await plugin.fetchDevices({ http });

      expect(vendor.requests[0].body).toBe('client_id=cs-id&client_secret=cs-secret');
      expect(
        JSON.parse(vendor.requests.find((r) => r.method === 'POST' && r.url.includes('entities'))?.body ?? '{}'),
      ).toEqual({
        ids: ['a1b2c3d4e5f60718293a4b5c6d7e8f90', 'aid2', 'aid3'],
      });
      expect(devices.map((d) => d.status)).toEqual(['compliant', 'non-compliant', 'non-compliant']);

      const enriched = await enrichOf(plugin)({ http }, devices);
      const zta = vendor.requests.find((r) => r.url.includes('zero-trust'));

      expect(zta?.url).toContain('ids=a1b2c3d4e5f60718293a4b5c6d7e8f90&ids=aid2&ids=aid3');
      // Containment keeps the host at high risk whatever the score says.
      expect(enriched.map((d) => d.risk)).toEqual(['low', 'high', 'medium']);
      expect(ztaRisk(39, 70, 40)).toBe('high');
    });

    it('treats a 404 from ZTA as "no assessment yet"', async () => {
      const vendor = fakeVendor({
        'POST https://api.eu-1.crowdstrike.com/oauth2/token': () => ({ body: { access_token: 't' } }),
        'GET https://api.eu-1.crowdstrike.com/zero-trust-assessment/': () => ({ status: 404, body: { errors: [] } }),
      });
      const { http, plugin } = run(crowdstrikePluginFactory, config, vendor.fetch);
      const [d] = await enrichOf(plugin)({ http }, [
        { externalId: 'x', deviceIds: ['x'], status: 'compliant', reasons: [] },
      ]);

      expect(d.risk).toBeUndefined();
      expect(d.reasons).toEqual(['CrowdStrike: no Zero Trust Assessment yet']);
    });

    it('rejects inconsistent thresholds', () => {
      expect(() =>
        crowdstrikePluginFactory.allowedHosts({ ...config, ztaLowRiskMin: '30', ztaMediumRiskMin: '50' }),
      ).toThrow();
    });
  });

  describe('SentinelOne', () => {
    const config = {
      consoleUrl: 'https://usea1-acme.sentinelone.net',
      apiToken: 's1-token',
      siteIds: '225494730938493804',
    };

    it('pages agents by cursor and derives risk from threats, quarantine and updates', async () => {
      const vendor = fakeVendor({
        'GET https://usea1-acme.sentinelone.net/web/api/v2.1/agents?limit=1000&siteIds=225494730938493804&cursor=':
          () => ({
            body: {
              data: [
                {
                  id: '3',
                  uuid: 'u3',
                  computerName: 'carol',
                  isActive: true,
                  infected: false,
                  activeThreats: 0,
                  networkStatus: 'connected',
                  isUpToDate: false,
                },
              ],
              pagination: { nextCursor: null, totalItems: 3 },
            },
          }),
        'GET https://usea1-acme.sentinelone.net/web/api/v2.1/agents?limit=1000&siteIds=225494730938493804': () => ({
          body: {
            data: [
              {
                id: '1376431539862541324',
                uuid: 'ff819e70af13be381993075eb0ce5f2f6de05be2',
                computerName: 'ALICE-WIN11',
                serialNumber: 'PF2X3Y4Z',
                osType: 'windows',
                isActive: true,
                isDecommissioned: false,
                infected: false,
                activeThreats: 0,
                networkStatus: 'connected',
                isUpToDate: true,
                threatRebootRequired: false,
                lastActiveDate: recent,
              },
              {
                id: '2',
                uuid: 'u2',
                computerName: 'bob',
                isActive: false,
                infected: true,
                activeThreats: 2,
                networkStatus: 'disconnected',
              },
            ],
            pagination: { nextCursor: 'YWdlbnRfaWQ6MTM3NjQzMTUzOTg2MjU0MTMyNA==', totalItems: 3 },
          },
        }),
      });
      const { http, plugin } = run(sentinelOnePluginFactory, config, vendor.fetch);
      const devices = await plugin.fetchDevices({ http });

      expect(vendor.requests[0].headers['authorization']).toBe('ApiToken s1-token');
      expect(vendor.requests[1].url).toContain('cursor=YWdlbnRfaWQ6MTM3NjQzMTUzOTg2MjU0MTMyNA%3D%3D');
      expect(devices.map((d) => [d.externalId, d.status, d.risk])).toEqual([
        ['1376431539862541324', 'compliant', 'low'],
        ['2', 'non-compliant', 'high'],
        ['3', 'compliant', 'medium'],
      ]);
      expect(devices[1].reasons).toEqual([
        'SentinelOne: 2 active threat(s)',
        'SentinelOne: the endpoint is network-quarantined',
        'SentinelOne: the agent is inactive',
      ]);
    });

    it('validates the console URL and site ids', () => {
      expect(sentinelOnePluginFactory.allowedHosts(config)).toEqual(['usea1-acme.sentinelone.net']);
      expect(() => sentinelOnePluginFactory.allowedHosts({ ...config, siteIds: '1;2' })).toThrow(/siteIds/);
      expect(() =>
        sentinelOnePluginFactory.allowedHosts({ ...config, consoleUrl: 'https://x.sentinelone.net/?a=1' }),
      ).toThrow();
    });
  });

  it('test connections read one page and never echo credentials on failure', async () => {
    const vendor = fakeVendor({
      'GET https://usea1-acme.sentinelone.net/web/api/v2.1/agents': () => ({
        status: 401,
        body: { errors: [{ code: 4010010 }] },
      }),
    });
    const { http, plugin } = run(
      sentinelOnePluginFactory,
      { consoleUrl: 'https://usea1-acme.sentinelone.net', apiToken: 'super-secret-token' },
      vendor.fetch,
    );
    const error = await plugin.testConnection({ http }).catch((e: Error) => e);

    expect(String(error)).toMatch(/answered 401/);
    expect(String(error)).not.toContain('super-secret-token');
  });
});
