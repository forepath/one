import { clientGroupSpecSchema } from '@forepath/loadweaver/shared/util-model';
import { BadRequestException } from '@nestjs/common';

import { PostureIntegrationEntity } from '../entities/posture-integration.entity';
import { ResourceEntity } from '../entities/resource.entity';
import { VpnClientEntity } from '../entities/vpn-client.entity';
import { HOSTNAME_MATCH_WARNING, PosturePluginRegistry } from '../remote-access/posture-plugin';
import type { FetchLike } from './posture-http';
import { BUILTIN_POSTURE_PLUGINS } from './plugins/builtin-posture-plugins';
import {
  deviceIdentifiers,
  POSTURE_SYNC_UNIT_JOB,
  PostureIntegrationsService,
  requiredUser,
  syncBackoffMs,
  syncSlot,
} from './posture-integrations.service';

const NOW = Date.parse('2026-10-20T12:00:00Z');

function vpnClient(id: string, extra: Partial<VpnClientEntity> = {}): VpnClientEntity {
  return Object.assign(new VpnClientEntity(), {
    id,
    kind: 'user',
    name: id,
    userId: 'u1',
    ownerLabel: 'alice@example.com',
    publicKey: 'k',
    address: '100.96.0.10',
    subnets: [],
    groups: ['engineering'],
    posture: {
      report: { platform: 'windows', osVersion: '10.0.22631', serialNumber: 'PF3ABCDE', hostname: 'alice-laptop' },
      reportedAt: new Date(NOW - 60_000).toISOString(),
      plugins: {},
      failing: {},
      serialNumber: 'PF3ABCDE',
    },
    integrationPosture: {},
    certificateSerial: null,
    certificateNotAfter: null,
    createdAt: new Date(NOW - 86_400_000),
    renewedAt: new Date(NOW - 86_400_000),
    expiresAt: new Date(NOW + 86_400_000),
    revokedAt: null,
    lastHandshakeAt: null,
    lastEndpoint: null,
    lastGateway: null,
    ...extra,
  });
}

/** In-memory stand-in for the parts of the DataSource the service uses. */
function fakeDataSource() {
  const state = {
    integrations: [] as PostureIntegrationEntity[],
    clients: [vpnClient('c1'), vpnClient('c2', { posture: null })],
    resources: [
      {
        kind: 'ClientGroup',
        name: 'engineering',
        spec: clientGroupSpecSchema.parse({
          posture: { conditions: ['mdm.compliant'] },
          restrictedGroup: 'quarantine',
        }),
      },
      { kind: 'ClientGroup', name: 'quarantine', spec: clientGroupSpecSchema.parse({}) },
    ] as unknown as ResourceEntity[],
    queries: [] as { sql: string; params: unknown[] }[],
  };
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    state.queries.push({ sql, params });

    if (sql.includes('SET sync_started_at = $2')) {
      const row = state.integrations.find((i) => i.id === params[0]);

      if (!row || (row.syncStartedAt && row.syncStartedAt > (params[2] as Date))) return [[], 0];

      row.syncStartedAt = params[1] as Date;

      return [[{ id: row.id }], 1];
    }

    if (sql.includes('integration_posture || jsonb_build_object')) {
      const client = state.clients.find((c) => c.id === params[0]);

      if (client)
        client.integrationPosture = {
          ...client.integrationPosture,
          [params[1] as string]: JSON.parse(params[2] as string),
        };
    }

    if (sql.includes('last_success_at = $2')) {
      const row = state.integrations.find((i) => i.id === params[0]);

      if (row)
        Object.assign(row, {
          syncStartedAt: null,
          lastSuccessAt: params[1],
          failures: 0,
          vendorDevices: params[3],
          matchedDevices: params[4],
        });
    }

    if (sql.includes('last_error = $3')) {
      const row = state.integrations.find((i) => i.id === params[0]);

      if (row)
        Object.assign(row, { syncStartedAt: null, lastError: params[2], failures: params[3], nextSyncAt: params[4] });
    }

    return [];
  });
  const repo = (entity: unknown) => {
    if (entity === PostureIntegrationEntity)
      return {
        find: jest.fn(async (opts?: { where?: { enabled?: boolean } }) =>
          state.integrations.filter((i) => opts?.where?.enabled === undefined || i.enabled === opts.where.enabled),
        ),
        findOne: jest.fn(
          async ({ where }: { where: { id?: string; name?: string } }) =>
            state.integrations.find((i) => (where.id ? i.id === where.id : i.name === where.name)) ?? null,
        ),
        count: jest.fn(async () => state.integrations.length),
        create: jest.fn((v: Partial<PostureIntegrationEntity>) => Object.assign(new PostureIntegrationEntity(), v)),
        save: jest.fn(async (v: PostureIntegrationEntity) => {
          if (!v.id) {
            v.id = `00000000-0000-4000-8000-00000000000${state.integrations.length + 1}`;
            state.integrations.push(v);
          }

          return v;
        }),
        delete: jest.fn(),
        createQueryBuilder: () => {
          const qb = {
            where: () => qb,
            andWhere: () => qb,
            getMany: async () =>
              state.integrations.filter((i) => i.enabled && (!i.nextSyncAt || i.nextSyncAt.getTime() <= NOW)),
          };

          return qb;
        },
      };

    if (entity === VpnClientEntity) return { find: jest.fn(async () => state.clients) };

    return { find: jest.fn(async () => state.resources) };
  };
  const manager = { query, getRepository: repo };
  const dataSource = {
    query,
    getRepository: repo,
    transaction: jest.fn(async (cb: (m: typeof manager) => unknown) => await cb(manager)),
  };

  return { state, dataSource };
}

