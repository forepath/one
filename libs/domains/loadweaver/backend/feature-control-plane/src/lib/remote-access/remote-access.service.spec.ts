import { ConflictException } from '@nestjs/common';

import { VpnClientEntity, type PostureState } from '../entities/vpn-client.entity';
import { RemoteAccessService } from './remote-access.service';

const NOW = Date.now();

function client(id: string, extra: Partial<VpnClientEntity> = {}): VpnClientEntity {
  return Object.assign(new VpnClientEntity(), {
    id,
    kind: 'user',
    name: id,
    userId: id === 'mine' ? 'u1' : 'u2',
    ownerLabel: id === 'mine' ? 'alice@example.com' : 'mallory@example.com',
    publicKey: `k-${id}`,
    address: '100.96.0.10',
    subnets: [],
    groups: [],
    posture: null,
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

function setup(clients: VpnClientEntity[], update?: jest.Mock) {
  const vpnRepo = {
    findOne: jest.fn(async ({ where }: { where: { id: string } }) => clients.find((c) => c.id === where.id) ?? null),
    find: jest.fn(async () => clients),
    update: update ?? jest.fn(async () => ({})),
  };
  const query = jest.fn(async () => []);
  const dataSource = {
    query,
    getRepository: (entity: unknown) => (entity === VpnClientEntity ? vpnRepo : { find: jest.fn(async () => []) }),
  };
  const integrations = { syncSoon: jest.fn(async () => undefined) };
  const service = new RemoteAccessService(
    dataSource as never,
    { recompile: jest.fn() } as never,
    { can: jest.fn(async () => false) } as never,
    { recordStandalone: jest.fn() } as never,
    { verifyReport: jest.fn() } as never,
    integrations as never,
  );
  const req = { user: { id: 'u1', roles: [] } } as never;

  return { service, vpnRepo, query, integrations, req };
}

const report = { platform: 'macos' as const, osVersion: '15.1' };

describe('RemoteAccessService.reportPosture (pinned identifiers)', () => {
  it('pins normalized identifiers and syncs integrations soon', async () => {
    const { service, vpnRepo, integrations, req } = setup([client('mine')]);

    await service.reportPosture(req, 'mine', {
      ...report,
      deviceId: 'DEV-1',
      serialNumber: 'c02x',
      hostname: 'Alice-MBP.local',
    });

    const posture = (vpnRepo.update.mock.calls[0] as unknown[])[1] as { posture: PostureState };

    expect(posture.posture).toMatchObject({ deviceId: 'dev-1', serialNumber: 'C02X', hostname: 'alice-mbp' });
    expect(integrations.syncSoon).toHaveBeenCalled();
  });

  it('refuses a device id another client pinned in another case (normalized uniqueness)', async () => {
    const other = client('other', {
      posture: { report: null, reportedAt: null, plugins: {}, failing: {}, deviceId: 'DEV-1' },
    });
    const { service, vpnRepo, req } = setup([client('mine'), other]);

    await expect(service.reportPosture(req, 'mine', { ...report, deviceId: 'dev-1' })).rejects.toThrow(
      ConflictException,
    );
    expect(vpnRepo.update).not.toHaveBeenCalled();
  });

  it("doesn't pin another valid client's hostname (spoofing a compliant device's name)", async () => {
    const alice = client('other', {
      posture: { report: null, reportedAt: null, plugins: {}, failing: {}, hostname: 'alice-mbp' },
    });
    const { service, vpnRepo, req } = setup([client('mine'), alice]);

    await service.reportPosture(req, 'mine', { ...report, hostname: 'ALICE-MBP' });

    const saved = (vpnRepo.update.mock.calls[0] as unknown[])[1] as { posture: PostureState };

    expect(saved.posture.hostname).toBeUndefined();
  });

  it('releases pins of expired clients and maps unique-index races to 409 (serial) / no pin (hostname)', async () => {
    const race = (constraint: string) =>
      Object.assign(new Error('duplicate key'), { driverError: { code: '23505', constraint } });
    const serialRace = jest.fn().mockRejectedValueOnce(race('UQ_lw_vpn_clients_pinned_serial'));
    const first = setup([client('mine')], serialRace);

    await expect(first.service.reportPosture(first.req, 'mine', { ...report, serialNumber: 'C02X' })).rejects.toThrow(
      /serial number belongs to another enrolled device/,
    );
    expect(first.query).toHaveBeenCalledWith(expect.stringContaining('expires_at <= $2'), [
      'mine',
      expect.any(Date),
      'serialNumber',
      'C02X',
    ]);

    const hostnameRace = jest
      .fn()
      .mockRejectedValueOnce(race('UQ_lw_vpn_clients_pinned_hostname'))
      .mockResolvedValue({});
    const second = setup([client('mine')], hostnameRace);

    await second.service.reportPosture(second.req, 'mine', { ...report, serialNumber: 'C02X', hostname: 'mbp' });
    expect(hostnameRace).toHaveBeenCalledTimes(2);
    expect(((hostnameRace.mock.calls[1] as unknown[])[1] as { posture: PostureState }).posture).toMatchObject({
      serialNumber: 'C02X',
    });
    expect(
      ((hostnameRace.mock.calls[1] as unknown[])[1] as { posture: PostureState }).posture.hostname,
    ).toBeUndefined();
  });
});