function setup(queue?: { add: jest.Mock }) {
  const { state, dataSource } = fakeDataSource();
  const registry = new PosturePluginRegistry();

  for (const factory of BUILTIN_POSTURE_PLUGINS) registry.register(factory);

  const access = { assert: jest.fn(async () => ({})) };
  const audit = { record: jest.fn(), recordStandalone: jest.fn() };
  const network = { recompile: jest.fn(async () => ({})) };
  const service = new PostureIntegrationsService(
    dataSource as never,
    registry,
    access as never,
    audit as never,
    network as never,
    queue as never,
  );

  return { service, state, access, audit, network };
}

const intuneConfig = { tenantId: 'contoso.onmicrosoft.com', clientId: 'app-1', clientSecret: 'graph-secret' };

function intuneVendor(state: string, userPrincipalName = 'Alice@Example.com'): FetchLike {
  return async (url) => {
    if (url.startsWith('https://login.microsoftonline.com/'))
      return new Response(JSON.stringify({ access_token: 'tok' }), { status: 200 });

    return new Response(
      JSON.stringify({
        value: [
          {
            id: 'md-1',
            deviceName: 'ALICE-LAPTOP',
            serialNumber: 'PF3ABCDE',
            complianceState: state,
            lastSyncDateTime: '2026-10-20T11:00:00Z',
            userPrincipalName,
          },
        ],
      }),
      { status: 200 },
    );
  };
}

describe('PostureIntegrationsService', () => {
  beforeEach(() =>
    jest.useFakeTimers({
      now: NOW,
      doNotFake: ['setTimeout', 'clearTimeout', 'setImmediate', 'queueMicrotask', 'nextTick'],
    }),
  );
  afterEach(() => jest.useRealTimers());

  it('creates integrations with validated, encrypted-at-rest config and never returns secrets', async () => {
    const { service, state, audit } = setup();
    const created = await service.create(undefined, {
      name: 'intune',
      type: 'intune',
      config: { ...intuneConfig, extra: 'x' },
    });

    expect(created.config).toEqual({ tenantId: 'contoso.onmicrosoft.com', clientId: 'app-1' });
    expect(created.secretsSet).toEqual(['clientSecret']);
    expect(created.matchBy).toEqual(['serial', 'deviceId']);
    expect(created.requireUserMatch).toBe(true);
    expect(created.warnings).toEqual([]);
    expect(JSON.parse(state.integrations[0].config)).toEqual(intuneConfig);
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('graph-secret');

    await expect(service.create(undefined, { name: 'Bad Name', type: 'intune', config: intuneConfig })).rejects.toThrow(
      BadRequestException,
    );
    await expect(service.create(undefined, { name: 'x', type: 'nope', config: {} })).rejects.toThrow(
      /unknown posture plugin/,
    );
    await expect(
      service.create(undefined, { name: 'jamf', type: 'jamf', config: { baseUrl: 'http://x.example.com' } }),
    ).rejects.toThrow(BadRequestException);
  });

  it('keeps stored secrets when an update omits them', async () => {
    const { service, state } = setup();
    const created = await service.create(undefined, { name: 'intune', type: 'intune', config: intuneConfig });

    await service.update(undefined, created.id, { config: { clientId: 'app-2' }, intervalMinutes: 15 });
    expect(JSON.parse(state.integrations[0].config)).toEqual({ ...intuneConfig, clientId: 'app-2' });
    await expect(service.update(undefined, created.id, { type: 'jamf' })).rejects.toThrow(/fixed/);
  });

  it('enqueues due integrations with idempotent job ids', async () => {
    const queue = { add: jest.fn(async () => ({})) };
    const { service } = setup(queue);

    await service.create(undefined, { name: 'intune', type: 'intune', config: intuneConfig });
    expect(await service.coordinate(NOW)).toBe(1);
    expect(queue.add).toHaveBeenCalledWith(
      POSTURE_SYNC_UNIT_JOB,
      expect.objectContaining({ slot: syncSlot(NOW, 30) }),
      expect.objectContaining({ jobId: expect.stringContaining('posture-sync') }),
    );
  });

  it('syncs: matches devices, stores normalized facts and restricts failing devices (recompile + audit)', async () => {
    const { service, state, audit, network } = setup();
    const created = await service.create(undefined, { name: 'intune', type: 'intune', config: intuneConfig });

    // First compliant: c1 (matched by serial) keeps its group, c2 (no report) stays restricted.
    service.fetchImpl = intuneVendor('compliant');
    expect(await service.sync({ integrationId: created.id, slot: '1' }, NOW)).toEqual({
      integration: 'intune',
      vendorDevices: 1,
      matchedDevices: 1,
      changedDevices: 1,
    });
    expect(state.clients[0].integrationPosture['intune']).toMatchObject({
      status: 'compliant',
      matchedBy: 'serial',
      category: 'mdm',
    });
    expect(state.clients[1].integrationPosture['intune']).toMatchObject({
      status: 'unknown',
      reasons: ['Microsoft Intune: device not found'],
    });
    expect(network.recompile).toHaveBeenCalledTimes(1);

    // Then non-compliant: c1 moves into the restricted group, with an audit entry carrying the reason.
    service.fetchImpl = intuneVendor('noncompliant');
    await service.sync({ integrationId: created.id, slot: '2' }, NOW + 60_000);
    expect(network.recompile).toHaveBeenCalledTimes(2);
    expect(audit.recordStandalone).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: 'vpn.posture',
        target: 'vpn/c1',
        details: expect.objectContaining({
          after: 'quarantine',
          failing: { engineering: ['Intune: not compliant with its compliance policies'] },
        }),
      }),
    );
    expect(await service.restrictedDevices(NOW + 60_000)).toEqual([
      expect.objectContaining({
        id: 'c1',
        reasons: ['engineering: Intune: not compliant with its compliance policies'],
      }),
      expect.objectContaining({ id: 'c2' }),
    ]);
  });

  it('records failures with backoff and a sanitized error, keeping old facts', async () => {
    const { service, state } = setup();
    const created = await service.create(undefined, { name: 'intune', type: 'intune', config: intuneConfig });

    service.fetchImpl = async () => new Response('{"error":"invalid_client","secret":"graph-secret"}', { status: 401 });
    expect(await service.sync({ integrationId: created.id, slot: '1' }, NOW)).toBeNull();
    expect(state.integrations[0].failures).toBe(1);
    expect(state.integrations[0].lastError).toBe(
      'POST login.microsoftonline.com/contoso.onmicrosoft.com/oauth2/v2.0/token answered 401',
    );
    expect(state.integrations[0].nextSyncAt?.getTime()).toBe(NOW + 30 * 60_000);
    expect(syncBackoffMs(30, 3)).toBe(120 * 60_000);
    expect(syncBackoffMs(30, 10)).toBe(6 * 3_600_000);
  });

  it('does not run a sync twice while a claim is held', async () => {
    const { service, state } = setup();
    const created = await service.create(undefined, { name: 'intune', type: 'intune', config: intuneConfig });

    state.integrations[0].syncStartedAt = new Date(NOW - 60_000);
    expect(await service.sync({ integrationId: created.id, slot: '1' }, NOW)).toBeNull();
  });

  it('tests connections without exposing credentials', async () => {
    const { service } = setup();

    service.fetchImpl = intuneVendor('compliant');
    expect(await service.test(undefined, { type: 'intune', config: intuneConfig })).toEqual({
      ok: true,
      message: 'Microsoft Graph answered; managed devices are readable',
    });

    service.fetchImpl = async () => new Response('{}', { status: 403 });
    const failed = await service.test(undefined, { type: 'intune', config: intuneConfig });

    expect(failed.ok).toBe(false);
    expect(failed.message).not.toContain('graph-secret');
  });

  it('takes identifiers from pinned values only (never the unpinned report)', () => {
    expect(deviceIdentifiers(vpnClient('c1'))).toEqual({
      serial: 'PF3ABCDE',
      deviceId: undefined,
      hostname: undefined,
    });
  });

  it("doesn't hand a compliant verdict to another user's device reporting the same hostname (H2)", async () => {
    const { service, state } = setup();
    const mallory = vpnClient('c3', {
      userId: 'u2',
      ownerLabel: 'mallory@example.com',
      posture: {
        report: { platform: 'windows', osVersion: '10.0.22631', hostname: 'ALICE-LAPTOP' },
        reportedAt: new Date(NOW - 60_000).toISOString(),
        plugins: {},
        failing: {},
        hostname: 'alice-laptop',
      },
    });

    state.clients = [mallory];
    service.fetchImpl = intuneVendor('compliant');

    // Defaults (serial, device id): the hostname alone matches nothing.
    const created = await service.create(undefined, { name: 'intune', type: 'intune', config: intuneConfig });

    await service.sync({ integrationId: created.id, slot: '1' }, NOW);
    expect(mallory.integrationPosture['intune']).toMatchObject({
      status: 'unknown',
      reasons: ['Microsoft Intune: device not found'],
    });

    // Hostname opted in: warned, and the device user (Alice) still has to be the client owner.
    const withHostname = await service.update(undefined, created.id, { matchBy: ['serial', 'hostname'] });

    expect(withHostname.warnings).toEqual([HOSTNAME_MATCH_WARNING]);
    await service.sync({ integrationId: created.id, slot: '2' }, NOW + 60_000);
    expect(mallory.integrationPosture['intune']).toMatchObject({ status: 'unknown', matchedBy: 'hostname' });
    expect(mallory.integrationPosture['intune'].reasons[0]).toMatch(/user doesn't match the owner/);

    // Turning the user match off is possible, but warned about (and then the hostname is all it takes).
    const weak = await service.update(undefined, created.id, { requireUserMatch: false });

    expect(weak.requireUserMatch).toBe(false);
    expect(weak.warnings).toHaveLength(2);
    await service.sync({ integrationId: created.id, slot: '3' }, NOW + 120_000);
    expect(mallory.integrationPosture['intune']).toMatchObject({ status: 'compliant' });
  });

  it('requires the vendor user to match the owner where the plugin supports it', async () => {
    const { service, state } = setup();
    const created = await service.create(undefined, { name: 'intune', type: 'intune', config: intuneConfig });

    service.fetchImpl = intuneVendor('compliant', 'bob@example.com');
    await service.sync({ integrationId: created.id, slot: '1' }, NOW);
    expect(state.clients[0].integrationPosture['intune']).toMatchObject({ status: 'unknown', matchedBy: 'serial' });

    // EDR records carry no reliable user: no user match, and asking for one is refused.
    const falcon = { clientId: 'cid', clientSecret: 'csecret', cloud: 'us-1' };
    const crowdstrike = await service.create(undefined, { name: 'falcon', type: 'crowdstrike', config: falcon });

    expect(crowdstrike.requireUserMatch).toBe(false);
    expect(crowdstrike.warnings).toEqual([]);
    await expect(
      service.create(undefined, { name: 'falcon2', type: 'crowdstrike', config: falcon, requireUserMatch: true }),
    ).rejects.toThrow(BadRequestException);

    // Machines (admin-enrolled) have no owning user to compare; usernames without @ can't match.
    expect(requiredUser({ kind: 'machine', ownerLabel: 'machine' }, true, true)).toBeUndefined();
    expect(requiredUser({ kind: 'user', ownerLabel: 'alice' }, true, true)).toBeNull();
    expect(requiredUser({ kind: 'user', ownerLabel: 'alice@example.com' }, true, false)).toBeUndefined();
  });
});
